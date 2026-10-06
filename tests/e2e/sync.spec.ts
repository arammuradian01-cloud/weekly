import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 6: страница «Синхронизация» на имитации Google. Владелец подключает копию, выгружает, сверяет, пересобирает;
// сбой Google виден на странице и в шапке режима управления. Ноутбук 1440 и телефон 360

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
  await expect(page.getByRole("button", { name: "Выгрузить сейчас" })).toHaveCount(0);
  await shot(page, "01-not-connected");

  await page.getByLabel("Ссылка на копию таблицы").fill(PROD);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText(/этапе 7/).filter({ visible: true }).first()).toBeVisible();

  await page.getByLabel("Ссылка на копию таблицы").fill(COPY);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Копия подключена, доступ есть").first()).toBeVisible();
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
  await page.getByLabel("Ссылка на копию таблицы").fill(COPY);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Копия подключена, доступ есть").first()).toBeVisible();
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
