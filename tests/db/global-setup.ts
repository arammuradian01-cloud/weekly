import { execSync } from "node:child_process";
import pg from "pg";

/** Пересоздаёт базу weekly_test, накатывает миграции и стартовые данные без задач */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL!;
  const dbName = new URL(url).pathname.slice(1);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();
  const env = { ...process.env, DATABASE_URL: url, BORD_IMPORT: "off" };
  execSync("npx prisma migrate deploy", { env, stdio: "ignore" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "ignore" });
}
