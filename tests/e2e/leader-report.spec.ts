import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enterByLink, enterTeam, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 73+81: раздел «Отчёт руководителю» отдельным пунктом меню, внутри «Отправленные» и «Полученные». Получатель
// пишет комментарий к полученному отчёту, автор отвечает. Участник команды и общий логин раздел не видят.
// Отправленный снимок создаётся запросом: проверяем сам раздел, а не ещё раз отправку этапа 66.

let key: string;
let weekId: string;
const id = async (slug: string) => (await sql("SELECT id FROM people WHERE slug = $1", [slug]))[0]!.id as string;

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
  await sql("DELETE FROM leader_report_comments");
  await sql("DELETE FROM team_weekly_reports");
  await sql("DELETE FROM ceo_reports");
  const date = new Date(Date.now() + 3 * 3600_000);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) - 7);
  key = date.toISOString().slice(0, 10);
  await sql(
    `INSERT INTO weeks (id, start, "isoYear", "isoNumber", deadline, "meetingDate") VALUES ($1, $2::date, EXTRACT(ISOYEAR FROM $2::date), EXTRACT(WEEK FROM $2::date), $2::date + interval '7 days 15 hours', $2::date + 8) ON CONFLICT (start) DO NOTHING`,
    [`test-7381-${key}`, key],
  );
  weekId = (await sql("SELECT id FROM weeks WHERE start = $1::date", [key]))[0]!.id as string;
});

async function shot(page: Page, suffix: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  mkdirSync("tests/e2e/screenshots", { recursive: true });
  await page.screenshot({ path: `tests/e2e/screenshots/${test.info().project.name}-leader-report-${suffix}.png`, fullPage: true });
}

/** Отчёт команды Ревы, отправленный Фатьянову */
async function seedSentReport() {
  const leader = await id("reva");
  const boss = await id("fatyanov");
  await sql(`INSERT INTO teams (id, name, kind, "leaderId", "specialistsWeekly", "updatedAt") VALUES ('test-7381-team', 'Продуктовая команда', 'CUSTOM', $1, true, now())`, [leader]);
  await sql(`INSERT INTO team_members ("teamId", "personId") VALUES ('test-7381-team', $1)`, [await id("cheychenets")]);
  await sql(
    `INSERT INTO team_weekly_reports (id, "teamId", "weekId", blocks, "updatedAt", "sentAt", "sentById", "sentTo", "sentSnapshot") VALUES ('test-7381-sent', 'test-7381-team', $1, '[]', now(), now() - interval '1 minute', $2, $3::jsonb, $4::jsonb)`,
    [
      weekId,
      leader,
      JSON.stringify([{ id: boss, name: "Фатьянов Евгений" }]),
      JSON.stringify([
        { key: "risks", title: "Риски", hidden: false, note: null, lines: [{ product: null, text: "Ставки падают, спрос ниже", href: null, source: null }] },
        { key: "plan", title: "План на неделю", hidden: false, note: null, lines: [{ product: null, text: "Запустить витрину вкладов", href: null, source: null }] },
      ]),
    ],
  );
  return { leader, boss };
}

test("получатель пишет комментарий к полученному отчёту, автор видит его в «Отправленных» и отвечает", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await seedSentReport();

  // Получатель: пункт меню есть (на телефоне боковое меню скрыто стилями, поэтому проверяем сам пункт, а не нажатие)
  await enterByLink(page, "fatyanov");
  await expect(page.locator('.sv-sidebar__item[href="/leader-report"]')).toHaveCount(1);
  // Без вкладки в адресе получателю открываются «Полученные»
  await page.goto("/leader-report");
  await expect(page.getByTestId("tab-received")).toHaveAttribute("aria-current", "page");
  await page.goto(`/leader-report?tab=received&week=${key}`);
  await expect(page.getByTestId("received-report")).toContainText("Продуктовая команда");
  await expect(page.getByText("Ставки падают, спрос ниже", { exact: true })).toBeVisible();
  await shot(page, "received");

  // Комментарий к отчёту целиком
  await page.getByLabel("Комментарий руководителя").fill("Поправьте вывод по вкладам");
  await page.getByRole("button", { name: "Отправить комментарий" }).click();
  await expect(page.getByTestId("report-comments")).toContainText("Поправьте вывод по вкладам");
  await expect(page.getByTestId("report-comments")).toContainText("Обсуждение с руководителем: 1");

  // Комментарий к строке отчёта
  await page.getByLabel("К чему комментарий").selectOption({ label: "Риски: Ставки падают, спрос ниже" });
  await page.getByLabel("Комментарий руководителя").fill("Эту строку уточните цифрой");
  await page.getByRole("button", { name: "Отправить комментарий" }).click();
  await expect(page.getByTestId("report-comments")).toContainText("Эту строку уточните цифрой");
  await shot(page, "received-comments");

  // Автор отчёта: событие на «Моей неделе» и комментарий во вкладке «Отправленные»
  const context = await browser.newContext({ viewport: page.viewportSize()!, isMobile: test.info().project.name === "phone", hasTouch: test.info().project.name === "phone" });
  const author = await context.newPage();
  await enterByLink(author, "reva");
  await expect(author.getByTestId("me-read")).toContainText("Обсуждение отчёта руководителю");
  await author.goto(`/leader-report?tab=sent&week=${key}`);
  await expect(author.getByTestId("sent-report")).toContainText("Продуктовая команда");
  await expect(author.getByTestId("sent-report")).toContainText("Получатель: Фатьянов Евгений");
  await expect(author.getByTestId("report-comments")).toContainText("Поправьте вывод по вкладам");
  // Автор обсуждение не начинает: формы комментария у него нет, есть только ответ в ветке
  await expect(author.getByLabel("Комментарий руководителя")).toHaveCount(0);
  const thread = author.getByTestId("report-comment").first();
  await thread.getByRole("button", { name: "Ответить" }).click();
  await thread.getByLabel("Ответ").fill("Поправил, отправлю ещё раз");
  await thread.getByRole("button", { name: "Ответить" }).click();
  await expect(author.getByTestId("report-comments")).toContainText("Поправил, отправлю ещё раз");
  await shot(author, "sent");
  await context.close();

  // Преемник получает историю, но прежний отправитель остаётся в подписи.
  await sql('UPDATE teams SET "leaderId" = $1 WHERE id = $2', [await id("cheychenets"), "test-7381-team"]);
  const nextContext = await browser.newContext({ viewport: page.viewportSize()! });
  const successor = await nextContext.newPage();
  await enterByLink(successor, "cheychenets");
  await successor.goto(`/leader-report?tab=sent&week=${key}`);
  await expect(successor.getByTestId("sent-report")).toContainText("отправил Рева Тарас");
  const inherited = successor.getByTestId("report-comment").first();
  await inherited.getByRole("button", { name: "Ответить", exact: true }).click();
  await inherited.getByLabel("Ответ").fill("Продолжу работу как новый руководитель");
  await inherited.getByRole("button", { name: "Ответить", exact: true }).click();
  await expect(inherited).toContainText("Продолжу работу как новый руководитель");
  await nextContext.close();

  // Ответ автора виден получателю
  await page.reload();
  await expect(page.getByTestId("report-comments")).toContainText("Поправил, отправлю ещё раз");
  await expect(page.getByTestId("report-comments")).toContainText("Продолжу работу как новый руководитель");
  const newAuthor = (await sql('SELECT "fullName" FROM people WHERE slug = $1', ["cheychenets"]))[0]!.fullName as string;
  await expect(page.getByTestId("report-comments")).toContainText(newAuthor);
});

test("участник команды и общий логин раздел не видят", async ({ page, browser }) => {
  await seedSentReport();
  await enterByLink(page, "cheychenets");
  await expect(page.locator('.sv-sidebar__item[href="/leader-report"]')).toHaveCount(0);
  const response = await page.goto(`/leader-report?tab=received&week=${key}`);
  const html = await response!.text();
  expect(html).not.toContain("Ставки падают, спрос ниже");
  await expect(page.getByText("Раздел недоступен", { exact: true })).toBeVisible();
  await shot(page, "no-access");

  // Общий логин не удостоверяет человека: даже руководителю команды раздел по нему не открывается
  const shared = await browser.newContext({ viewport: page.viewportSize()! });
  const sharedPage = await shared.newPage();
  await enterTeam(sharedPage, "Рева Тарас");
  await sharedPage.goto(`/leader-report?week=${key}`);
  await expect(sharedPage.getByText("Раздел недоступен", { exact: true })).toBeVisible();
  await shared.close();
});


test("администратор без своих отчётов не видит раздел и содержание обсуждений в журнале", async ({ page }) => {
  await seedSentReport();
  await enterByLink(page, "fatyanov");
  await page.goto(`/leader-report?tab=received&week=${key}`);
  await page.getByLabel("К чему комментарий").selectOption({ label: "Риски: Ставки падают, спрос ниже" });
  await page.getByLabel("Комментарий руководителя").fill("Содержание только для обсуждения");
  await page.getByRole("button", { name: "Отправить комментарий" }).click();
  await expect(page.getByTestId("report-comments")).toContainText("Содержание только для обсуждения");
  await enterByLink(page, "golovkin");
  await enterManagement(page, "admin");
  await expect(page.locator('.sv-sidebar__item[href="/leader-report"]')).toHaveCount(0);
  await page.goto(`/leader-report?week=${key}`);
  await expect(page.getByText("Раздел недоступен", { exact: true })).toBeVisible();
  const response = await page.goto("/journal");
  const html = await response!.text();
  expect(html).not.toContain("Содержание только для обсуждения");
  expect(html).not.toContain("Ставки падают, спрос ниже");
  await expect(page.getByText("Обсуждение отчёта руководителю", { exact: true }).first()).toBeVisible();
});
