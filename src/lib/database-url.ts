// Адрес базы и производные от него секреты. Модуль без обращений к базе и к Next:
// его используют prisma.config.ts, proxy, сервер, стартовые данные и фоновый процесс.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

type Env = Record<string, string | undefined>;

/**
 * Адрес базы для Prisma.
 * На своём компьютере это DATABASE_URL из .env. В облаке удобнее задать части по отдельности:
 * DB_HOST, DB_PORT, DB_USER, DB_NAME и DB_PASSWORD. Тогда пароль вставляется в панель как есть,
 * без ручного кодирования спецсимволов, а остальные части не секретны.
 * DB_SSL: require (по умолчанию, шифрование), disable (без шифрования).
 */
export function databaseUrlFromEnv(env: Env = process.env): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (!env.DB_HOST || !env.DB_PASSWORD) return undefined;

  const user = encodeURIComponent(env.DB_USER || "postgres");
  const password = encodeURIComponent(env.DB_PASSWORD);
  const port = env.DB_PORT || "5432";
  const name = encodeURIComponent(env.DB_NAME || "postgres");
  const url = `postgresql://${user}:${password}@${env.DB_HOST}:${port}/${name}`;

  const ssl = (env.DB_SSL || "require").toLowerCase();
  // Движок миграций Prisma понимает только require и проверку сертификата отдельным параметром:
  // шифруем всегда, а проверку сертификата делает драйвер приложения (см. pgConnectionConfig)
  return ssl === "disable" ? url : `${url}?sslmode=require&sslaccept=accept_invalid_certs`;
}

export type PgConfig = {
  connectionString: string;
  ssl?: { rejectUnauthorized: boolean; ca?: string };
};

/**
 * Параметры подключения для драйвера pg.
 * Параметры TLS из строки убираем: pg толкует sslmode=require как полную проверку
 * и не знает сертификата провайдера. Шифрование передаём явно.
 * Если задан DB_SSL_ROOT_CERT (путь к корневому сертификату провайдера), сертификат базы
 * проверяется полностью, включая имя хоста. Без него соединение шифруется без проверки.
 */
export function pgConnectionConfig(databaseUrl: string, env: Env = process.env): PgConfig {
  const url = new URL(databaseUrl);
  const mode = url.searchParams.get("sslmode");
  for (const key of ["sslmode", "sslaccept", "sslcert", "sslrootcert", "schema", "uselibpqcompat"]) {
    url.searchParams.delete(key);
  }
  const connectionString = url.toString();
  if (!mode || mode === "disable") return { connectionString };

  const certPath = env.DB_SSL_ROOT_CERT;
  if (certPath) return { connectionString, ssl: { rejectUnauthorized: true, ca: readFileSync(certPath, "utf8") } };
  return { connectionString, ssl: { rejectUnauthorized: mode === "verify-full" } };
}

/**
 * Ключ подписи сессий.
 * SESSION_SECRET из окружения, если задан. Иначе ключ выводится из пароля базы:
 * тот, кто знает пароль базы, и так может всё, а лишняя переменная в панели не нужна.
 * Смена пароля базы выводит всех из ресурса, как и смена общего пароля.
 */
export function sessionSecretFromEnv(env: Env = process.env): string {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  const url = databaseUrlFromEnv(env);
  if (!url) return "";
  let password = "";
  try {
    password = decodeURIComponent(new URL(url).password);
  } catch {
    return "";
  }
  if (!password) return "";
  return createHmac("sha256", password).update("weekly/session/v1").digest("base64url");
}
