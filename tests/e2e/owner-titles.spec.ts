// Этап 69: подпись роли владельца. Главный владелец при личном входе в режиме управления задаёт себе «ex-Владелец»,
// совладельцу «Владелец» в «Настройках», «Люди и роли». Подписи видны в меню профиля в шапке, в профиле, в настройках и
// на экране выбора себя. Права главного не изменились: он по-прежнему выдаёт ссылку совладельцу и может сделать его
// главным, а совладелец не управляет входом главного и подпись не задаёт. Ноутбук 1440 и телефон 360 без
// горизонтальной прокрутки.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { E2E_PASSWORDS } from "./global-setup";
import { enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-owner-titles-${name}.png`, fullPage: true });
}

/** Меню профиля: на ноутбуке в боковой панели, на телефоне в шапке, видно ровно одно */
async function profileMenu(page: Page) {
  await page.getByRole("button", { name: /^Профиль:/ }).filter({ visible: true }).first().click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

async function freshPage(browser: Browser, like: Page): Promise<Page> {
  const phone = test.info().project.name === "phone";
  const context = await browser.newContext({ viewport: like.viewportSize() ?? undefined, isMobile: phone, hasTouch: phone, locale: "ru-RU", timezoneId: "Europe/Moscow" });
  return context.newPage();
}

/** Подпись роли в окне «Подпись роли» строки владельца */
async function setTitle(page: Page, fullName: string, title: string) {
  await page.getByRole("button", { name: `Подпись роли: ${fullName}` }).click();
  const dialog = page.getByRole("dialog", { name: `Подпись роли: ${fullName}` });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Подпись роли").fill(title);
  await dialog.getByRole("button", { name: "Сохранить подпись" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`${fullName}: подпись роли «${title}»`)).toBeVisible();
}

async function restore() {
  await sql("DELETE FROM settings WHERE key = 'owners.titles'");
  await sql(`INSERT INTO settings (key, value, "updatedAt") VALUES ('owner.primary', '"muradyan"'::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = '"muradyan"'::jsonb`);
  await sql("UPDATE people SET role = 'ADMIN' WHERE slug = 'golovkin'");
}

test.beforeEach(async () => {
  await resetDatabase({ tasks: false, weekly: false });
  await restore();
  // CEO-совладелец в тесте: роль владельца у Головкина. Роль владельцу меняет сам главный в «Настройках», это не новое
  await sql("UPDATE people SET role = 'OWNER' WHERE slug = 'golovkin'");
});
test.afterAll(restore);

test("главный владелец задаёт себе «ex-Владелец» и совладельцу «Владелец», подписи видны везде, права не изменились", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await enterByLink(page, "muradyan");
  await enterManagement(page, "owner");
  await page.goto("/settings#people");
  await expect(page.getByTestId("role-muradyan")).toHaveText("Главный владелец");
  await expect(page.getByTestId("role-golovkin")).toHaveText("Совладелец");

  // Окно подписи: подпись по умолчанию в подсказке, неверный текст не проходит и ничего не меняет
  await page.getByRole("button", { name: "Подпись роли: Мурадян Арам" }).click();
  const dialog = page.getByRole("dialog", { name: "Подпись роли: Мурадян Арам" });
  await expect(dialog.getByText("Пустое поле вернёт подпись по умолчанию: «Владелец»")).toBeVisible();
  await dialog.getByLabel("Подпись роли").fill("Владелец → CEO");
  await dialog.getByRole("button", { name: "Сохранить подпись" }).click();
  await expect(page.getByText("Подпись роли: только буквы, цифры, пробел, дефис, точка, запятая и скобки")).toBeVisible();
  await shot(page, "dialog");
  await dialog.getByRole("button", { name: "Отмена" }).click();
  await expect(dialog).toBeHidden();

  await setTitle(page, "Мурадян Арам", "ex-Владелец");
  await setTitle(page, "Головкин Владислав", "Владелец");
  await expect(page.getByTestId("role-muradyan")).toHaveText("ex-Владелец (главный)");
  await expect(page.getByTestId("role-golovkin")).toHaveText("Владелец");
  // Права главного не изменились: ссылка совладельцу и «Сделать главным» на месте, свои входом и паролем управляет сам
  await expect(page.getByRole("button", { name: "Ссылка для входа: Головкин Владислав" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Сделать главным владельцем: Головкин Владислав" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ссылка для входа: Мурадян Арам" })).toBeVisible();
  await page.getByTestId("role-golovkin").scrollIntoViewIfNeeded();
  await shot(page, "settings");

  // Шапка: меню профиля
  const menu = await profileMenu(page);
  await expect(menu).toContainText("Мурадян Арам");
  await expect(menu).toContainText("ex-Владелец");
  await shot(page, "menu");
  await page.keyboard.press("Escape");

  // Профиль
  await page.goto("/profile");
  await expect(page.locator("dd").filter({ hasText: "ex-Владелец" })).toHaveCount(1);
  await shot(page, "profile");

  // Журнал: было и стало
  await page.goto("/journal");
  await expect(page.getByText("было «Владелец, по умолчанию»").first()).toBeVisible();
  await expect(page.getByText("было «Совладелец, по умолчанию»").first()).toBeVisible();

  // Экран выбора себя по общему логину
  const team = await freshPage(browser, page);
  await team.goto("/login");
  await team.getByLabel("Логин").fill("team");
  await team.getByLabel("Пароль").fill(E2E_PASSWORDS.team);
  await team.getByRole("button", { name: "Войти" }).click();
  await expect(team).toHaveURL(/\/choose$/);
  await expect(team.getByRole("button", { name: /Мурадян Арам/ })).toContainText("ex-Владелец");
  await expect(team.getByRole("button", { name: /Головкин Владислав/ })).toContainText("Владелец");
  await expect(team.getByRole("button", { name: /Головкин Владислав/ })).not.toContainText("Совладелец");
  await shot(team, "choose");
  await team.context().close();

  // Совладелец с подписью «Владелец»: в шапке своя подпись, входом главного не управляет, подписи не задаёт
  const co = await freshPage(browser, page);
  await enterByLink(co, "golovkin");
  const coMenu = await profileMenu(co);
  await expect(coMenu).toContainText("Головкин Владислав");
  await expect(coMenu).toContainText("Владелец");
  await expect(coMenu).not.toContainText("Совладелец");
  await co.keyboard.press("Escape");
  if (test.info().project.name === "laptop") {
    // Без режима управления подпись видна прямо на кнопке профиля в боковой панели
    await expect(co.getByRole("button", { name: "Профиль: Головкин Владислав" }).filter({ visible: true })).toContainText("Владелец");
  }
  await enterManagement(co, "owner");
  await co.goto("/settings#people");
  await expect(co.getByTestId("role-muradyan")).toHaveText("ex-Владелец (главный)");
  await expect(co.getByRole("button", { name: /^Подпись роли:/ })).toHaveCount(0);
  await expect(co.getByRole("button", { name: "Ссылка для входа: Мурадян Арам" })).toHaveCount(0);
  await expect(co.getByRole("button", { name: "Завершить входы: Мурадян Арам" })).toHaveCount(0);
  await expect(co.getByRole("button", { name: "Сделать главным владельцем: Головкин Владислав" })).toHaveCount(0);
  await shot(co, "co-owner-settings");
  await co.context().close();

  // В базе: подписи в настройке, главный по-прежнему Мурадян
  const [titles] = await sql("SELECT value FROM settings WHERE key = 'owners.titles'");
  expect(titles.value).toEqual({ muradyan: "ex-Владелец", golovkin: "Владелец" });
  const [primary] = await sql("SELECT value FROM settings WHERE key = 'owner.primary'");
  expect(primary.value).toBe("muradyan");
});
