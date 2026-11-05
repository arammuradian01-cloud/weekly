import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, resetDatabase, sql } from "./helpers";

// Этап 73+81: weekly можно смотреть и сдавать за прошлые недели. Переключатель недель на экране сдачи, состояние каждой
// недели, сдача прошлой открытой недели с отметкой «Сдан с опозданием» и закрытая неделя только для просмотра.
// Сценарий идёт и на ноутбуке 1440, и на телефоне 360.

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

/**
 * Понедельник позапрошлой календарной недели по Москве. Две недели назад, а не одна: отчётная неделя в понедельник до
 * срока это ещё прошлая календарная неделя, и одна неделя назад совпала бы с отчётной
 */
function pastMonday() {
  const date = new Date(Date.now() + 3 * 3600_000);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) - 14);
  return date.toISOString().slice(0, 10);
}

let past: string;

test.beforeEach(async () => {
  await resetDatabase();
  past = pastMonday();
  await sql(
    `INSERT INTO weeks (id, start, "isoYear", "isoNumber", deadline, "meetingDate") VALUES ($1, $2::date, EXTRACT(ISOYEAR FROM $2::date), EXTRACT(WEEK FROM $2::date), $2::date + interval '7 days 15 hours', $2::date + 8) ON CONFLICT (start) DO NOTHING`,
    [`test-7381w-${past}`, past],
  );
});

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-past-${name}.png`, fullPage: true });
}

test("переключатель недель на экране сдачи: прошлую открытую неделю ещё можно сдать", async ({ page }) => {
  test.setTimeout(120_000);
  await enter(page, "Афанасьев Павел");
  await page.goto("/weekly/submit");
  const weeks = page.getByTestId("submit-weeks");
  await expect(weeks).toBeVisible();
  // Отчётная неделя отмечена как текущая страница переключателя
  await expect(weeks.getByRole("link", { name: /отчётная/ })).toHaveAttribute("aria-current", "page");
  await shot(page, "switcher");

  // Прошлая неделя: заголовок её номера, пометка «это прошлая неделя» и кнопка сдачи на месте
  await page.goto(`/weekly/submit?week=${past}`);
  await expect(page.getByTestId("submit-past-note")).toContainText("Это прошлая неделя");
  await expect(page.getByTestId(`submit-week-${past}`)).toHaveAttribute("aria-current", "page");

  await page.getByLabel("Главное одной фразой").fill("Итоги прошлой недели");
  // Главная фраза уходит на сервер сама через пару секунд: без неё сдача не пройдёт
  await expect(page.getByText(/Черновик сохранён/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Добавить запись" }).click();
  await page.getByLabel("Что произошло").fill("Запись за прошлую неделю");
  await page.getByRole("button", { name: "Сохранить запись" }).click();
  await expect(page.getByRole("heading", { name: "Запись за прошлую неделю" })).toBeVisible();
  await page.getByRole("button", { name: "Сдать weekly" }).click();
  await expect(page.getByText("Сдан с опозданием").first()).toBeVisible();
  await shot(page, "submitted-late");

  // Запись и состояние остались у прошлой недели, а не у отчётной
  await page.reload();
  await expect(page.getByTestId(`submit-week-${past}`)).toContainText("сдан с опозданием");
  await page.goto("/weekly/submit");
  await expect(page.getByRole("heading", { name: "Запись за прошлую неделю" })).toHaveCount(0);
  const rows = await sql(
    `SELECT w.start::text AS start, r.state FROM weekly_reports r JOIN weeks w ON w.id = r."weekId" JOIN people p ON p.id = r."authorId" WHERE p."fullName" = $1 AND w.start = $2::date`,
    ["Афанасьев Павел", past],
  );
  expect(rows).toEqual([{ start: past, state: "LATE" }]);
});

test("закрытая прошлая неделя: только просмотр, подсказка говорит, кто её откроет", async ({ page }) => {
  await sql(`UPDATE weeks SET "closedAt" = now() WHERE start = $1::date`, [past]);
  await enter(page, "Афанасьев Павел");
  await page.goto(`/weekly/submit?week=${past}`);
  await expect(page.getByTestId("submit-closed-note")).toContainText("закрыта после встречи");
  await expect(page.getByTestId(`submit-week-${past}`)).toContainText("закрыта");
  await expect(page.getByText("Только просмотр")).toBeVisible();
  await expect(page.getByRole("button", { name: "Добавить запись" })).toHaveCount(0);
  // Права не менялись: поле главной фразы только для чтения (readonly, текст можно выделить), открыть неделю может
  // только владелец или администратор
  await expect(page.getByLabel("Главное одной фразой")).not.toBeEditable();
  await shot(page, "closed");
});

test("отчёт руководителю за эту неделю уже отправлен: предупреждение и на отчётной неделе", async ({ page }) => {
  await enter(page, "Афанасьев Павел");
  await page.goto("/weekly/submit");
  // Неделю берём из самого переключателя: отчётную считает сервер по сроку недели
  const current = page.getByTestId("submit-weeks").locator('[aria-current="page"]');
  const key = (await current.getAttribute("data-testid"))!.replace("submit-week-", "");
  await expect(page.getByTestId("submit-sent-warning")).toHaveCount(0);

  // Отчёт за эту же неделю уже ушёл CEO: опоздавший сдаёт weekly после отправки
  const ceo = (await sql("SELECT id FROM people WHERE slug = 'ceo'"))[0]!.id as string;
  const author = (await sql("SELECT id FROM people WHERE slug = 'muradyan'"))[0]!.id as string;
  await sql(
    `INSERT INTO ceo_reports (id, "weekId", main, risks, next, "updatedAt", "sentAt", "sentById", "sentTo", "sentSnapshot")
     SELECT 'test-7381-ceo', w.id, 'Итог', '', '', now(), now(), $2, $3::jsonb, $4::jsonb FROM weeks w WHERE w.start = $1::date
     ON CONFLICT ("weekId") DO NOTHING`,
    [key, author, JSON.stringify([{ id: ceo, name: "CEO" }]), JSON.stringify({ main: "Итог", risks: "", next: "", meetings: [], blocks: null })],
  );
  await page.reload();
  const warning = page.getByTestId("submit-sent-warning");
  await expect(warning).toContainText("Отчёт руководителю за неделю");
  await expect(warning).toContainText("в отправленную версию сами не войдут");
  await shot(page, "sent-warning");
});

test("неделя раньше самой старой недели ресурса: открывается самая старая, недель в базе не прибавляется", async ({ page }) => {
  await enter(page, "Афанасьев Павел");
  const before = (await sql("SELECT count(*)::int AS n FROM weeks"))[0]!.n as number;
  await page.goto("/weekly/submit?week=2019-01-07");
  await expect(page.getByTestId("submit-too-old-note")).toBeVisible();
  // Недели 2019 года ресурс не вёл: чтением её не заводим
  expect(await sql("SELECT start::text AS start FROM weeks WHERE start < '2020-01-01'::date")).toEqual([]);
  expect((await sql("SELECT count(*)::int AS n FROM weeks"))[0]!.n).toBe(before);
  // На самой старой неделе листать дальше некуда: ссылки «Раньше» нет
  await expect(page.getByRole("link", { name: "Открыть неделю раньше списка" })).toHaveCount(0);
  await shot(page, "too-old");
});

test("за будущую неделю weekly не пишут: открывается отчётная", async ({ page }) => {
  await enter(page, "Афанасьев Павел");
  const future = new Date(Date.now() + 3 * 3600_000);
  future.setUTCDate(future.getUTCDate() - ((future.getUTCDay() + 6) % 7) + 14);
  await page.goto(`/weekly/submit?week=${future.toISOString().slice(0, 10)}`);
  await expect(page.getByText("За будущую неделю weekly не пишут")).toBeVisible();
  await expect(page.getByTestId("submit-weeks").getByRole("link", { name: /отчётная/ })).toHaveAttribute("aria-current", "page");
});
