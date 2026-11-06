import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { databaseName } from "../pg-tools";
import { backupConfig, restoreTarget, type BackupConfig } from "./config";
import { decryptArchive, encryptArchive, fileHash, type Manifest } from "./archive";
import { clientFor, compareDigests, identifier, runPg, tableDigests } from "./postgres";
import { S3BackupStore, type BackupStore } from "./storage";

const LOCK = 890104;
const FILE = /^weekly-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}\.wbk$/;
type Options = { config?: BackupConfig; store?: BackupStore; now?: Date };
export type RemoteBackupResult = { key: string; monthlyKey: string | null; tables: number; deleted: number };

export function ownedKeys(keys: string[], prefix: string): string[] {
  return keys.filter((key) => key.startsWith(prefix) && FILE.test(key.slice(prefix.length))).sort();
}

export function monthlyPeriod(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}

/** Удаляем только файлы своего формата и только после подтверждения новой внешней копии. */
async function rotate(store: BackupStore, prefix: string, keep: number): Promise<number> {
  const keys = ownedKeys(await store.list(prefix), prefix);
  const expired = keys.slice(0, Math.max(0, keys.length - keep));
  for (const key of expired) await store.remove(key);
  return expired.length;
}

async function publish(store: BackupStore, key: string, archive: string, dir: string): Promise<void> {
  const downloaded = join(dir, `uploaded-${randomUUID()}.wbk`);
  try {
    await store.put(key, archive);
    await store.get(key, downloaded);
    if (await fileHash(downloaded) !== await fileHash(archive)) throw new Error("Внешняя копия не совпала с отправленным файлом");
  } catch (error) {
    // Имя уникально для этой попытки. Убираем только свой незавершённый результат, старые копии не трогаем.
    await store.remove(key).catch(() => undefined);
    throw error;
  } finally { await rm(downloaded, { force: true }); }
}

export async function createRemoteBackup(purpose: "daily" | "migration" = "daily", options: Options = {}): Promise<RemoteBackupResult> {
  const config = options.config ?? backupConfig();
  const store = options.store ?? new S3BackupStore(config);
  const now = options.now ?? new Date();
  const dir = await mkdtemp(join(tmpdir(), "weekly-backup-"));
  const client = clientFor(config.databaseUrl);
  let connected = false;
  let locked = false;
  try {
    await client.connect();
    connected = true;
    const lock = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [LOCK]);
    if (!lock.rows[0]?.ok) throw new Error("Другая резервная копия ещё создаётся");
    locked = true;
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows } = await client.query<{ snapshot: string }>("SELECT pg_export_snapshot() AS snapshot");
    const dump = join(dir, "database.dump");
    const archive = join(dir, "database.wbk");
    await runPg("pg_dump", config.databaseUrl, ["--format=custom", "--no-owner", "--no-privileges", `--snapshot=${rows[0]!.snapshot}`, `--file=${dump}`]);
    const tables = await tableDigests(client);
    if (!tables.length) throw new Error("В базе нет пользовательских таблиц: копия не публикуется");
    await client.query("COMMIT");
    const manifest: Manifest = { version: 1, createdAt: now.toISOString(), database: databaseName(config.databaseUrl), purpose,
      dumpSha256: await fileHash(dump), tables };
    await encryptArchive(dump, archive, manifest, config.encryptionKey);
    const name = `weekly-${now.toISOString().replaceAll(":", "-").replace(".", "-")}-${randomUUID()}.wbk`;
    const prefix = `${config.prefix}/${purpose}/`;
    const key = prefix + name;
    await publish(store, key, archive, dir);
    let monthlyKey: string | null = null;
    if (purpose === "daily") {
      const monthlyPrefix = `${config.prefix}/monthly/`;
      const periodPrefix = `${monthlyPrefix}${monthlyPeriod(now)}/`;
      const existing = ownedKeys(await store.list(periodPrefix), periodPrefix);
      if (!existing.length) {
        monthlyKey = periodPrefix + name;
        await publish(store, monthlyKey, archive, dir);
      }
    }
    // Не смешиваем ежедневные и предмиграционные копии: частые выкладки не вытесняют ежедневную историю.
    let deleted = await rotate(store, prefix, purpose === "daily" ? config.keepDaily : config.keepMigration);
    if (purpose === "daily") {
      const monthlyPrefix = `${config.prefix}/monthly/`;
      const keys = (await store.list(monthlyPrefix)).filter((key) => {
        const [period, name, extra] = key.slice(monthlyPrefix.length).split("/");
        return /^\d{4}-\d{2}$/.test(period ?? "") && FILE.test(name ?? "") && extra === undefined;
      }).sort();
      const periods = [...new Set(keys.map((key) => key.slice(monthlyPrefix.length, monthlyPrefix.length + 7)))].sort();
      const expired = new Set(periods.slice(0, Math.max(0, periods.length - config.keepMonthly)));
      for (const old of keys) if (expired.has(old.slice(monthlyPrefix.length, monthlyPrefix.length + 7))) { await store.remove(old); deleted++; }
    }
    return { key, monthlyKey, tables: tables.length, deleted };
  } finally {
    if (connected) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (locked) await client.query("SELECT pg_advisory_unlock($1)", [LOCK]).catch(() => undefined);
    }
    await client.end().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
}

export async function verifyRemoteBackup(key?: string, options: Options & { targetUrl?: string } = {}): Promise<{ key: string; tables: number }> {
  const config = options.config ?? backupConfig();
  // Даже явно переданный адрес проходит те же проверки, что и переменная окружения.
  const target = restoreTarget(config.databaseUrl, options.targetUrl ? { ...process.env, BACKUP_RESTORE_DATABASE_URL: options.targetUrl } : process.env);
  const store = options.store ?? new S3BackupStore(config);
  const prefix = `${config.prefix}/daily/`;
  const selected = key ?? ownedKeys(await store.list(prefix), prefix).at(-1);
  if (!selected || !selected.startsWith(`${config.prefix}/`) || !FILE.test(selected.split("/").at(-1)!)) throw new Error("Внешняя копия не найдена");
  const dir = await mkdtemp(join(tmpdir(), "weekly-restore-"));
  const database = `weekly_restore_check_${randomUUID().replaceAll("-", "")}`;
  const admin = clientFor(target, true);
  let created = false;
  let connected = false;
  try {
    const archive = join(dir, "download.wbk");
    const dump = join(dir, "database.dump");
    await store.get(selected, archive);
    const manifest = await decryptArchive(archive, dump, config.encryptionKey);
    if (manifest.database !== databaseName(config.databaseUrl)) throw new Error("Копия принадлежит другой базе");
    await admin.connect();
    connected = true;
    await admin.query(`CREATE DATABASE ${identifier(database)} TEMPLATE template0`);
    created = true;
    const url = new URL(target);
    url.pathname = `/${database}`;
    await runPg("pg_restore", url.toString(), ["--no-owner", "--no-privileges", "--exit-on-error", "--single-transaction", dump], true);
    const restored = clientFor(url.toString(), true);
    try {
      await restored.connect();
      await restored.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      compareDigests(manifest.tables, await tableDigests(restored));
      await restored.query("COMMIT");
    } finally { await restored.end().catch(() => undefined); }
    return { key: selected, tables: manifest.tables.length };
  } finally {
    // Только база, которую создала именно эта попытка. Никаких пользовательских имён и DROP для рабочей базы.
    try {
      if (created && connected) await admin.query(`DROP DATABASE ${identifier(database)} WITH (FORCE)`);
    } finally {
      await admin.end().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/** Аварийное извлечение не требует живой исходной базы. Ничего не восстанавливает и не перезаписывает. */
export async function extractRemoteBackup(key: string, output: string, options: Options = {}): Promise<Manifest> {
  const config = options.config ?? backupConfig();
  const store = options.store ?? new S3BackupStore(config);
  if (!key.startsWith(`${config.prefix}/`) || !FILE.test(key.split("/").at(-1)!)) throw new Error("Неверный ключ резервной копии");
  const dir = await mkdtemp(join(tmpdir(), "weekly-extract-"));
  let created = false;
  try {
    const archive = join(dir, "copy.wbk");
    await store.get(key, archive);
    const manifest = await decryptArchive(archive, output, config.encryptionKey);
    created = true;
    if (manifest.database !== databaseName(config.databaseUrl)) throw new Error("Копия принадлежит другой базе");
    return manifest;
  } catch (error) {
    if (created) await rm(output, { force: true });
    throw error;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
