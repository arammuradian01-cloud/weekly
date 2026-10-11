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
  if (!(await details.first().evaluate((el) => (el as HTMLDetailsElement).open))) await details.first().locator("summary").click();
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
  await page.goto("/weekly/meeting");
  await page.getByRole("button", { name: "Собрать повестку" }).click();
  await expect(page.getByText("Повестка собрана").first()).toBeVisible();
  await expect(page.getByText(/^Повестка: \d+ пунктов/).filter({ visible: true }).first()).toBeVisible();
  await openAgenda(page);
  const nav = page.getByRole("navigation", { name: "Повестка" });
  await expect(nav.getByText(/Повестка: \d+ пунктов/)).toBeVisible();
  const [{ title }] = await sql(`SELECT title FROM tasks WHERE number = 28`);
  await expect(nav.getByRole("button", { name: new RegExp(`^Задача 28 заблокирована: ${title.slice(0, 20)}`) })).toBeVisible();

  // Ведущий начинает и переходит к пункту про задачу 28
  await page.getByRole("button", { name: "Начать встречу" }).click();
  await expect(page.getByText("Встреча началась").first()).toBeVisible();
  await expect(page.getByText(/Вы ведёте/)).toBeVisible();
  await openAgenda(page);
  await nav.getByRole("button", { name: /^Задача 28 заблокирована/ }).click();
  await expect(page.getByRole("heading", { name: /Задача 28 заблокирована/ })).toBeVisible();
  await expect(page.getByText("Ждём доступ от СК")).toBeVisible();

  // Участник видит тот же пункт и идёт за ведущим
  const reva = await second(browser, page, "Рева Тарас");
  await reva.goto("/weekly/meeting");
  await expect(reva.getByRole("heading", { name: /Задача 28 заблокирована/ })).toBeVisible();
  await expect(reva.getByText(/Экран идёт за ведущим: Арам/)).toBeVisible();
  await expect(reva.getByRole("button", { name: "Начать встречу" })).toHaveCount(0);

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
  await reva.goto("/me");
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
  await expect(page.getByRole("button", { name: "Из Notion" })).toHaveCount(0);

  await page.context().clearCookies();
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto(`/weekly/meeting?week=${key}`);
  await page.getByRole("button", { name: "Из Notion" }).click();
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
