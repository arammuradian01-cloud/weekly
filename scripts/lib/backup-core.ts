import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { prisma } from "../../src/lib/db";
import { writeAudit } from "../../src/lib/audit";
import { getSetting } from "../../src/lib/settings";
import { backupFileName, filesToDelete, needsMonthly } from "../../src/lib/backup-rotation";
import { databaseName, libpqUrl, pgTool } from "./pg-tools";
import { databaseUrlFromEnv } from "../../src/lib/database-url";

const run = promisify(execFile);

function backupRoot(): string {
  return resolve(process.env.BACKUP_DIR || "./backups");
}

function databaseUrl(): string {
  const raw = databaseUrlFromEnv();
  if (!raw) throw new Error("Адрес базы не задан: нужен DATABASE_URL или DB_HOST и DB_PASSWORD");
  // sslaccept понимает только Prisma, pg_dump и pg_restore на нём спотыкаются
  const url = new URL(raw);
  url.searchParams.delete("sslaccept");
  return url.toString();
}

export type BackupResult = { file: string; bytes: number; monthly: boolean; deleted: string[] };

/** Копия базы в формате pg_dump custom, затем ротация 30 ежедневных и 12 ежемесячных */
export async function runBackup(now = new Date()): Promise<BackupResult> {
  const root = backupRoot();
  const dailyDir = join(root, "daily");
  const monthlyDir = join(root, "monthly");
  mkdirSync(dailyDir, { recursive: true });
  mkdirSync(monthlyDir, { recursive: true });

  const name = backupFileName(now);
  const target = join(dailyDir, name);
  const temp = `${target}.part`;

  try {
    await run(pgTool("pg_dump"), [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      `--file=${temp}`,
      `--dbname=${libpqUrl(databaseUrl())}`,
    ]);
    renameSync(temp, target);

    const monthlyFiles = readdirSync(monthlyDir);
    const monthly = needsMonthly(monthlyFiles, name);
    if (monthly) copyFileSync(target, join(monthlyDir, name));

    const keepDaily = await getSetting<number>("backup.keepDaily", 30);
    const keepMonthly = await getSetting<number>("backup.keepMonthly", 12);
    const deleted = [
      ...filesToDelete(readdirSync(dailyDir), keepDaily).map((f) => join(dailyDir, f)),
      ...filesToDelete(readdirSync(monthlyDir), keepMonthly).map((f) => join(monthlyDir, f)),
    ];
    for (const f of deleted) rmSync(f);

    const bytes = statSync(target).size;
    await writeAudit({ action: "backup.done", source: "SYSTEM", after: { file: name, bytes, monthly } });
    return { file: target, bytes, monthly, deleted };
  } catch (error) {
    if (existsSync(temp)) rmSync(temp);
    await writeAudit({ action: "backup.failed", source: "SYSTEM", after: { error: String(error).slice(0, 500) } });
    throw error;
  }
}

/** Самая свежая ежедневная копия */
export function latestBackup(): string | null {
  const dailyDir = join(backupRoot(), "daily");
  if (!existsSync(dailyDir)) return null;
  const files = readdirSync(dailyDir).filter((f) => f.endsWith(".dump")).sort();
  return files.length ? join(dailyDir, files[files.length - 1]!) : null;
}

export type TableCheck = { table: string; live: number; restored: number };
export type RestoreCheckResult = { file: string; database: string; tables: TableCheck[] };

async function countRows(client: pg.Client): Promise<Map<string, number>> {
  const { rows } = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename",
  );
  const result = new Map<string, number>();
  for (const { tablename } of rows) {
    const { rows: c } = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${tablename.replace(/"/g, '""')}"`);
    result.set(tablename, Number(c[0]!.n));
  }
  return result;
}

/**
 * Восстанавливает копию во временную базу, сравнивает таблицы с рабочей базой и удаляет временную.
 * Копия, которую никто не проверял, не считается копией.
 */
export async function runRestoreCheck(file = latestBackup()): Promise<RestoreCheckResult> {
  if (!file) throw new Error("Копий пока нет. Сначала выполните npm run backup");
  const url = databaseUrl();
  const tempDb = `${databaseName(url)}_restore_check_${Date.now()}`;
  const admin = new pg.Client({ connectionString: libpqUrl(url, "postgres") });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${tempDb}"`);
    await run(pgTool("pg_restore"), [
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      `--dbname=${libpqUrl(url, tempDb)}`,
      file,
    ]);

    const live = new pg.Client({ connectionString: libpqUrl(url) });
    const restored = new pg.Client({ connectionString: libpqUrl(url, tempDb) });
    await live.connect();
    await restored.connect();
    try {
      const [liveCounts, restoredCounts] = await Promise.all([countRows(live), countRows(restored)]);
      const tables = [...liveCounts.keys()].map((table) => ({
        table,
        live: liveCounts.get(table) ?? 0,
        restored: restoredCounts.get(table) ?? -1,
      }));
      const missing = tables.filter((t) => t.restored < 0).map((t) => t.table);
      if (missing.length) throw new Error(`В копии нет таблиц: ${missing.join(", ")}`);
      await writeAudit({
        action: "backup.check.ok",
        source: "SYSTEM",
        after: { file: file.split("/").pop() ?? file, tables: tables.length },
      });
      return { file, database: tempDb, tables };
    } finally {
      await live.end();
      await restored.end();
    }
  } catch (error) {
    await writeAudit({ action: "backup.check.failed", source: "SYSTEM", after: { error: String(error).slice(0, 500) } });
    throw error;
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${tempDb}" WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  }
}

export async function disconnect() {
  await prisma.$disconnect();
}
