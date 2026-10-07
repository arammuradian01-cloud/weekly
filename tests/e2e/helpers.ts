import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { E2E_PASSWORDS } from "./global-setup";

/** Снимает блокировку входа и возвращает задачи и weekly к выгрузке таблицы: тесты меняют их в базе */
export async function resetDatabase({ tasks = true, weekly = true } = {}) {
  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  await client.query("DELETE FROM login_attempts");
  // Этап 9: личные входы, ссылки и почта начинаются с чистого листа, общий логин работает
  await client.query("DELETE FROM device_sessions");
  await client.query("DELETE FROM login_links");
  await client.query("UPDATE people SET email = NULL");
  await client.query(`INSERT INTO settings (key, value, "updatedAt") VALUES ('auth.teamLogin', '"on"'::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = '"on"'::jsonb`);
  // Настройки этапа 5: люди и значения справочников, которые добавили тесты, стартовый ритм недели
  const SEED_PEOPLE = ["muradyan", "golovkin", "analyst", "reva", "loginova", "fatyanov", "sakhibullina", "afanasyev", "cheychenets", "ceo"];
  // Этап 14: команды, подразделения и сотрудники из структуры, которые завели тесты
  await client.query("DELETE FROM tasks WHERE \"teamId\" <> 'top'");
  await client.query("DELETE FROM goals");
  await client.query("DELETE FROM teams WHERE id <> 'top'");
  await client.query('UPDATE people SET "unitId" = NULL, "managerId" = NULL, "functionalManagerId" = NULL, position = NULL');
  await client.query("DELETE FROM vacancies");
  await client.query("DELETE FROM org_units WHERE kind <> 'DEPARTMENT'");
  await client.query("DELETE FROM org_units");
  await client.query("INSERT INTO team_members (\"teamId\", \"personId\") SELECT 'top', id FROM people WHERE slug = ANY($1) AND slug <> 'muradyan' ON CONFLICT DO NOTHING", [SEED_PEOPLE]);
  await client.query("DELETE FROM tasks WHERE \"ownerId\" IN (SELECT id FROM people WHERE slug <> ALL($1))", [SEED_PEOPLE]);
  await client.query("DELETE FROM weekly_entries WHERE \"authorId\" IN (SELECT id FROM people WHERE slug <> ALL($1))", [SEED_PEOPLE]);
  await client.query("DELETE FROM weekly_reports WHERE \"authorId\" IN (SELECT id FROM people WHERE slug <> ALL($1))", [SEED_PEOPLE]);
  await client.query("DELETE FROM people WHERE slug <> ALL($1)", [SEED_PEOPLE]);
  await client.query("UPDATE people SET active = (slug NOT IN ('analyst', 'ceo'))");
  await client.query(
    "DELETE FROM dictionary_items WHERE kind IN ('DIRECTION', 'WEEKLY_BLOCK', 'TASK_SOURCE') AND code <> ALL($1)",
    [["osago", "kasko", "red", "deposits", "partners", "product", "insurance", "department", "key-changes", "risks", "team", "numbers", "traffic", "meeting", "weekly", "ceo", "other"]],
  );
  await client.query("UPDATE dictionary_items SET active = true WHERE kind IN ('DIRECTION', 'WEEKLY_BLOCK', 'ENTRY_TYPE', 'TASK_SOURCE')");
  await client.query(`UPDATE settings SET value = '{"weekday": 1, "time": "18:00"}'::jsonb WHERE key = 'week.deadline'`);
  await client.query(`UPDATE settings SET value = '{"weekday": 2}'::jsonb WHERE key = 'week.meeting'`);
  await client.query(`UPDATE settings SET value = '14'::jsonb WHERE key = 'tasks.staleDays'`);
  await client.query(`UPDATE settings SET value = '"test"'::jsonb WHERE key = 'stand.banner'`);
  if (tasks) {
    await client.query("DELETE FROM tasks");
    await client.query(`UPDATE settings SET value = '52'::jsonb WHERE key = 'tasks.nextNumber'`);
  }
  if (weekly) {
    await client.query("DELETE FROM weekly_entries");
    await client.query("DELETE FROM weekly_reports");
    await client.query("DELETE FROM ceo_reports");
    await client.query("DELETE FROM weeks");
  }
  // Этап 6: таблица не подключена, имитация Google работает
  await client.query(`UPDATE settings SET value = 'null'::jsonb WHERE key = 'sheet.spreadsheetId'`);
  await client.query("DELETE FROM settings WHERE key IN ('sheet.layout', 'sheet.synced', 'sheet.lock', 'sheet.imitationDown')");
  // Забор из Bord выключен, прошлых заборов не было
  await client.query("DELETE FROM settings WHERE key LIKE 'bord.%'");
  await client.query("DELETE FROM sheet_runs");
  await client.end();
  const env = { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL };
  if (tasks) execSync("npx tsx scripts/import-bord.ts", { env, stdio: "ignore" });
  if (weekly) execSync("npx tsx scripts/import-bord-weekly.ts", { env, stdio: "ignore" });
  await sql("DELETE FROM sheet_outbox");
}

/** Один запрос к тестовой базе */
export async function sql(text: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows;
  } finally {
    await client.end();
  }
}

export async function enter(page: Page, fullName: string) {
  await page.goto("/login");
  await page.getByLabel("Логин").fill("team");
  await page.getByLabel("Пароль").fill(E2E_PASSWORDS.team);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/choose$/);
  await page.getByRole("button", { name: new RegExp(fullName) }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Режим управления: владельцу его пароль, администратору пароль администраторов */
export async function enterManagement(page: Page, role: "owner" | "admin") {
  await page.goto("/manage");
  await page.getByLabel(/Пароль/).fill(E2E_PASSWORDS[role]);
  await page.getByRole("button", { name: "Включить на 12 часов" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Последнее письмо на адрес из файла писем тестового сервера */
export function lastMailTo(to: string): { to: string; subject: string; text: string } | null {
  const file = process.env.E2E_MAIL_LOG!;
  if (!existsSync(file)) return null;
  const mails = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { to: string; subject: string; text: string });
  return mails.filter((m) => m.to === to).at(-1) ?? null;
}

/** Ссылка из текста письма */
export function linkFrom(text: string): string {
  return text.split("\n").find((line) => line.startsWith("http"))!;
}

/** Вход по личной ссылке из консоли сервера (этап 14): у сотрудников нет общего логина */
export async function enterByLink(page: Page, slug: string) {
  const out = execSync(`npx tsx scripts/login-link.ts ${slug}`, {
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL, APP_URL: "http://localhost:3100" },
  }).toString();
  const link = out.split("\n").find((l) => l.startsWith("http"))!;
  await page.goto(link);
  await page.getByRole("button", { name: /Войти как/ }).click();
  await expect(page).toHaveURL(/\/$/);
}
