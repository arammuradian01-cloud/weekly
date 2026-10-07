// Личные входы (этап 9): ссылка от владельца, ссылка на почту, устройства в профиле, выключение общего логина
import { expect, test, type Browser, type Page } from "@playwright/test";
import { TEST_PASSWORD, enter, enterManagement, lastMailTo, linkFrom, resetDatabase, setPasswordByLink, sql } from "./helpers";

const SHOTS = "tests/e2e/screenshots";

test.beforeEach(async () => {
  await resetDatabase();
});

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-b-${name}.png`, fullPage: true });
}

/** Владелец в настройках выдаёт ссылку для входа и забирает её из окна */
async function issueInvite(owner: Page, fullName: string, screenshot?: string): Promise<string> {
  await owner.goto("/settings");
  await owner.getByRole("button", { name: `Ссылка для входа: ${fullName}` }).click();
  const dialog = owner.getByRole("dialog", { name: `Ссылка для входа: ${fullName}` });
  await expect(dialog).toBeVisible();
  const url = await dialog.getByLabel("Ссылка").inputValue();
  expect(url).toMatch(/\/login\/link\?t=[\w-]{40,}$/);
  if (screenshot) await owner.screenshot({ path: `${SHOTS}/${test.info().project.name}-b-${screenshot}.png` });
  await dialog.getByRole("button", { name: "Готово" }).click();
  return url;
}

async function freshPage(browser: Browser, like: Page): Promise<Page> {
  const context = await browser.newContext({ viewport: like.viewportSize() ?? undefined, locale: "ru-RU", timezoneId: "Europe/Moscow" });
  return context.newPage();
}

test("владелец выдаёт ссылку, человек входит под собой, видит свои устройства и выходит везде", async ({ page, browser }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  const url = await issueInvite(page, "Рева Тарас", "invite");

  const reva = await freshPage(browser, page);
  await reva.goto(url);
  await expect(reva.getByText(/Вы входите как/)).toContainText("Рева Тарас");
  await expect(reva.getByText("Ваш логин: reva")).toBeVisible();
  await shot(reva, "login-link");
  // Пароль придумывает сам человек: слабый не принимается, ссылка при этом не тратится
  await reva.getByLabel("Придумайте пароль").fill("12345678901");
  await reva.getByLabel("Повторите пароль").fill("12345678901");
  await reva.getByRole("button", { name: "Задать пароль и войти" }).click();
  await expect(reva.getByText(/только из цифр/)).toBeVisible();
  await setPasswordByLink(reva, url);

  // Профиль из списка не выбирается: «Сменить профиль» нет, есть «Профиль и входы»
  await reva.getByRole("button", { name: /^Профиль:/ }).filter({ visible: true }).first().click();
  await expect(reva.getByRole("menuitem", { name: "Сменить профиль" })).toHaveCount(0);
  await reva.getByRole("menuitem", { name: "Профиль и входы" }).click();
  await expect(reva).toHaveURL(/\/profile$/);
  await expect(reva.getByText("ссылка от владельца").first()).toBeVisible();
  await expect(reva.getByText("Это устройство")).toBeVisible();
  await reva.goto("/choose");
  await expect(reva).toHaveURL(/\/$/);
  await reva.goto("/profile");
  await expect(reva.getByRole("heading", { name: "Пароль" })).toBeVisible();
  await shot(reva, "profile");

  // Выход и вход с логином и паролем
  await reva.context().clearCookies();
  await reva.goto("/login");
  await reva.getByLabel("Логин").fill("reva");
  await reva.getByLabel("Пароль").fill("не тот пароль");
  await reva.getByRole("button", { name: "Войти" }).click();
  await expect(reva.getByText("Неверный логин или пароль")).toBeVisible();
  await reva.getByLabel("Пароль").fill(TEST_PASSWORD);
  await reva.getByRole("button", { name: "Войти" }).click();
  await expect(reva).toHaveURL(/\/$/);
  await reva.goto("/profile");
  await expect(reva.getByText("личный логин и пароль").first()).toBeVisible();

  // Ссылка второй раз не работает
  const other = await freshPage(browser, page);
  await other.goto(url);
  await expect(other.getByRole("heading", { name: "Ссылка не подходит" })).toBeVisible();
  await expect(other.getByText(/уже использована/)).toBeVisible();
  await other.context().close();

  // Владелец видит личный вход в списке людей, журнал пишет способ входа
  await page.goto("/settings");
  await expect(page.getByText(/Логин reva\. Пароль задан/)).toBeVisible();
  await page.goto("/journal?kind=login");
  await expect(page.getByText(/Личный вход: Рева/).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/личный вход/).filter({ visible: true }).first()).toBeVisible();

  // «Выйти на всех устройствах»: снова только по новой ссылке
  await reva.getByRole("button", { name: "Выйти на всех устройствах" }).click();
  await reva.getByRole("dialog").getByRole("button", { name: "Выйти везде" }).click();
  await expect(reva).toHaveURL(/\/login/);
  await reva.goto("/");
  await expect(reva).toHaveURL(/\/login/);
  expect((await sql("SELECT count(*)::int AS n FROM device_sessions WHERE \"revokedAt\" IS NULL"))[0].n).toBe(0);
  await reva.context().close();
});

test("ссылка на почту: человек с адресом в списке получает письмо и входит", async ({ page, browser }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/settings");
  await page.getByRole("button", { name: "Изменить: Фатьянов Евгений" }).click();
  await page.getByLabel("Рабочая почта").fill("Fatyanov@Sravni.ru");
  await page.locator("form").filter({ has: page.getByLabel("Рабочая почта") }).getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("fatyanov@sravni.ru.")).toBeVisible();

  const guest = await freshPage(browser, page);
  await guest.goto("/login");
  await expect(guest.getByRole("heading", { name: "Нет пароля" })).toBeVisible();
  await shot(guest, "login-both");
  await guest.getByLabel("Рабочая почта").fill("fatyanov@sravni.ru");
  await guest.getByRole("button", { name: "Прислать ссылку для входа" }).click();
  await expect(guest.getByText(/Если адрес есть в списке команды/)).toBeVisible();
  const mail = lastMailTo("fatyanov@sravni.ru");
  expect(mail?.subject).toBe("Вход в Weekly");
  await guest.goto(linkFrom(mail!.text));
  await guest.getByRole("button", { name: "Войти как Фатьянов Евгений" }).click();
  await expect(guest).toHaveURL(/\/$/);
  await guest.goto("/profile");
  await expect(guest.getByText("ссылка на почту").first()).toBeVisible();

  // Чужой адрес: тот же ответ, письма нет
  const stranger = await freshPage(browser, page);
  await stranger.goto("/login");
  await stranger.getByLabel("Рабочая почта").fill("nobody@sravni.ru");
  await stranger.getByRole("button", { name: "Прислать ссылку для входа" }).click();
  await expect(stranger.getByText(/Если адрес есть в списке команды/)).toBeVisible();
  expect(lastMailTo("nobody@sravni.ru")).toBeNull();
  await stranger.context().close();
  await guest.context().close();
});

test("владелец выключает общий логин только после своего личного входа", async ({ page, browser }) => {
  // Лидер вошёл по общему логину заранее
  const leader = await freshPage(browser, page);
  await enter(leader, "Рева Тарас");

  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Способ входа" }).getByRole("radio", { name: "Только личный" }).click();
  await expect(page.getByText(/Сначала войдите сами лично/).first()).toBeVisible();

  // Ссылка самому себе, вход по ней, режим управления заново
  const url = await issueInvite(page, "Мурадян Арам");
  await setPasswordByLink(page, url);
  await enterManagement(page, "owner");
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Способ входа" }).getByRole("radio", { name: "Только личный" }).click();
  await expect(page.getByText("Общий логин выключен")).toBeVisible();

  // Вход по общему логину больше не работает: старая сессия лидера уходит на экран входа, остаётся личный вход
  await leader.goto("/");
  await expect(leader).toHaveURL(/\/login/);
  await leader.getByLabel("Логин").fill("team");
  await leader.getByLabel("Пароль").fill("любой пароль");
  await leader.getByRole("button", { name: "Войти" }).click();
  await expect(leader.getByText(/Общий логин выключен/)).toBeVisible();
  await shot(leader, "login-personal-only");
  await leader.context().close();

  await page.getByRole("radiogroup", { name: "Способ входа" }).getByRole("radio", { name: "Общий и личный" }).click();
  await expect(page.getByText("Общий логин снова работает")).toBeVisible();
});
