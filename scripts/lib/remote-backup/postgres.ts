import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { pgConnectionConfig } from "../../../src/lib/database-url";
import { libpqUrl, pgTool } from "../pg-tools";
import type { TableDigest } from "./archive";
import { backupDatabaseUrl } from "./config";

const exec = promisify(execFile);
export const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

export function clientFor(url: string, restore = false): pg.Client {
  const env = restore ? { ...process.env, DB_SSL_ROOT_CERT: process.env.BACKUP_RESTORE_SSL_ROOT_CERT } : process.env;
  const connection = backupDatabaseUrl(url);
  connection.searchParams.set("application_name", "weekly-backup");
  const client = new pg.Client({ ...pgConnectionConfig(connection.toString(), env), options: "-c timezone=UTC",
    connectionTimeoutMillis: 15_000, statement_timeout: 600_000, query_timeout: 610_000,
    idle_in_transaction_session_timeout: 720_000 });
  // При разрыве простаивающего соединения pg выдаёт событие вне query(); следующая операция
  // всё равно отклонится. Обработчик позволяет штатно удалить временные файлы в finally.
  client.on("error", () => {});
  return client;
}

/** Пароль остаётся в окружении дочернего процесса, а не в аргументах и сообщении execFile. */
export async function runPg(name: "pg_dump" | "pg_restore", url: string, args: string[], restore = false): Promise<void> {
  const connection = new URL(libpqUrl(backupDatabaseUrl(url).toString()));
  connection.searchParams.delete("sslaccept");
  connection.searchParams.set("application_name", "weekly-backup");
  const root = restore ? process.env.BACKUP_RESTORE_SSL_ROOT_CERT : process.env.DB_SSL_ROOT_CERT;
  if (root && connection.searchParams.get("sslmode") !== "disable") {
    connection.searchParams.set("sslmode", "verify-full");
    connection.searchParams.set("sslrootcert", root);
  }
  const password = decodeURIComponent(connection.password);
  connection.password = "";
  const childEnv: NodeJS.ProcessEnv = { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: "15" };
  // Скрытые настройки libpq не должны перенаправлять URI или добавлять параметры другой сессии.
  for (const key of ["PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGSERVICE", "PGSERVICEFILE", "PGSYSCONFDIR", "PGOPTIONS"]) delete childEnv[key];
  try {
    // URI нужно передать через --dbname: PGDATABASE трактует его как буквальное имя базы.
    // Кроме того, pg_restore без --dbname только печатает SQL и ничего не восстанавливает.
    const commandArgs = ["--no-password", `--dbname=${connection.toString()}`, ...args];
    await exec(pgTool(name), commandArgs, {
      env: childEnv,
      timeout: 600_000, maxBuffer: 1024 * 1024,
    });
  } catch {
    // stderr может содержать данные строк и адрес базы. Не переносим их в журнал или оповещение.
    throw new Error(`${name} не завершился успешно; проверьте версию клиента, доступ к базе и свободное место`);
  }
}

/** Сверка всех пользовательских таблиц, включая очередь и историю миграций. Вызывать внутри снимка. */
export async function tableDigests(client: pg.Client): Promise<TableDigest[]> {
  await client.query("SET LOCAL timezone = 'UTC'");
  await client.query("SET LOCAL DateStyle = 'ISO, YMD'");
  await client.query("SET LOCAL extra_float_digits = 3");
  const tables = await client.query<{ schema: string; table: string }>(`
    SELECT n.nspname AS schema, c.relname AS table FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"`);
  const result: TableDigest[] = [];
  for (const table of tables.rows) {
    const hash = createHash("sha256");
    let rows = 0;
    await client.query(`DECLARE backup_rows NO SCROLL CURSOR FOR
      SELECT to_jsonb(t)::text AS value FROM ${identifier(table.schema)}.${identifier(table.table)} t
      ORDER BY to_jsonb(t)::text COLLATE "C"`);
    try {
      for (;;) {
        const batch = await client.query<{ value: string }>("FETCH FORWARD 500 FROM backup_rows");
        for (const row of batch.rows) { hash.update(row.value); hash.update("\n"); rows++; }
        if (batch.rows.length < 500) break;
      }
    } finally { await client.query("CLOSE backup_rows"); }
    result.push({ ...table, rows, sha256: hash.digest("hex") });
  }
  return result;
}

export function compareDigests(expected: TableDigest[], actual: TableDigest[]): void {
  const key = (t: TableDigest) => JSON.stringify([t.schema, t.table]);
  const actualByName = new Map(actual.map((t) => [key(t), t]));
  if (expected.length !== actual.length || new Set(expected.map(key)).size !== expected.length) {
    throw new Error("После восстановления отличается набор таблиц");
  }
  for (const table of expected) {
    const found = actualByName.get(key(table));
    if (!found || found.rows !== table.rows || found.sha256 !== table.sha256) {
      throw new Error(`Содержимое восстановленной таблицы не совпало: ${table.schema}.${table.table}`);
    }
  }
}
