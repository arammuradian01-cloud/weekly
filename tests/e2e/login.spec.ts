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
  await expect(reva.getByText("Ваш логин: treva")).toBeVisible();
  await shot(reva, "login-link");
  // Пароль придумывает сам человек: слабый не принимается, ссылка при этом не тратится
  await reva.getByLabel("Придумайте пароль").fill("12345678901");
  await reva.getByLabel("Повторите пароль").fill("12345678901");
  await reva.getByRole("button", { name: "Задать пароль и войти" }).click();
  await expect(reva.getByText(/только из цифр/)).toBeVisible();
  await setPasswordByLink(reva, url);

  // Профиль из списка не выбирается: «Сменить профиль» при личном входе выходит из системы (этап 71), есть «Профиль»
  await reva.getByRole("button", { name: /^Профиль:/ }).filter({ visible: true }).first().click();
  await expect(reva.getByRole("menuitem", { name: "Сменить профиль" })).toBeVisible();
  await reva.getByRole("menuitem", { name: "Профиль" }).click();
  await expect(reva).toHaveURL(/\/profile$/);
  await expect(reva.getByText("ссылка от владельца").first()).toBeVisible();
  await reva.goto("/choose");
  await expect(reva).toHaveURL(/\/$/);
  // Этап 48: пароль и устройства на вкладке «Вход и пароль»
  await reva.goto("/profile?tab=login");
  await expect(reva.getByRole("heading", { name: "Пароль" })).toBeVisible();
  await expect(reva.getByText("Это устройство")).toBeVisible();
  await shot(reva, "profile");

  // Выход и вход с логином и паролем
  await reva.context().clearCookies();
  await reva.goto("/login");
  await reva.getByLabel("Логин").fill("treva");
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
  await expect(page.getByTestId("access-reva")).toContainText(/Логин treva\. Пароль свой/);
  await page.goto("/journal?kind=login");
  await expect(page.getByText(/Личный вход: Рева/).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/личный вход/).filter({ visible: true }).first()).toBeVisible();

  // «Выйти на всех устройствах»: снова только по новой ссылке
  await reva.goto("/profile?tab=login");
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
  await expect(guest.getByRole("heading", { name: "Забыли пароль или его ещё нет" })).toBeVisible();
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

test("этап 52: первый вход показывает логин и предлагает рабочую почту, почта работает после ссылки из письма", async ({ page, browser }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  const url = await issueInvite(page, "Логинова Светлана");

  const svet = await freshPage(browser, page);
  await svet.goto(url);
  await expect(svet.getByText("Ваш логин: sloginova")).toBeVisible();
  await svet.getByLabel("Придумайте пароль").fill(TEST_PASSWORD);
  await svet.getByLabel("Повторите пароль").fill(TEST_PASSWORD);
  await svet.getByRole("button", { name: "Задать пароль и войти" }).click();
  await expect(svet).toHaveURL(/\/welcome\?new=1$/);
  await expect(svet.getByRole("heading", { name: /Добро пожаловать/ })).toBeVisible();
  await expect(svet.getByTestId("welcome-login")).toHaveText("sloginova");
  await shot(svet, "welcome");
  // Только рабочий домен; ошибка видна у формы, а не только всплывающим сообщением
  await svet.getByRole("textbox", { name: "Рабочая почта" }).fill("svet@gmail.com");
  await svet.getByLabel("Ваш пароль").fill(TEST_PASSWORD);
  await svet.getByRole("button", { name: "Прислать ссылку" }).click();
  await expect(svet.getByRole("alert").filter({ hasText: /Нужна рабочая почта/ })).toBeVisible();
  await svet.getByRole("textbox", { name: "Рабочая почта" }).fill("S.Loginova@sravni.ru");
  await svet.getByRole("button", { name: "Прислать ссылку" }).click();
  await expect(svet.getByTestId("email-pending")).toContainText("s.loginova@sravni.ru");
  const mail = lastMailTo("s.loginova@sravni.ru");
  expect(mail?.subject).toBe("Подтвердите почту для Weekly");
  await svet.getByTestId("welcome-start").click();
  await expect(svet).toHaveURL(/\/$/);

  // Ссылку из письма открывают на другом устройстве, без входа: подтверждение только по кнопке
  const phone = await freshPage(browser, page);
  await phone.goto(linkFrom(mail!.text));
  await expect(phone.getByRole("heading", { name: "Подтверждение почты" })).toBeVisible();
  // Чей вход и какой адрес, адрес скрыт наполовину
  await expect(phone.getByTestId("email-confirm-who")).toContainText("s***a@sravni.ru");
  await expect(phone.getByTestId("email-confirm-who")).toContainText("Логинова Светлана");
  await phone.getByRole("button", { name: "Подтвердить почту" }).click();
  await expect(phone.getByTestId("email-confirmed")).toContainText("s.loginova@sravni.ru");
  await phone.context().close();

  // Теперь по почте можно войти вместо логина
  await svet.context().clearCookies();
  await svet.goto("/login");
  await svet.getByLabel("Логин").fill("s.loginova@sravni.ru");
  await svet.getByLabel("Пароль").fill(TEST_PASSWORD);
  await svet.getByRole("button", { name: "Войти" }).click();
  await expect(svet).toHaveURL(/\/$/);
  await svet.goto("/profile?tab=login");
  await expect(svet.getByTestId("email-binding")).toContainText("Подтверждённая почта: s.loginova@sravni.ru");
  await svet.context().close();

  // Владелец видит логин, статус доступа и почту; ссылки пачкой выгружаются файлом
  await page.goto("/settings");
  await expect(page.getByTestId("access-loginova")).toContainText(/Логин sloginova\. Пароль свой.*Почта s\.loginova@sravni\.ru/);
  await page.getByLabel("Ссылки действуют").selectOption("14");
  await page.getByRole("button", { name: /Ссылки всем без пароля/ }).click();
  const dialog = page.getByRole("dialog", { name: /Ссылки для входа/ });
  await expect(dialog).toBeVisible();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Скачать CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/^weekly-ssylki-dlya-vhoda-\d{4}-\d{2}-\d{2}\.csv$/);
  await dialog.getByRole("button", { name: "Готово" }).click();
});
