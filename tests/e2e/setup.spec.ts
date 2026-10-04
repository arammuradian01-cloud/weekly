import { expect, test } from "@playwright/test";
import pg from "pg";
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
    await page.getByLabel("Ключ настройки").fill(token);
    for (const [kind, value] of [["team", team], ["owner", owner], ["admin", admin]] as const) {
      await page.locator(`#${kind}`).fill(value);
      await page.locator(`#${kind}-repeat`).fill(value);
    }
    await page.getByRole("button", { name: "Сохранить пароли" }).click();
  };

  await fill("неверный-ключ-настройки", E2E_PASSWORDS.team, E2E_PASSWORDS.owner, E2E_PASSWORDS.admin);
  await expect(page.locator("form").getByRole("alert")).toContainText("Неверный ключ настройки");

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
