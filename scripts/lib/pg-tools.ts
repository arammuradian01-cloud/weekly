import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const CANDIDATE_DIRS = [
  "/opt/homebrew/opt/postgresql@16/bin",
  "/usr/local/opt/postgresql@16/bin",
  "/usr/lib/postgresql/16/bin",
  "/Applications/Postgres.app/Contents/Versions/16/bin",
];

/** Путь к программе PostgreSQL: из PG_BIN_DIR, из типовых мест или из PATH */
export function pgTool(name: "pg_dump" | "pg_restore" | "psql"): string {
  const dirs = [process.env.PG_BIN_DIR, ...CANDIDATE_DIRS].filter(Boolean) as string[];
  for (const dir of dirs) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  try {
    return execFileSync("which", [name], { encoding: "utf8" }).trim();
  } catch {
    throw new Error(`Не нашёл ${name}. Укажите папку с программами PostgreSQL 16 в PG_BIN_DIR в файле .env`);
  }
}

/** Строка подключения для libpq: убираем параметры, которые понимает только Prisma */
export function libpqUrl(databaseUrl: string, database?: string): string {
  const url = new URL(databaseUrl);
  for (const key of ["schema", "connection_limit", "pool_timeout", "pgbouncer", "statement_cache_size"]) {
    url.searchParams.delete(key);
  }
  if (database) url.pathname = `/${database}`;
  return url.toString();
}

export function databaseName(databaseUrl: string): string {
  return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
}
