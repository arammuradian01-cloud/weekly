import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 22б: факты недели в черновике weekly, благодарность коллеге, подсветка «В графике» без оснований.
// И на ноутбуке, и на телефоне

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-wf-${name}.png`, fullPage: true });
}

/** Отчётная неделя как в ресурсе: срок в понедельник 18:00 по Москве, неделя сменяется через сутки после него */
async function reportingKey(): Promise<string> {
  const [{ key }] = await sql(`
    WITH n AS (SELECT now() AT TIME ZONE 'Europe/Moscow' AS m),
    c AS (SELECT m, date_trunc('week', m)::date AS mon FROM n)
    SELECT to_char(CASE WHEN m < mon + interval '42 hours' THEN mon - 7 ELSE mon END, 'YYYY-MM-DD') AS key FROM c`);
  return key;
}

test.beforeEach(async () => {
  await resetDatabase();
  const key = await reportingKey();
  // Задача 29 Ревы закрыта в середине отчётной недели, задача 28 заблокирована
  await sql(
    `UPDATE tasks SET status = 'DONE', resolution = 'Сплит работает у двух СК', "closedAt" = (($1::date + 2) + time '12:00') AT TIME ZONE 'Europe/Moscow' WHERE number = 29`,
    [key],
  );
  await sql(`UPDATE tasks SET state = 'BLOCKED', "blockedBy" = 'Ждём доступ от СК' WHERE number = 28`);
  // Задача 7 «В графике», просрочена и две недели без обновлений
  await sql(`UPDATE tasks SET state = 'ON_TRACK', "whereUpdatedAt" = (now() AT TIME ZONE 'Europe/Moscow')::date - 15 WHERE number = 7`);
});

test("лидер добавляет факт недели записью, скрывает ненужный, благодарит коллегу; «В графике» без оснований подсвечено", async ({ page }) => {
  const thanksCount = async () =>
    (await sql(`SELECT count(*)::int AS count FROM inbox_events e JOIN people p ON p.id = e."recipientId" WHERE p.slug = 'loginova' AND e.kind = 'THANKS'`))[0].count as number;
  const before = await thanksCount();
  await enter(page, "Рева Тарас");
  await page.goto("/weekly/submit");
  const facts = page.getByRole("region", { name: /Из фактов недели/ });
  await expect(facts).toBeVisible();
  const [{ title }] = await sql(`SELECT title FROM tasks WHERE number = 29`);
  await facts.getByRole("button", { name: `Добавить записью: ${title}` }).click();
  await expect(page.getByText("Запись добавлена, её можно поправить").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(facts.getByRole("button", { name: `Добавить записью: ${title}` })).toHaveCount(0);

  const [{ blocked }] = await sql(`SELECT title AS blocked FROM tasks WHERE number = 28`);
  await facts.getByRole("button", { name: `Скрыть: Заблокирована: ${blocked}` }).click();
  await expect(page.getByRole("button", { name: `Скрыть: Заблокирована: ${blocked}` })).toHaveCount(0);

  // «В графике», но просрочена и давно без обновлений: в шаге «Обновить задачи» с подсказкой
  const [{ seven }] = await sql(`SELECT title AS seven FROM tasks WHERE number = 7`);
  const row = page.locator("li").filter({ hasText: seven }).first();
  await expect(row.getByText(/«В графике», но просрочена на \d+ дн\., 15 дн\. без обновлений/)).toBeVisible();
  await expect(row.getByText("В графике не подтверждено")).toBeVisible();

  // Благодарность сохраняется сама, коллега получает событие
  await page.getByLabel("Спасибо коллеге, если есть за что").fill("Спасибо @Логинова Светлана за выгрузку по убыткам");
  await expect(page.getByText("Благодарность сохранена")).toBeVisible({ timeout: 8000 });
  await shot(page, "submit");

  await page.reload();
  await expect(page.getByLabel("Спасибо коллеге, если есть за что")).toHaveValue("Спасибо @Логинова Светлана за выгрузку по убыткам");
  await expect(page.getByRole("button", { name: `Скрыть: Заблокирована: ${blocked}` })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  expect(await thanksCount()).toBe(before + 1);
});

test("благодарность видна в ленте и в отчёте CEO", async ({ page }) => {
  const key = await reportingKey();
  await sql(
    `INSERT INTO weeks (id, start, "isoYear", "isoNumber", deadline, "meetingDate")
     VALUES ('e2e-week', $1::date, extract(isoyear FROM $1::date), extract(week FROM $1::date), (($1::date + 7) + time '18:00') AT TIME ZONE 'Europe/Moscow', $1::date + 8)
     ON CONFLICT (start) DO NOTHING`,
    [key],
  );
  await sql(
    `INSERT INTO weekly_reports (id, "weekId", "authorId", headline, thanks, state, "submittedAt", "updatedAt")
     SELECT 'e2e-report', w.id, p.id, 'Главное недели', 'Спасибо Светлане Логиновой за выгрузку по убыткам', 'SUBMITTED', now(), now()
     FROM weeks w, people p WHERE w.start = $1::date AND p.slug = 'reva'`,
    [key],
  );
  // Лента показывает людей с записями: у Ревы одна запись
  await sql(
    `INSERT INTO weekly_entries (id, "weekId", "authorId", "directionId", "blockId", "typeId", what, "updatedAt")
     SELECT 'e2e-entry', w.id, p.id, d.id, b.id, t.id, 'Запустили сплит платежа', now()
     FROM weeks w, people p, dictionary_items d, dictionary_items b, dictionary_items t
     WHERE w.start = $1::date AND p.slug = 'reva' AND d.kind = 'DIRECTION' AND d.code = 'osago' AND b.kind = 'WEEKLY_BLOCK' AND b.code = 'product' AND t.kind = 'ENTRY_TYPE' AND t.code = 'event'`,
    [key],
  );
  await enter(page, "Мурадян Арам");
  await page.goto(`/weekly?week=${key}`);
  await expect(page.getByText("Спасибо Светлане Логиновой за выгрузку по убыткам")).toBeVisible();
  await enterManagement(page, "owner");
  await page.goto(`/ceo-report?week=${key}`);
  const block = page.getByRole("region", { name: "Благодарности" });
  await expect(block.getByRole("listitem").filter({ hasText: "Тарас Р." })).toContainText("Спасибо Светлане Логиновой за выгрузку по убыткам");
  await shot(page, "ceo");
});
