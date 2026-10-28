import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 23: встреча 2.0. Владелец собирает повестку, ведёт встречу, участник идёт за ним, решение записывается,
// протокол собирается при закрытии, журнал решений ищет по словоформам. И на ноутбуке, и на телефоне

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-mt-${name}.png`, fullPage: true });
}

/** На телефоне повестка свёрнута: раскрываем, чтобы ходить по пунктам */
async function openAgenda(page: Page) {
  const details = page.locator("details").filter({ has: page.locator("summary", { hasText: /^Повестка:/ }) });
  if (!(await details.count()) || !(await details.first().isVisible())) return;
  // Только заголовок самой повестки: внутри неё с этапа 47 свои details у групп поручений
  if (!(await details.first().evaluate((el) => (el as HTMLDetailsElement).open))) await details.first().locator(":scope > summary").click();
}

async function second(browser: Browser, page: Page, fullName: string) {
  const ctx = await browser.newContext({ viewport: page.viewportSize() });
  const p = await ctx.newPage();
  await enter(p, fullName);
  return p;
}

test.beforeEach(async () => {
  await resetDatabase();
  // Задача 28 Ревы заблокирована: попадёт в повестку сама
  await sql(`UPDATE tasks SET state = 'BLOCKED', "blockedBy" = 'Ждём доступ от СК' WHERE number = 28`);
});

test("владелец собирает повестку, ведёт встречу, участник идёт за ним, решение и протокол", async ({ page, browser }) => {
  // Длинный сценарий двух людей: на нагруженной машине близко к 30 секундам по умолчанию
  test.setTimeout(60_000);
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  // Этот сценарий разбирает исторические поручения фикстуры: открываем её неделю явно.
  const [{ key }] = await sql(`SELECT to_char(w.start, 'YYYY-MM-DD') AS key FROM weeks w WHERE EXISTS (SELECT 1 FROM weekly_entries e WHERE e."weekId" = w.id) ORDER BY w.start DESC LIMIT 1`);
  await page.goto(`/weekly/meeting?week=${key}`);
  await page.getByRole("button", { name: "Собрать повестку" }).click();
  await expect(page.getByText("Повестка собрана").first()).toBeVisible();
  await expect(page.getByText(/^Повестка: \d+ пунктов/).filter({ visible: true }).first()).toBeVisible();
  await openAgenda(page);
  const nav = page.getByRole("navigation", { name: "Повестка" });
  // На телефоне строка «Повестка: N пунктов» одна, в заголовке свёрнутой повестки (этап 40); на ноутбуке она внутри повестки
  if (test.info().project.name !== "phone") await expect(nav.getByText(/Повестка: \d+ пунктов/)).toBeVisible();
  const [{ title }] = await sql(`SELECT title FROM tasks WHERE number = 28`);
  await expect(nav.getByRole("button", { name: new RegExp(`^Задача 28 заблокирована: ${title.slice(0, 20)}`) })).toBeVisible();
  // Этап 73б: переключатель недели над заголовком, номер недели в подписи не повторяется. На проекторе переключателя
  // нет: стрелка увела бы с экрана проектора, номер недели снова в подписи
  await expect(page.getByTestId("meeting-week")).toBeVisible();
  await expect(page.getByText(/^Неделя \d+, /)).toHaveCount(0);
  await page.goto(`/weekly/meeting?week=${key}&screen=projector`);
  await expect(page.getByRole("link", { name: "Для ноутбука" })).toBeVisible();
  await expect(page.getByTestId("meeting-week")).toHaveCount(0);
  await expect(page.getByText(/^Неделя \d+, /)).toBeVisible();
  await page.goto(`/weekly/meeting?week=${key}`);

  // Ведущий начинает и переходит к пункту про задачу 28
  await page.getByRole("button", { name: "Начать встречу" }).click();
  await expect(page.getByText("Встреча началась").first()).toBeVisible();
  await expect(page.getByText(/Вы ведёте/)).toBeVisible();
  // Пока встреча идёт, недели не листаются: переключателя нет, номер недели в подписи
  await expect(page.getByTestId("meeting-week")).toHaveCount(0);
  await expect(page.getByText(/^Неделя \d+, /)).toBeVisible();
  await openAgenda(page);

  // Этап 47: поручения прошлой встречи в повестке группами по человеку, в группе счёт поручений; поручение на экране
  // ведущего открывает карточку задачи с панелью действий, поля и комментарии свёрнуты. Группа с текущим пунктом раскрыта
  const groups = nav.locator("details.sv-agenda-group");
  expect(await groups.count()).toBeGreaterThanOrEqual(2);
  const group = groups.first();
  await expect(group.locator(":scope > summary")).toHaveText(/\d+ поручени/);
  if (!(await group.evaluate((el) => (el as HTMLDetailsElement).open))) await group.locator(":scope > summary").click();
  await group.getByRole("button").first().click();
  await expect(page.getByTestId("agenda-task-card")).toBeVisible();
  await expect(page.getByTestId("task-brief")).toBeVisible();
  await expect(page.getByText(/^(Где оно сейчас|Принимаем итог)\?$/)).toBeVisible();
  await expect(group).toHaveAttribute("open", "");
  // Кнопки ведущего над карточкой: «Обсуждено» видна без прокрутки до конца карточки
  await expect(page.getByRole("button", { name: "Обсуждено", exact: true })).toBeVisible();

  await openAgenda(page);
  await nav.getByRole("button", { name: /^Задача 28 заблокирована/ }).click();
  await expect(page.getByRole("heading", { name: /Задача 28 заблокирована/ })).toBeVisible();
  await expect(page.getByText("Ждём доступ от СК")).toBeVisible();

  // Участник видит тот же пункт и идёт за ведущим
  const reva = await second(browser, page, "Рева Тарас");
  await reva.goto(`/weekly/meeting?week=${key}`);
  await expect(reva.getByRole("heading", { name: /Задача 28 заблокирована/ })).toBeVisible();
  await expect(reva.getByText(/Экран идёт за ведущим: Арам/)).toBeVisible();
  await expect(reva.getByRole("button", { name: "Начать встречу" })).toHaveCount(0);
  await expect(reva.getByTestId("meeting-week")).toHaveCount(0);

  // Решение по пункту, пункт обсуждён
  await page.getByRole("button", { name: "Записать решение" }).click();
  const dialog = page.getByRole("dialog", { name: "Решение встречи" });
  await dialog.getByLabel("Что решили").fill("Доступ от СК запрашивает Тарас до пятницы");
  await dialog.getByLabel("Владелец решения, если есть").selectOption("reva");
  await dialog.getByRole("button", { name: "Записать" }).click();
  await expect(page.getByText("Решение записано").first()).toBeVisible();
  await expect(page.getByText("Доступ от СК запрашивает Тарас до пятницы")).toBeVisible();
  await page.getByRole("button", { name: "Обсуждено", exact: true }).click();
  await expect(page.getByText("Обсуждено", { exact: true }).first()).toBeVisible();
  await shot(page, "live");

  // Ведущий листает дальше: экран участника переходит сам
  await page.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Задача 28 заблокирована/ })).toHaveCount(0);
  const nextTitle = (await page.locator("section h2").first().textContent())!.trim();
  await expect(reva.getByRole("heading", { name: /Задача 28 заблокирована/ })).toHaveCount(0, { timeout: 15000 });
  await expect(reva.locator("section h2").first()).toHaveText(nextTitle);
  await reva.goto("/");
  await expect(reva.getByText(/Вы владелец решения встречи/).first()).toBeVisible();
  await reva.context().close();

  // Закрытие: протокол с решением
  await page.getByRole("button", { name: "Закрыть встречу" }).click();
  await page.getByRole("dialog", { name: "Закрыть встречу?" }).getByRole("button", { name: "Закрыть и отправить протокол" }).click();
  await expect(page.getByText("Встреча закрыта, протокол готов").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Протокол" })).toBeVisible();
  await expect(page.locator("pre")).toContainText("Решения\n- Доступ от СК запрашивает Тарас до пятницы. Владелец: Тарас");
  await shot(page, "protocol");

  // Журнал решений: поиск по словоформе
  await page.goto("/decisions");
  await expect(page.getByText("Доступ от СК запрашивает Тарас до пятницы")).toBeVisible();
  await page.getByPlaceholder("Поиск по словам").fill("доступа");
  await expect(page.getByText("Доступ от СК запрашивает Тарас до пятницы")).toBeVisible();
  await page.getByPlaceholder("Поиск по словам").fill("ипотека");
  await expect(page.getByText("Ничего не нашлось", { exact: true })).toBeVisible();
  await shot(page, "decisions");
});

test("лидер без режима управления видит повестку, но не ведёт; из Notion принимаются задача и решение", async ({ page }) => {
  await sql(`
    INSERT INTO weeks (id, start, "isoYear", "isoNumber", deadline, "meetingDate")
    WITH n AS (SELECT now() AT TIME ZONE 'Europe/Moscow' AS m), c AS (SELECT m, date_trunc('week', m)::date AS mon FROM n),
    k AS (SELECT CASE WHEN m < mon + interval '42 hours' THEN mon - 7 ELSE mon END AS key FROM c)
    SELECT 'e2e-week', key, extract(isoyear FROM key), extract(week FROM key), ((key + 7) + time '18:00') AT TIME ZONE 'Europe/Moscow', key + 8 FROM k
    ON CONFLICT (start) DO NOTHING`);
  await sql(`INSERT INTO meetings (id, "weekId", "teamId", date, "updatedAt") SELECT 'e2e-meeting', w.id, 'top', w."meetingDate", now() FROM weeks w ORDER BY start DESC LIMIT 1`);
  await sql(`INSERT INTO agenda_items (id, "meetingId", kind, title, "sortOrder", "updatedAt") VALUES ('e2e-item', 'e2e-meeting', 'MANUAL', 'Запускаем ли КАСКО для такси?', 1, now())`);
  // Лента без записей за отчётную неделю открыла бы прошлую: идём на неделю встречи явно
  const [{ key }] = await sql(`SELECT to_char(start, 'YYYY-MM-DD') AS key FROM weeks ORDER BY start DESC LIMIT 1`);

  await enter(page, "Рева Тарас");
  await page.goto(`/weekly/meeting?week=${key}`);
  await openAgenda(page);
  await expect(page.getByRole("navigation", { name: "Повестка" }).getByRole("button", { name: /^Запускаем ли КАСКО для такси/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Начать встречу" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Вставить текст" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Разобрать встречу из Notion" })).toHaveCount(0);

  await page.context().clearCookies();
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto(`/weekly/meeting?week=${key}`);
  await page.getByRole("button", { name: "Вставить текст" }).click();
  const dialog = page.getByRole("dialog", { name: "Приём из Notion" });
  await dialog.getByLabel("Текст разбора").fill("- Решили: пилот КАСКО для такси в ноябре\n- @Логинова прислать выгрузку по убыткам до пятницы");
  await dialog.getByRole("button", { name: "Разобрать" }).click();
  await expect(dialog.getByRole("radio", { name: "Решение", checked: true })).toBeVisible();
  await expect(dialog.getByLabel("Ответственный")).toHaveValue("loginova");
  await dialog.getByRole("button", { name: /Принять выбранное: 2/ }).click();
  await expect(page.getByText("Принято: задач 1, решений 1").first()).toBeVisible();
  await openAgenda(page);
  await expect(page.getByRole("navigation", { name: "Повестка" }).getByRole("button", { name: /^Решения/ })).toContainText("1");
  const [{ count }] = await sql(`SELECT count(*)::int AS count FROM tasks WHERE title = 'прислать выгрузку по убыткам до пятницы' AND "sourceCode" = 'meeting'`);
  expect(count).toBe(1);
  await shot(page, "notion");
});
