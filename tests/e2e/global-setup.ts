import { execSync } from "node:child_process";
import pg from "pg";

export const E2E_PASSWORDS = {
  team: "e2e-team-password-1",
  owner: "e2e-owner-password-1",
  admin: "e2e-admin-password-1",
};

/** Пересоздаёт тестовую базу, накатывает миграции, стартовые данные и тестовые пароли */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL!;
  const dbName = new URL(url).pathname.slice(1);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx prisma migrate deploy", { env, stdio: "ignore" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "ignore" });
  for (const [kind, password] of Object.entries(E2E_PASSWORDS)) {
    execSync(`npx tsx scripts/set-password.ts ${kind}`, { env: { ...env, WEEKLY_NEW_PASSWORD: password }, stdio: "ignore" });
  }
}
