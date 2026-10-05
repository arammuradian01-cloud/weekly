import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { mkdirSync } from "node:fs";
import { E2E_PASSWORDS } from "./global-setup";

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

// Все запросы идут с одного адреса, поэтому перед каждым тестом обнуляем счётчик попыток
test.beforeEach(async () => {
  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  await client.query("DELETE FROM login_attempts");
  await client.end();
});

async function shot(page: Page, name: string) {
  // Планка качества ТЗ: от 360 пикселей без горизонтальной прокрутки
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png`, fullPage: true });
}

async function signIn(page: Page, password = E2E_PASSWORDS.team) {
  await page.goto("/login");
  await page.getByLabel("Логин").fill("team");
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
}

async function chooseMe(page: Page, fullName: string) {
  await expect(page).toHaveURL(/\/choose$/);
  await page.getByRole("button", { name: new RegExp(fullName) }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function openProfileMenu(page: Page) {
  const trigger = page.getByRole("button", { name: /^Профиль:/ });
  // На ноутбуке меню профиля в боковой панели, на телефоне в шапке: видим ровно одно
  await trigger.filter({ visible: true }).first().click();
}

test("без входа открывается только экран входа", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await shot(page, "01-login");
  const res = await page.request.get("/robots.txt");
  expect(await res.text()).toContain("Disallow: /");
  const headers = (await page.request.get("/login")).headers();
  expect(headers["x-robots-tag"]).toContain("noindex");
});

test("5 неверных паролей закрывают вход на 15 минут", async ({ page }) => {
  for (let i = 1; i <= 4; i++) {
    await signIn(page, "неверный-пароль-123");
    await expect(page.locator("form").getByRole("alert")).toContainText(`Осталось попыток: ${5 - i}`);
  }
  await signIn(page, "неверный-пароль-123");
  await expect(page.locator("form").getByRole("alert")).toContainText("Вход закрыт на 15 минут");
  // Даже верный пароль не пускает, пока действует блокировка
  await signIn(page);
  await expect(page.locator("form").getByRole("alert")).toContainText("Слишком много неверных попыток");
  await expect(page).toHaveURL(/\/login$/);
  await shot(page, "02-login-locked");
});

test("лидер входит, выбирает себя и видит свою неделю без режима управления", async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/choose$/);
  await shot(page, "03-choose");
  await chooseMe(page, "Рева Тарас");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Тарас");
  await expect(page.getByText(/Отчётная неделя \d+/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Мой weekly за неделю/ })).toBeVisible();
  await shot(page, "04-my-week");

  await openProfileMenu(page);
  await expect(page.getByRole("menuitem", { name: "Сменить профиль" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Включить режим управления" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Страницы управления лидеру закрыты
  await page.goto("/journal");
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/team");
  await expect(page.getByText("Мурадян Арам").filter({ visible: true }).first()).toBeVisible();
  await shot(page, "05-team");
});

test("владелец включает режим управления только своим паролем", async ({ page }) => {
  await signIn(page);
  await chooseMe(page, "Мурадян Арам");
  await openProfileMenu(page);
  await page.getByRole("menuitem", { name: "Включить режим управления" }).click();
  await expect(page).toHaveURL(/\/manage/);

  // Пароль администраторов владельцу не подходит
  await page.getByLabel("Пароль владельца").fill(E2E_PASSWORDS.admin);
  await page.getByRole("button", { name: "Включить на 12 часов" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("Неверный пароль");

  await page.getByLabel("Пароль владельца").fill(E2E_PASSWORDS.owner);
  await page.getByRole("button", { name: "Включить на 12 часов" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/journal");
  await expect(page).toHaveURL(/\/journal$/);
  // Живые события ресурса лежат под выдуманным журналом прототипа в раскрывающемся блоке
  await page.getByText("Живые события ресурса").click();
  await expect(page.getByRole("cell", { name: "Включён режим управления" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Неверный пароль режима управления" }).first()).toBeVisible();
  await shot(page, "06-journal");

  await page.goto("/sync");
  await expect(page).toHaveURL(/\/sync$/);
  await page.goto("/settings");
  await expect(page.getByText("Задан").first()).toBeVisible();
  await shot(page, "07-settings");
});

test("администратор не видит разделы владельца", async ({ page }) => {
  await signIn(page);
  await chooseMe(page, "Головкин Владислав");
  await page.goto("/manage");
  await page.getByLabel("Пароль администраторов").fill(E2E_PASSWORDS.admin);
  await page.getByRole("button", { name: "Включить на 12 часов" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/ceo-report");
  await expect(page).toHaveURL(/\/ceo-report$/);
  await page.goto("/sync");
  await expect(page).toHaveURL(/\/$/);
});

test("проверка живости для хостинга открыта без входа и не трогает базу", async ({ request }) => {
  const live = await request.get("/api/live");
  expect(live.status()).toBe(200);
  expect(await live.json()).toEqual({ ok: true });
});
