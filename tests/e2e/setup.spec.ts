import { expect, test } from "@playwright/test";
import pg from "pg";
import { createHash } from "node:crypto";
import { E2E_PASSWORDS } from "./global-setup";

const TOKEN = "e2e-setup-token-0123456789";

async function sql(query: string) {
  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  await client.query(query);
  await client.end();
}

test.beforeEach(async () => {
  await sql("DELETE FROM login_attempts");
});

test("первичная настройка паролей в браузере по ключу", async ({ page }) => {
  // Имитируем свежий сервер: паролей ещё нет
  await sql("DELETE FROM settings WHERE key IN ('auth.team.hash', 'auth.owner.hash', 'auth.admin.hash')");

  await page.goto("/login");
  await page.getByRole("link", { name: "Перейти к первичной настройке" }).click();
  await expect(page).toHaveURL(/\/setup$/);

  const fill = async (token: string, team: string, owner: string, admin: string) => {
    await page.getByLabel("Код настройки").fill(token);
    for (const [kind, value] of [["team", team], ["owner", owner], ["admin", admin]] as const) {
      await page.locator(`#${kind}`).fill(value);
      await page.locator(`#${kind}-repeat`).fill(value);
    }
    await page.getByRole("button", { name: "Сохранить пароли" }).click();
  };

  await fill("неверный-ключ-настройки", E2E_PASSWORDS.team, E2E_PASSWORDS.owner, E2E_PASSWORDS.admin);
  await expect(page.locator("form").getByRole("alert")).toContainText("Неверный код настройки");

  await fill(TOKEN, E2E_PASSWORDS.team, E2E_PASSWORDS.team, E2E_PASSWORDS.admin);
  await expect(page.locator("form").getByRole("alert")).toContainText("Пароли должны отличаться");

  await fill(TOKEN, E2E_PASSWORDS.team, E2E_PASSWORDS.owner, E2E_PASSWORDS.admin);
  await expect(page).toHaveURL(/\/login\?setup=done$/);
  await expect(page.getByRole("status")).toContainText("Пароли заданы");

  await page.getByLabel("Логин").fill("team");
  await page.getByLabel("Пароль").fill(E2E_PASSWORDS.team);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/choose$/);

  // После настройки страница больше ничего не принимает
  await page.goto("/setup");
  await expect(page.getByText("Пароли уже заданы")).toBeVisible();
});

test("одноразовый код из журнала запуска: регистр и дефисы не важны, после настройки код гаснет", async ({ page }) => {
  await sql("DELETE FROM settings WHERE key IN ('auth.team.hash', 'auth.owner.hash', 'auth.admin.hash')");
  // Так же, как это делает запуск приложения: в базе только хэш нормализованного кода
  const code = "K7M2-QX9R-T4HB-8NWC";
  const digest = createHash("sha256").update(code.replaceAll("-", "")).digest("hex");
  await sql(`INSERT INTO settings (key, value, "updatedAt") VALUES ('setup.codeHash', '"${digest}"', now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);

  await page.goto("/setup");
  await page.getByLabel("Код настройки").fill(" k7m2 qx9r t4hb 8nwc ");
  for (const [kind, value] of Object.entries(E2E_PASSWORDS)) {
    await page.locator(`#${kind}`).fill(value);
    await page.locator(`#${kind}-repeat`).fill(value);
  }
  await page.getByRole("button", { name: "Сохранить пароли" }).click();
  await expect(page).toHaveURL(/\/login\?setup=done$/);

  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  const { rowCount } = await client.query("SELECT 1 FROM settings WHERE key = 'setup.codeHash'");
  await client.end();
  expect(rowCount).toBe(0);
});
