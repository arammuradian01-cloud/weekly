// Первичная настройка на новом компьютере или сервере:
// создаёт .env с ключом сессий, применяет миграции и стартовые данные. Секреты на экран не выводит.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { userInfo } from "node:os";

const ENV_PATH = ".env";

function detectPgBin(): string {
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin", "/usr/lib/postgresql/16/bin"]) {
    if (existsSync(`${dir}/pg_dump`)) return dir;
  }
  return "";
}

function parseEnv(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) map.set(m[1]!, m[2]!.replace(/^"|"$/g, ""));
  }
  return map;
}

const existing = existsSync(ENV_PATH) ? parseEnv(readFileSync(ENV_PATH, "utf8")) : new Map<string, string>();
const values = new Map<string, string>([
  ["DATABASE_URL", existing.get("DATABASE_URL") || `postgresql://${userInfo().username}@localhost:5432/weekly`],
  ["SESSION_SECRET", existing.get("SESSION_SECRET") && existing.get("SESSION_SECRET")!.length >= 32 ? existing.get("SESSION_SECRET")! : randomBytes(48).toString("base64url")],
  ["APP_URL", existing.get("APP_URL") || "http://localhost:3000"],
  ["TRUST_PROXY", existing.get("TRUST_PROXY") || "false"],
  ["BACKUP_DIR", existing.get("BACKUP_DIR") || "./backups"],
  ["PG_BIN_DIR", existing.get("PG_BIN_DIR") || detectPgBin()],
]);
for (const [k, v] of existing) if (!values.has(k)) values.set(k, v);

writeFileSync(ENV_PATH, [...values].map(([k, v]) => `${k}="${v}"`).join("\n") + "\n", { mode: 0o600 });
console.log(existing.size ? "Файл .env проверен и дополнен" : "Создан файл .env с новым ключом сессий");

execSync("npx prisma migrate deploy", { stdio: "inherit" });
execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });

console.log("\nГотово. Если пароли ещё не заданы, задайте их по очереди:");
console.log("  npm run password -- team    общий вход для команды");
console.log("  npm run password -- owner   режим управления владельца");
console.log("  npm run password -- admin   режим управления администраторов");
