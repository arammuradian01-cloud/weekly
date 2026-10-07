import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 22а: шаг «Что обещал на прошлой неделе» в сдаче weekly, перенос невыполненного в план, возврат в черновик,
// доля выполненных обещаний в отчёте CEO. И на ноутбуке, и на телефоне

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-pr-${name}.png`, fullPage: true });
}

/**
 * Записи Ревы в weekly прошлой недели: план и событие с «что делаем дальше». Отчётная неделя считается как в ресурсе:
 * срок сдачи в понедельник 18:00 по Москве, отчётная неделя сменяется через сутки после него
 */
async function lastWeekPlans() {
  const [{ prev }] = await sql(`
    WITH n AS (SELECT now() AT TIME ZONE 'Europe/Moscow' AS m),
    c AS (SELECT m, date_trunc('week', m)::date AS mon FROM n)
    SELECT to_char(CASE WHEN m < mon + interval '42 hours' THEN mon - 7 ELSE mon END - 7, 'YYYY-MM-DD') AS prev FROM c`);
  await sql(
    `INSERT INTO weeks (id, start, "isoYear", "isoNumber", deadline, "meetingDate")
     VALUES ('e2e-prev-week', $1::date, extract(isoyear FROM $1::date), extract(week FROM $1::date), (($1::date + 7) + time '18:00') AT TIME ZONE 'Europe/Moscow', $1::date + 8)
     ON CONFLICT (start) DO NOTHING`,
    [prev],
  );
  const [{ week }] = await sql(`SELECT id AS week FROM weeks WHERE start = $1::date`, [prev]);
  const [{ reva }] = await sql(`SELECT id AS reva FROM people WHERE slug = 'reva'`);
  const dict = async (kind: string, code: string) => (await sql(`SELECT id FROM dictionary_items WHERE kind = $1 AND code = $2`, [kind, code]))[0].id;
  const [dir, block, plan, event] = await Promise.all([dict("DIRECTION", "kasko"), dict("WEEKLY_BLOCK", "product"), dict("ENTRY_TYPE", "plan"), dict("ENTRY_TYPE", "event")]);
  const insert = `INSERT INTO weekly_entries (id, "weekId", "authorId", "directionId", "blockId", "typeId", what, next, "sortOrder", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`;
  await sql(insert, ["e2e-plan", week, reva, dir, block, plan, "Запустить скоринг на КАСКО", null, 0]);
  await sql(insert, ["e2e-next", week, reva, dir, block, event, "Запустили AB-тест рекомендаций", "Разобрать итоги AB-теста", 1]);
}

test.beforeEach(async () => {
  await resetDatabase();
  await lastWeekPlans();
});

test("лидер подводит итог прошлых планов, переносит невыполненное в план и возвращает сданный weekly в черновик", async ({ page }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/weekly/submit");
  await expect(page.getByRole("heading", { name: /Что обещал на прошлой неделе/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Планы прошлой недели/ })).toBeVisible();

  // План сделан: итог без фразы
  await page.getByRole("radiogroup", { name: "Итог: Запустить скоринг на КАСКО" }).getByRole("radio", { name: "Сделано", exact: true }).click();
  await page.locator("li").filter({ hasText: "Запустить скоринг на КАСКО" }).getByRole("button", { name: "Сохранить итог" }).click();
  await expect(page.getByText("Итог сохранён").first()).toBeVisible();

  // «Что делаем дальше» не сделано: без фразы не сохраняется, с фразой переносится в план этой недели
  const next = page.locator("li").filter({ hasText: "Разобрать итоги AB-теста" }).first();
  await expect(next.getByText("Что делаем дальше к записи «Запустили AB-тест рекомендаций»")).toBeVisible();
  await next.getByRole("radio", { name: "Не сделано", exact: true }).click();
  await next.getByRole("button", { name: "Сохранить итог" }).click();
  await expect(next.getByRole("alert")).toHaveText("Напишите одной фразой: что помешало");
  await page.locator("#promise-e2e-next-note").fill("Ждём данные от DWH");
  await next.getByRole("button", { name: "Сохранить итог" }).click();
  await expect(next.getByText("Ждём данные от DWH")).toBeVisible();
  await next.getByRole("button", { name: "Перенести в план этой недели" }).click();
  await expect(page.getByText("Перенесено в план этой недели").first()).toBeVisible();
  await expect(next.getByText("В плане этой недели: «Разобрать итоги AB-теста»")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Разобрать итоги AB-теста" })).toBeVisible();
  await shot(page, "promises");

  // После перезагрузки итоги на месте, перенести второй раз нельзя
  await page.reload();
  await expect(page.locator("li").filter({ hasText: "Запустить скоринг на КАСКО" }).getByText("Сделано", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Перенести в план этой недели" })).toHaveCount(0);
  await expect(page.getByText(/^Сделано 1 из 2: не сделано 1/)).toBeVisible();

  // Сдать и вернуть в черновик
  await page.getByLabel("Главное одной фразой").fill("Скоринг запущен, AB-тест разбираем на этой неделе");
  await expect(page.getByText(/Черновик сохранён в \d{2}:\d{2}/)).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "Сдать weekly" }).click();
  await expect(page.getByText(/Weekly сдан|Сдан с опозданием/).first()).toBeVisible();
  await page.getByRole("button", { name: "Вернуть в черновик" }).click();
  await expect(page.getByText("Weekly снова черновик: сдайте его, когда допишете")).toBeVisible();
  await expect(page.getByRole("button", { name: "Сдать weekly" })).toBeEnabled();
});

test("владелец видит долю выполненных обещаний в отчёте CEO", async ({ page }) => {
  // Неделя итога следует за прошлой: создаём её так же, как ресурс, и ставим плану итог «Сделано»
  await sql(
    `INSERT INTO weeks (id, start, "isoYear", "isoNumber", deadline, "meetingDate")
     SELECT 'e2e-week', p.start + 7, extract(isoyear FROM p.start + 7), extract(week FROM p.start + 7), ((p.start + 14) + time '18:00') AT TIME ZONE 'Europe/Moscow', p.start + 15
     FROM weeks p WHERE p.id = 'e2e-prev-week' ON CONFLICT (start) DO NOTHING`,
  );
  await sql(
    `INSERT INTO promise_reviews (id, "weekId", "authorId", "entryId", what, result, "updatedAt")
     SELECT 'e2e-review', w.id, e."authorId", e.id, e.what, 'DONE', now()
     FROM weekly_entries e JOIN weeks p ON p.id = e."weekId" JOIN weeks w ON w.start = p.start + 7
     WHERE e.id = 'e2e-plan'`,
  );
  const [{ key }] = await sql(`SELECT to_char(start + 7, 'YYYY-MM-DD') AS key FROM weeks WHERE id = 'e2e-prev-week'`);
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto(`/ceo-report?week=${key}`);
  const block = page.locator("section").filter({ has: page.getByRole("heading", { name: "Обещания недели" }) });
  await expect(block.getByText(/^Сделано \d+ из \d+ \(\d+%\)/).first()).toBeVisible();
  await expect(block.getByRole("listitem").filter({ hasText: "Тарас Р." })).toContainText(/Сделано \d+ из \d+/);
  await shot(page, "ceo-promises");
});
