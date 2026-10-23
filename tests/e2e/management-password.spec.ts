// [Codex] У Арама прежний пароль управления, у Крайника личный. Только синтетические данные локального стенда.
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { E2E_PASSWORDS } from "./global-setup";
import { enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

const id = "test-personal-management";
const slug = "test-management-kraynik";
const password = "Тестовый доступ руководителя 2026";
const nextPassword = "Новый доступ руководителя 2026";
function configure(apply = false) {
  return execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/management-password.ts", slug, "personal", ...(apply ? ["--apply"] : [])], {
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL }, encoding: "utf8",
  });
}
test.beforeEach(async () => {
  await resetDatabase({ tasks: false, weekly: false });
  await sql(`DELETE FROM settings WHERE key = $1`, [`auth.management.person.${id}`]);
  await sql(`INSERT INTO people (id, slug, login, "fullName", "shortName", role, zone, "passwordHash", "passwordSetAt", "updatedAt") VALUES ($1,$2,'akraynik-test','Крайник Александр','Александр','OWNER','',$3,now(),now())`, [id, slug, await bcrypt.hash(password, 4)]);
});
test.afterEach(async () => {
  await sql(`DELETE FROM settings WHERE key = $1`, [`auth.management.person.${id}`]);
});

test("владельцы включают управление разными паролями; смена личного гасит только управление Крайника", async ({ page, browser }) => {
  test.setTimeout(90000);
  expect(configure()).toContain("Только проверка");
  expect(await sql(`SELECT key FROM settings WHERE key = $1`, [`auth.management.person.${id}`])).toHaveLength(0);
  expect(configure(true)).toContain("Режим изменён");
  expect(configure(true)).toContain("ничего не изменено");
  await enterByLink(page, "muradyan");
  await enterManagement(page, "owner");
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Настройки", exact: true })).toBeVisible();

  const context = await browser.newContext({ viewport: page.viewportSize()!, isMobile: test.info().project.name === "phone" });
  const ceo = await context.newPage();
  await ceo.goto("/login");
  await ceo.getByLabel("Логин").fill("akraynik-test");
  await ceo.getByLabel("Пароль").fill(password);
  await ceo.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(ceo).toHaveURL(/\/$/);
  await ceo.goto("/manage?next=/settings");
  await expect(ceo.getByText("Введите тот же личный пароль, с которым входите в Weekly.")).toBeVisible();
  await ceo.getByLabel("Ваш личный пароль").fill(E2E_PASSWORDS.owner);
  await ceo.getByRole("button", { name: "Включить на 12 часов" }).click();
  await expect(ceo.getByText("Текущий пароль неверный")).toBeVisible();
  await ceo.getByLabel("Ваш личный пароль").fill(password);
  await ceo.getByRole("button", { name: "Включить на 12 часов" }).click();
  await expect(ceo).toHaveURL(/\/settings$/);
  await expect(ceo.getByRole("button", { name: "Ссылка для входа: Мурадян Арам" })).toBeVisible();

  await ceo.goto("/profile?tab=login");
  await ceo.getByLabel("Текущий пароль", { exact: true }).fill(password);
  await ceo.getByLabel("Новый пароль", { exact: true }).fill(nextPassword);
  await ceo.getByLabel("Повторите новый пароль").fill(nextPassword);
  await ceo.getByRole("button", { name: "Сменить пароль", exact: true }).click();
  await expect(ceo.getByText("Пароль изменён, другие устройства вышли").first()).toBeVisible();
  await ceo.goto("/settings");
  await expect(ceo).toHaveURL(/\/manage\?/);
  await ceo.getByLabel("Ваш личный пароль").fill(password);
  await ceo.getByRole("button", { name: "Включить на 12 часов" }).click();
  await expect(ceo.getByText("Текущий пароль неверный")).toBeVisible();
  await ceo.getByLabel("Ваш личный пароль").fill(nextPassword);
  await ceo.getByRole("button", { name: "Включить на 12 часов" }).click();
  await expect(ceo).toHaveURL(/\/settings$/);
  await page.reload();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Настройки", exact: true })).toBeVisible();
  await context.close();
});
