import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 6: страница «Синхронизация» на имитации Google. Владелец подключает таблицу для просмотра, выгружает, сверяет, пересобирает;
// сбой Google виден на странице и в шапке режима управления. Этап 12: забор задач из рабочего Bord. Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });
const COPY = "https://docs.google.com/spreadsheets/d/1CopyOfBordForE2E_abcdefghijklmnop/edit?gid=0#gid=0";
const PROD = "https://docs.google.com/spreadsheets/d/1ASfJQp1_sjEEqQPt49y7uL4edxX0WHMagRRfXZb4_Hs/edit?gid=397729751#gid=397729751";

test.beforeEach(async () => {
  await resetDatabase();
});
test.afterEach(async () => {
  // Отключаем копию: фоновый цикл не должен писать во время других тестов
  await sql(`UPDATE settings SET value = 'null'::jsonb WHERE key = 'sheet.spreadsheetId'`);
  await sql("DELETE FROM settings WHERE key = 'sheet.imitationDown'");
  await sql("DELETE FROM settings WHERE key LIKE 'bord.%'");
});

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-s-${name}.png`, fullPage: true });
}

test("владелец подключает копию, выгружает, сверяет и пересобирает вкладки; рабочую таблицу подключить нельзя", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/sync");
  await expect(page.getByText("Режим имитации")).toBeVisible();
  await expect(page.getByText("не подключена", { exact: true })).toBeVisible();
  await expect(page.getByText("забор выключен", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Выгрузить сейчас" })).toHaveCount(0);
  await shot(page, "01-not-connected");

  await page.getByRole("textbox", { name: "Ссылка на таблицу для просмотра" }).fill(PROD);
  await page.getByRole("form", { name: "Ссылка на таблицу для просмотра" }).getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText(/Это рабочий Bord. Ресурс в него не пишет/).filter({ visible: true }).first()).toBeVisible();

  await page.getByRole("textbox", { name: "Ссылка на таблицу для просмотра" }).fill(COPY);
  await page.getByRole("form", { name: "Ссылка на таблицу для просмотра" }).getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Таблица подключена, доступ есть").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Выгрузить сейчас" })).toBeVisible();

  await page.getByRole("button", { name: "Выгрузить сейчас" }).click();
  await expect(page.getByText(/^(Выгружено: \d+ строк|Таблица уже совпадает с ресурсом)/).first()).toBeVisible();
  await expect(page.getByText("только что").first()).toBeVisible();

  await page.getByRole("button", { name: "Сверить сейчас" }).click();
  await expect(page.getByText("Сверка: расхождений нет").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("расхождений нет").first()).toBeVisible();

  await page.getByRole("button", { name: "Пересобрать вкладки" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Пересобрать" }).click();
  await expect(page.getByText(/^Вкладки пересобраны: \d+/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("Пересборка").filter({ visible: true }).first()).toBeVisible();
  await shot(page, "02-connected");

  await page.goto("/journal?kind=sync");
  await expect(page.getByText("Google-таблица: подключение").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("Google-таблица: все вкладки").filter({ visible: true }).first()).toBeVisible();

  await page.goto("/sync");
  await page.getByRole("button", { name: "Отключить" }).click();
  await expect(page.getByText("Таблица отключена").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Выгрузить сейчас" })).toHaveCount(0);
});

test("сбой Google: ошибка на странице, правки ждут в очереди, через 30 минут предупреждение в шапке режима управления", async ({ page, browser }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/sync");
  await page.getByRole("textbox", { name: "Ссылка на таблицу для просмотра" }).fill(COPY);
  await page.getByRole("form", { name: "Ссылка на таблицу для просмотра" }).getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Таблица подключена, доступ есть").first()).toBeVisible();
  await page.getByRole("button", { name: "Выгрузить сейчас" }).click();
  await expect(page.getByText(/^(Выгружено|Таблица уже совпадает)/).first()).toBeVisible();

  await sql(`INSERT INTO settings (key, value, "updatedAt") VALUES ('sheet.imitationDown', 'true'::jsonb, now())`);
  await sql(`INSERT INTO sheet_outbox (kind, key, at) SELECT 'task', number::text, now() - interval '31 minutes' FROM tasks ORDER BY number LIMIT 1`);
  await page.getByRole("button", { name: "Выгрузить сейчас" }).click();
  await expect(page.getByText(/Google не ответил/).filter({ visible: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "Выгрузка не прошла" })).toBeVisible();
  await expect(page.getByText("Самая старая правка ждёт 31 мин")).toBeVisible();
  await expect(page.getByText(/Правки не уходят в Google-таблицу больше 30 минут/)).toBeVisible();
  await shot(page, "03-google-down");

  // Лидер без режима управления предупреждения не видит
  const leader = await browser.newPage();
  await enter(leader, "Рева Тарас");
  await expect(leader.getByText(/Правки не уходят в Google-таблицу/)).toHaveCount(0);
  await leader.close();

  // Google вернулся: очередь уходит, ошибка и предупреждение пропадают
  await sql("DELETE FROM settings WHERE key = 'sheet.imitationDown'");
  await page.getByRole("button", { name: "Выгрузить сейчас" }).click();
  await expect(page.getByText(/^Выгружено: \d+/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "не прошла" })).toHaveCount(0);
  await expect(page.getByText(/Правки не уходят в Google-таблицу/)).toHaveCount(0);
});

test("владелец подключает рабочий Bord на чтение и забирает задачи: новая задача, правка из Bord, номера задач ресурса от 1001", async ({ page }) => {
  // Прошлый забор был только что: фоновый цикл не заберёт сам посреди теста, забираем кнопкой
  await sql(`INSERT INTO settings (key, value, "updatedAt") VALUES ('bord.pull', jsonb_build_object('lastAttemptAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'ok', true, 'history', '[]'::jsonb), now())`);
  // В ресурсе: задачу 51 удалили, у задачи 1 поменяли название, задачу завели в ресурсе под номером 52
  await sql("DELETE FROM tasks WHERE number = 51");
  await sql("UPDATE tasks SET title = 'Название из ресурса' WHERE number = 1");
  await sql(`INSERT INTO tasks (id, number, title, outcome, "ownerId", "directionId", status, "whereUpdatedAt", due, "originalDue", "updatedAt")
    SELECT 'e2e-own-task', 52, 'Задача, заведённая в ресурсе', 'Готово', p.id, d.id, 'IN_PROGRESS', current_date, current_date + 7, current_date + 7, now()
    FROM people p, dictionary_items d WHERE p.slug = 'reva' AND d.kind = 'DIRECTION' AND d.code = 'product'`);

  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/sync");
  await expect(page.getByRole("heading", { name: "Задачи из Bord" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Забрать сейчас" })).toHaveCount(0);

  await page.getByRole("textbox", { name: "Ссылка на Bord" }).fill(PROD);
  await page.getByRole("form", { name: "Ссылка на Bord" }).getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Bord подключён, доступ на чтение есть").first()).toBeVisible();
  await expect(page.getByText("рабочий Insurance&Invest Bord")).toBeVisible();

  await page.getByRole("button", { name: "Забрать сейчас" }).click();
  await expect(page.getByText("Из Bord: новых 1, изменено 1").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("Новые задачи из Bord: 1 задача")).toBeVisible();
  await expect(page.getByText("Задачи ресурса получили новые номера: 1")).toBeVisible();
  await expect(page.getByText(/52 стала 1001/)).toBeVisible();
  await shot(page, "04-bord-pull");

  await page.goto("/tasks/1");
  await expect(page.getByText("Отправить образец борда лидера").first()).toBeVisible();
  await page.goto("/tasks/1001");
  await expect(page.getByText("Задача, заведённая в ресурсе").first()).toBeVisible();
  await page.goto("/journal?kind=task");
  await expect(page.getByText(/было «Название из ресурса»/).filter({ visible: true }).first()).toBeVisible();

  await page.goto("/sync");
  await page.getByRole("button", { name: "Выключить забор" }).click();
  await expect(page.getByText("Забор из Bord выключен").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Забрать сейчас" })).toHaveCount(0);
});
