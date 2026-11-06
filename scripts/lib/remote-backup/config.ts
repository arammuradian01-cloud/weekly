import { databaseUrlFromEnv } from "../../../src/lib/database-url";

type Env = Record<string, string | undefined>;
export type BackupConfig = {
  databaseUrl: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  encryptionKey: Buffer;
  keepDaily: number;
  keepMonthly: number;
  keepMigration: number;
};

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Не задана переменная ${name}`);
  return value;
}

function retention(env: Env, name: string, fallback: number): number {
  const value = env[name] === undefined ? fallback : Number(env[name]);
  if (!Number.isInteger(value) || value < 1 || value > 3650) throw new Error(`${name}: нужно целое число от 1 до 3650`);
  return value;
}

/** Неполная настройка останавливает копирование, а не создаёт ложную отметку об успехе. */
export function backupConfig(env: Env = process.env): BackupConfig {
  const databaseUrl = databaseUrlFromEnv(env);
  if (!databaseUrl) throw new Error("Не задан адрес базы для резервирования");
  const endpoint = new URL(required(env, "BACKUP_S3_ENDPOINT"));
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
    throw new Error("BACKUP_S3_ENDPOINT: нужен HTTPS-адрес хранилища без пути и параметров");
  }
  const key = required(env, "BACKUP_ENCRYPTION_KEY");
  const encryptionKey = Buffer.from(key, "base64");
  if (encryptionKey.length !== 32 || encryptionKey.toString("base64") !== key) {
    throw new Error("BACKUP_ENCRYPTION_KEY: нужен отдельный ключ из 32 случайных байт в base64");
  }
  const prefix = required(env, "BACKUP_S3_PREFIX");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,119}$/.test(prefix) || prefix.endsWith("/") || prefix.includes("//")) {
    throw new Error("BACKUP_S3_PREFIX: нужен отдельный префикс приложения без точки и завершающего слеша");
  }
  const bucket = required(env, "BACKUP_S3_BUCKET");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("Некорректный BACKUP_S3_BUCKET");
  return {
    databaseUrl, endpoint: endpoint.origin, region: required(env, "BACKUP_S3_REGION"), bucket, prefix,
    accessKeyId: required(env, "BACKUP_S3_ACCESS_KEY_ID"), secretAccessKey: required(env, "BACKUP_S3_SECRET_ACCESS_KEY"),
    encryptionKey, keepDaily: retention(env, "BACKUP_KEEP_DAILY", 30),
    keepMonthly: retention(env, "BACKUP_KEEP_MONTHLY", 12), keepMigration: retention(env, "BACKUP_KEEP_MIGRATION", 30),
  };
}

/** Восстановление запускается только на отдельно заданном сервере, никогда рядом с рабочей базой. */
export function restoreTarget(source: string, env: Env = process.env): string {
  const target = required(env, "BACKUP_RESTORE_DATABASE_URL");
  const a = new URL(source);
  const b = new URL(target);
  if (!["postgres:", "postgresql:"].includes(b.protocol)) throw new Error("Неверный адрес сервера проверки восстановления");
  if (a.hostname === b.hostname && (a.port || "5432") === (b.port || "5432")) {
    throw new Error("Для проверки восстановления нужен отдельный сервер PostgreSQL");
  }
  if (env.BACKUP_RESTORE_ISOLATED !== "true") throw new Error("Подтвердите отдельный сервер: BACKUP_RESTORE_ISOLATED=true");
  return target;
}
