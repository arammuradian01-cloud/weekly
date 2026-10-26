import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Искусственные отправленные снимки: проверяем именно экран получателя, включая CEO в режиме управления.
// Этап 73 (решение Арама 26.10): экран получателя это вкладка «Полученные» раздела «Отчёт руководителю», старый адрес
// /weekly/received ведёт туда.
let key: string;
let weekId: string;
let ceoRole: string;
const id = async (slug: string) => (await sql("SELECT id FROM people WHERE slug = $1", [slug]))[0]!.id as string;
test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
  ceoRole = (await sql("SELECT role FROM people WHERE slug = 'ceo'"))[0]!.role as string;
  await sql("DELETE FROM weekly_entries WHERE id = 'test-73a-promoted'");
  await sql("DELETE FROM team_weekly_reports");
  await sql("DELETE FROM ceo_reports");
  const date = new Date(Date.now() + 3 * 3600_000);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) - 7);
  key = date.toISOString().slice(0, 10);
  weekId = `test-73a-${key}`;
  await sql(`INSERT INTO weeks (id, start, "isoYear", "isoNumber", deadline, "meetingDate") VALUES ($1, $2::date, EXTRACT(ISOYEAR FROM $2::date), EXTRACT(WEEK FROM $2::date), $2::date + interval '7 days 15 hours', $2::date + 8) ON CONFLICT (start) DO NOTHING`, [weekId, key]);
  weekId = (await sql("SELECT id FROM weeks WHERE start = $1::date", [key]))[0]!.id as string;
});
test.afterEach(async () => {
  await sql("UPDATE people SET role = $1 WHERE slug = 'ceo'", [ceoRole]);
});
async function shot(page: Page, suffix: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  mkdirSync("tests/e2e/screenshots", { recursive: true });
  await page.screenshot({ path: `tests/e2e/screenshots/${test.info().project.name}-received-${suffix}.png`, fullPage: true });
}

test("CEO читает отправленную версию в «Полученных» даже в режиме управления; пустая неделя не показывает чужую неделю", async ({ page }) => {
  await sql("UPDATE people SET active = true, role = 'OWNER' WHERE slug = 'ceo'");
  const recipient = await id("ceo");
  await sql(`INSERT INTO ceo_reports (id, "weekId", main, risks, next, "updatedAt", "sentAt", "sentById", "sentTo", "sentSnapshot") VALUES ('test-73a-ceo', $1, 'Новая неотправленная правка CEO', '', '', now(), now() - interval '1 minute', $2, $3::jsonb, $4::jsonb)`, [weekId, await id("muradyan"), JSON.stringify([{ id: recipient, name: "CEO" }]), JSON.stringify({ main: "Отправленный итог для CEO", risks: "Отправленные риски CEO", next: "План следующей недели", meetings: [] })]);
  await enterByLink(page, "ceo");
  await enterManagement(page, "owner");
  await page.goto(`/weekly/received?week=${key}`);
  await expect(page).toHaveURL(new RegExp(`/leader-report\\?tab=received&week=${key}$`));
  await page.getByTestId("lr-received-top").getByRole("link", { name: "Открыть отчёт" }).click();
  const sent = page.getByTestId("sent-report");
  await expect(sent).toContainText("Отправленный итог для CEO");
  await expect(sent).toContainText("здесь отправленная вам версия");
  await expect(page.getByText("Новая неотправленная правка CEO", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Отправить руководителю/ })).toHaveCount(0);
  await shot(page, "ceo");
  await page.getByRole("link", { name: "Предыдущая неделя", exact: true }).click();
  await expect(page.getByTestId("lr-received-top")).toContainText("Ещё не отправлен");
  await expect(page.getByTestId("sent-report")).toHaveCount(0);
});

test("руководитель читает сотрудников и полученные отчёты команд; сотрудник видит получателя при сдаче, общий вход не открывает входящие", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const leader = await id("reva");
  const member = await id("cheychenets");
  const draft = await id("afanasyev");
  await sql(`INSERT INTO teams (id, name, kind, "leaderId", "specialistsWeekly", "updatedAt") VALUES ('test-73a-team', 'Продуктовая команда', 'CUSTOM', $1, true, now()), ('test-73a-source', 'Команда продаж', 'CUSTOM', $2, true, now())`, [leader, await id("golovkin")]);
  await sql(`INSERT INTO team_members ("teamId", "personId") VALUES ('test-73a-team', $1), ('test-73a-team', $2)`, [member, draft]);
  await sql(`INSERT INTO weekly_reports (id, "weekId", "authorId", headline, state, "submittedAt", "updatedAt") VALUES ('test-73a-person', $1, $2, 'Запустили витрину вкладов', 'SUBMITTED', now(), now()), ('test-73a-draft', $1, $3, 'Секретный черновик теста', 'DRAFT', NULL, now()) ON CONFLICT ("weekId", "authorId") DO UPDATE SET headline = EXCLUDED.headline, state = EXCLUDED.state, "submittedAt" = EXCLUDED."submittedAt"`, [weekId, member, draft]);
  await sql(`INSERT INTO team_weekly_reports (id, "teamId", "weekId", blocks, "updatedAt", "sentAt", "sentById", "sentTo", "sentSnapshot") VALUES ('test-73a-sent', 'test-73a-source', $1, '[]', now(), now() - interval '1 minute', $2, $3::jsonb, $4::jsonb)`, [weekId, await id("golovkin"), JSON.stringify([{ id: leader, name: "Рева Тарас" }]), JSON.stringify([{ key: "risks", title: "Риски", lines: [{ text: "Отправленный риск команды продаж" }] }])]);
  await sql(`INSERT INTO weekly_entries (id, "weekId", "authorId", "directionId", "blockId", "typeId", what, "updatedAt")
    SELECT 'test-73a-promoted', $1, $2,
      (SELECT id FROM dictionary_items WHERE kind = 'DIRECTION' AND active LIMIT 1),
      (SELECT id FROM dictionary_items WHERE kind = 'WEEKLY_BLOCK' AND active LIMIT 1),
      (SELECT id FROM dictionary_items WHERE kind = 'ENTRY_TYPE' AND active LIMIT 1), 'Итог команды ниже', now()`, [weekId, await id("golovkin")]);
  await sql(`INSERT INTO weekly_promotions (id, "entryId", "byId", note) VALUES ('test-73a-promote-1','test-73a-promoted',$1,'Пояснение для моего руководителя'), ('test-73a-promote-2','test-73a-promoted',$2,'Секретное несданное пояснение')`, [member, draft]);
  await enterByLink(page, "reva");
  const response = await page.goto(`/leader-report?tab=received&week=${key}`);
  const html = await response!.text();
  expect(html).not.toContain("Секретный черновик теста");
  expect(html).not.toContain("Секретное несданное пояснение");
  await expect(page.getByTestId("team-submission-summary")).toContainText("Сдали 1 из 2");
  const person = page.getByTestId("received-person-cheychenets");
  await person.locator("summary").click();
  await expect(person).toContainText("Запустили витрину вкладов");
  await expect(person).toContainText("От себя: Пояснение для моего руководителя");
  await expect(page.getByTestId("received-person-afanasyev")).toContainText("черновик, ещё не сдан");
  await expect(page.getByTestId("lr-received-test-73a-source")).toContainText("Команда продаж");
  await shot(page, "leader");
  await page.getByTestId("lr-received-test-73a-source").getByRole("link", { name: "Открыть отчёт" }).click();
  await expect(page.getByText("Отправленный риск команды продаж", { exact: true })).toBeVisible();

  const context = await browser.newContext({ viewport: page.viewportSize()!, isMobile: test.info().project.name === "phone", hasTouch: test.info().project.name === "phone" });
  const employee = await context.newPage();
  await enterByLink(employee, "cheychenets");
  await employee.goto("/weekly/submit");
  await expect(employee.getByTestId("weekly-delivery")).toContainText("Рева Тарас");
  await expect(employee.getByRole("link", { name: "Отчёт руководителю" })).toHaveCount(0);
  await employee.goto(`/weekly/received?week=${key}`);
  await expect(employee.getByText("Раздел для руководителей команд", { exact: true })).toBeVisible();
  await context.close();
  // Отключение доступа не удаляет уже сданный weekly из архива и не увеличивает число ожидаемых отчётов.
  await sql("UPDATE people SET active = false WHERE id = $1", [member]);
  await page.goto(`/weekly/received?week=${key}&team=test-73a-team`);
  await expect(person).toContainText("доступ отключён");
  await person.locator("summary").click();
  await expect(person).toContainText("Запустили витрину вкладов");
  await expect(person).toContainText("От себя: Пояснение для моего руководителя");
  await expect(page.getByTestId("team-submission-summary")).toContainText("Сдали 0 из 1. Ждём: 1");
  await sql("UPDATE people SET active = false WHERE id = $1", [draft]);
  await page.reload();
  await expect(page.getByTestId("received-person-afanasyev")).toHaveCount(0);
  await expect(page.getByTestId("team-submission-summary")).toContainText("Сдали 0 из 0. Ждём: 0");
  await shot(page, "inactive-archive");
  const shared = await browser.newContext({ viewport: page.viewportSize()! });
  const sharedPage = await shared.newPage();
  await enter(sharedPage, "Мурадян Арам");
  await sharedPage.goto(`/weekly/received?week=${key}`);
  await expect(sharedPage.getByText(/при личном входе/)).toBeVisible();
  await shared.close();
});
