import { readdir } from "node:fs/promises";
import type pg from "pg";

/** До изменения схемы проверяем, есть ли ещё не применённые миграции и данные, которые нужно защитить. */
export async function migrationBackupNeeded(client: pg.Client, directory = "prisma/migrations"): Promise<boolean> {
  const tables = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
  if (Number(tables.rows[0]?.count ?? 0) === 0) return false;
  const present = await client.query<{ name: string | null }>("SELECT to_regclass('public._prisma_migrations')::text AS name");
  if (!present.rows[0]?.name) return true;
  const applied = await client.query<{ migration_name: string }>(`SELECT migration_name FROM public._prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
  const names = new Set(applied.rows.map((row) => row.migration_name));
  const local = await readdir(directory, { withFileTypes: true });
  return local.some((item) => item.isDirectory() && /^\d/.test(item.name) && !names.has(item.name));
}
