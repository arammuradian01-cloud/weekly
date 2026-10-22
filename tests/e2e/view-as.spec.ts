import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 63: «Смотреть как». Владелец при личном входе в режиме управления выбирает Реву в меню профиля, видит его
// «Мою неделю» и его черновик weekly, плашку «Вы смотрите как Рева Тарас. Изменения недоступны». Сдать weekly и
// поставить задачу нельзя: сервер отказывает одним текстом, в базе ничего не меняется. «Выйти из просмотра»
// возвращает к себе, начало и конец просмотра в журнале. Обычная вторая вкладка владельца при начале просмотра
// закрывается плашкой «В другой вкладке начат просмотр» с кнопкой «Обновить», вкладка просмотра при его конце
// перезагружается сама. Встречи один на один и анонимная оценка встреч в просмотре закрыты. Плашка липкая, на телефоне
// короткая строка, в шапке значок просмотра, в названии вкладки «Как <ФИО>».
// Общий логин пункта не видит ни в меню, ни в командной строке. Ноутбук 1440 и телефон 360 без горизонтальной прокрутки

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

const DENIED = "В режиме «Смотреть как» изменения недоступны";
const ENTRY = "Рева: два партнёра готовы к пилоту";

const isPhone = () => test.info().project.name === "phone";

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-view-as-${name}.png`, fullPage: true });
}

/** Меню профиля: на ноутбуке в боковой панели, на телефоне в шапке, видно ровно одно */
async function openProfileMenu(page: Page) {
  await page.getByRole("button", { name: /^Профиль:/ }).filter({ visible: true }).first().click();
}

async function newContextPage(browser: Browser, page: Page) {
  return (await browser.newContext({ viewport: page.viewportSize()!, isMobile: isPhone(), hasTouch: isPhone() })).newPage();
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("владелец смотрит как Рева: его неделя и weekly, изменения отказывают, выход возвращает к себе", async ({ page, browser }) => {
  test.setTimeout(150_000);
  // Журнал только дописывается: записи этого теста считаем от последней записи до него
  const [{ mark }] = await sql(`SELECT coalesce(max(id), 0)::text AS mark FROM audit_log`);
  // Рева сам заводит черновик записи weekly: в просмотре владелец увидит его и попробует сдать
  const reva = await newContextPage(browser, page);
  await enter(reva, "Рева Тарас");
  await reva.goto("/weekly/submit");
  await reva.getByLabel("Главное одной фразой").fill("Неделя пилотов с партнёрами");
  await expect(reva.getByText(/Черновик сохранён в \d{2}:\d{2}/)).toBeVisible({ timeout: 8000 });
  await reva.getByRole("button", { name: "Добавить запись" }).click();
  await reva.getByLabel("Что произошло").fill(ENTRY);
  await expect(reva.getByText("Черновик записи сохранён")).toBeVisible({ timeout: 8000 });
  await reva.context().close();

  await enterByLink(page, "muradyan");
  await enterManagement(page, "owner");
  // Вторая вкладка того же браузера: владелец у себя
  const second = await page.context().newPage();
  await second.goto("/");
  await expect(second.getByRole("heading", { level: 1 })).toContainText("Арам");

  await openProfileMenu(page);
  await page.getByRole("menuitem", { name: "Смотреть как…" }).click();

  const dialog = page.getByRole("dialog", { name: "Смотреть как" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Все люди компании: \d+/)).toBeVisible();
  // Себя в списке нет, выключенных тоже
  await expect(dialog.getByRole("button", { name: /Мурадян Арам/ })).toHaveCount(0);
  await dialog.getByLabel("Поиск по ФИО, должности или подразделению").fill("рева");
  await expect(dialog.getByText("Нашлось 1 человек")).toBeVisible();
  await shot(page, "dialog");
  await dialog.getByRole("button", { name: /Рева Тарас/ }).click();

  // «Моя неделя» Ревы и плашка над страницей
  await expect(page).toHaveURL(/\/$/);
  const banner = page.getByTestId("view-as-banner");
  await expect(banner).toContainText("Вы смотрите как Рева Тарас. Изменения недоступны");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Тарас");
  await expect(page.getByRole("heading", { name: /Мой weekly за неделю/ })).toBeVisible();
  // Обычная вкладка владельца сама не перезагружается (в ней мог быть набранный текст): её закрывает плашка с «Обновить»
  await expect(second.getByTestId("view-as-elsewhere")).toBeVisible();
  await expect(second.getByRole("heading", { name: "В другой вкладке начат просмотр" })).toBeVisible();
  await second.getByRole("button", { name: "Обновить" }).click();
  await expect(second.getByTestId("view-as-banner")).toContainText("Вы смотрите как Рева Тарас");
  // В названии вкладки пометка, чьими глазами она показана
  await expect(page).toHaveTitle(/^Как Рева Тарас/);
  // Плашка прилипает под шапкой; на телефоне короткая строка (короткое имя и время), в шапке значок просмотра
  await expect(banner).toHaveCSS("position", "sticky");
  if (isPhone()) await expect(banner.getByText(/^Как Тарас, до \d{2}:\d{2}\. Только просмотр$/)).toBeVisible();
  await expect(page.getByTestId("view-as-badge").filter({ visible: true })).toHaveCount(isPhone() ? 1 : 0);
  // Режим управления в просмотре выключен: в меню профиля нет «Журнала» и выключения режима
  await openProfileMenu(page);
  await expect(page.getByRole("menuitem", { name: "Выйти из просмотра" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Выключить режим управления" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Смотреть как…" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await shot(page, "my-week");

  // Встречи один на один и анонимная оценка встреч в просмотре закрыты
  await page.goto("/one-on-one");
  await expect(page.getByText("Встречи один на один в просмотре закрыты")).toBeVisible();
  await page.goto("/meeting-rating");
  await expect(page.getByText("Оценка встреч в просмотре закрыта")).toBeVisible();

  // Сдать weekly Ревы нельзя: черновик виден, сдача отказывает
  await page.goto("/weekly/submit");
  await expect(page.getByTestId("view-as-banner")).toBeVisible();
  await expect(page.getByRole("heading", { name: ENTRY })).toBeVisible();
  await page.getByRole("button", { name: "Сдать weekly" }).click();
  await expect(page.getByText(DENIED).first()).toBeVisible();
  await shot(page, "submit-denied");
  // Только weekly той недели, где черновик Ревы: прошлые недели из выгрузки Bord сданы и так
  expect(await sql(`SELECT r.state FROM weekly_reports r JOIN weekly_entries e ON e."weekId" = r."weekId" AND e."authorId" = r."authorId" WHERE e.what = $1`, [ENTRY])).toEqual([{ state: "DRAFT" }]);

  // Поставить задачу нельзя
  await page.goto("/tasks");
  await page.keyboard.press("n");
  const form = page.getByRole("dialog", { name: "Новая задача" });
  await form.getByLabel("Задача", { exact: true }).fill("Задача из просмотра");
  await form.getByLabel("Что нужно сделать").fill("Проверить отказ");
  await form.getByRole("button", { name: /Поставить задачу|Предложить задачу/ }).click();
  await expect(form.getByRole("alert")).toContainText(DENIED);
  expect(await sql(`SELECT number FROM tasks WHERE title = 'Задача из просмотра'`)).toEqual([]);
  await page.keyboard.press("Escape");

  // Выход из просмотра: снова владелец в режиме управления
  await page.getByTestId("view-as-banner").getByRole("button", { name: "Выйти из просмотра" }).click();
  await expect(page.getByTestId("view-as-banner")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Арам");
  await openProfileMenu(page);
  await expect(page.getByRole("menuitem", { name: "Выключить режим управления" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Вторая вкладка, показывавшая просмотр, перезагрузилась сама и снова показывает владельца
  await expect(page).not.toHaveTitle(/Как Рева Тарас/);
  await expect(second.getByTestId("view-as-banner")).toHaveCount(0);
  await expect(second.getByRole("heading", { level: 1 })).toContainText("Арам");
  await second.close();

  const journal = await sql(`SELECT action, "entityId" FROM audit_log WHERE action LIKE 'viewAs.%' AND id > $1::bigint ORDER BY id`, [mark]);
  expect(journal).toEqual([
    { action: "viewAs.start", entityId: "reva" },
    { action: "viewAs.stop", entityId: "reva" },
  ]);
  await shot(page, "back");
});

test("общий логин не видит «Смотреть как» ни в меню, ни в командной строке, даже в режиме управления", async ({ page }) => {
  // Этап 71: владелец по общему логину режим управления не включает, поэтому общий логин здесь у администратора в режиме
  // управления
  await enter(page, "Головкин Владислав");
  await enterManagement(page, "admin");
  await openProfileMenu(page);
  await expect(page.getByRole("menuitem", { name: "Выключить режим управления" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Смотреть как…" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Командная строка" });
  await palette.getByRole("combobox", { name: "Поиск и действия" }).fill("смотреть как");
  await expect(palette.getByRole("option", { name: /Смотреть как/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("view-as-banner")).toHaveCount(0);
  await shot(page, "team-login");
});

test("владелец открывает «Смотреть как» из командной строки", async ({ page }) => {
  await enterByLink(page, "muradyan");
  await enterManagement(page, "owner");
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Командная строка" });
  await palette.getByRole("combobox", { name: "Поиск и действия" }).fill("смотреть как");
  await palette.getByRole("option", { name: /Смотреть как/ }).click();
  const dialog = page.getByRole("dialog", { name: "Смотреть как" });
  await dialog.getByLabel("Поиск по ФИО, должности или подразделению").fill("головкин");
  await dialog.getByLabel("Поиск по ФИО, должности или подразделению").press("Enter");
  await expect(page.getByTestId("view-as-banner")).toContainText("Вы смотрите как Головкин Владислав");
});
