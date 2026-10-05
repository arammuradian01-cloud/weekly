import { execSync } from "node:child_process";
import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { E2E_PASSWORDS } from "./global-setup";

/** Снимает блокировку входа и возвращает задачи и weekly к выгрузке таблицы: тесты меняют их в базе */
export async function resetDatabase({ tasks = true, weekly = true } = {}) {
  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  await client.query("DELETE FROM login_attempts");
  // Настройки этапа 5: люди и значения справочников, которые добавили тесты, стартовый ритм недели
  const SEED_PEOPLE = ["muradyan", "golovkin", "analyst", "reva", "loginova", "fatyanov", "sakhibullina", "afanasyev", "cheychenets", "ceo"];
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
  await client.end();
  const env = { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL };
  if (tasks) execSync("npx tsx scripts/import-bord.ts", { env, stdio: "ignore" });
  if (weekly) execSync("npx tsx scripts/import-bord-weekly.ts", { env, stdio: "ignore" });
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
