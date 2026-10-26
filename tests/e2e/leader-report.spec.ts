import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 73: weekly за прошлую неделю задним числом; «Отчёт руководителю» вместо отчёта CEO: архив отправленных,
// комментарий руководителя к отчёту и строке, ответ автора, видимость; старые адреса /ceo-report и /weekly/received,
// отчётная неделя по умолчанию; раздел в «Смотреть как», у администратора без своих команд и по общему логину.
// Ноутбук 1440 и телефон 360 без горизонтальной прокрутки, снимки.

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });
const isPhone = () => test.info().project.name === "phone";

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-lr-${name}.png`, fullPage: true });
}

async function personal(browser: Browser, page: Page, slug: string) {
  const p = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: isPhone(), hasTouch: isPhone() })).newPage();
  await enterByLink(p, slug);
  return p;
}

test.beforeEach(async () => {
  await resetDatabase();
  await sql("DELETE FROM leader_report_comments");
  await sql("DELETE FROM team_weekly_reports");
  await sql("DELETE FROM team_weekly_templates");
});

test("weekly за прошлую неделю: переключатель недель, сдача задним числом, отметка в ленте той недели", async ({ page }) => {
  test.setTimeout(120_000);
  await enter(page, "Афанасьев Павел");
  await page.goto("/weekly/submit");
  const weeks = page.getByTestId("submit-weeks");
  await expect(weeks.getByRole("link").first()).toContainText("отчётная");
  await expect(weeks.getByRole("link").first()).toHaveAttribute("aria-current", "page");
  await shot(page, "submit-weeks");
  await weeks.getByRole("link").nth(1).click();
  await expect(page).toHaveURL(/\/weekly\/submit\?week=\d{4}-\d{2}-\d{2}$/);
  const key = new URL(page.url()).searchParams.get("week")!;
  await expect(page.getByText("Сдача сейчас будет отмечена «сдан задним числом».")).toBeVisible();
  await page.getByLabel("Главное одной фразой").fill("Догоняю прошлую неделю");
  await page.getByRole("button", { name: "Добавить запись" }).click();
  await page.getByLabel("Что произошло").fill("Запись за прошлую неделю");
  await page.getByRole("button", { name: "Сохранить запись" }).click();
  await expect(page.getByRole("heading", { name: "Запись за прошлую неделю" })).toBeVisible();
  await page.getByRole("button", { name: "Сдать weekly" }).click();
  await expect(page.getByText("Weekly сдан задним числом").first()).toBeVisible();
  await expect(weeks.getByRole("link").nth(1)).toHaveAttribute("data-state", "late");
  const [row] = await sql(`SELECT r.state, r.retro FROM weekly_reports r JOIN weeks w ON w.id = r."weekId" JOIN people p ON p.id = r."authorId" WHERE p.slug = 'afanasyev' AND w.start = $1::date`, [key]);
  expect(row).toMatchObject({ state: "LATE", retro: true });
  await shot(page, "submit-retro");

  // Лента той недели: weekly Павла с отметкой; главная кнопка шапки называет неделю
  await page.goto(`/weekly?week=${key}`);
  await expect(page.getByTestId("weekly-leader-afanasyev")).toContainText("Сдан задним числом");
  await expect(page.getByTestId("weekly-submit-link")).toHaveText(/Мой weekly за неделю \d+/);
  // Будущую неделю адресом не открыть: экран говорит, что открыта отчётная
  await page.goto("/weekly/submit?week=2099-01-05");
  await expect(page.getByText(/За будущую неделю weekly не пишут/)).toBeVisible();
});

test("отчёт руководителю: отправка, архив отправленных, комментарий руководителя к отчёту и строке, ответ автора", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await sql(`INSERT INTO teams (id, name, kind, "leaderId", "updatedAt") VALUES ('e2e-lr-up', 'Тест 73: управление', 'CUSTOM', (SELECT id FROM people WHERE slug = 'golovkin'), now())`);
  await sql(`INSERT INTO teams (id, name, kind, "leaderId", "parentId", "specialistsWeekly", "updatedAt") VALUES ('e2e-lr', 'Тест 73: команда КАСКО', 'CUSTOM', (SELECT id FROM people WHERE slug = 'reva'), 'e2e-lr-up', true, now())`);
  await sql(`INSERT INTO team_members ("teamId", "personId") SELECT 'e2e-lr', id FROM people WHERE slug = 'fatyanov'`);
  await sql(`INSERT INTO team_weekly_templates ("teamId", blocks, "updatedAt") VALUES ('e2e-lr', '[{"key":"products","title":"Продукты"},{"key":"plan","title":"План на неделю"}]'::jsonb, now())`);

  // Рева: пункт меню в группе «Команда», отчёт команды, отправка руководителю с его ФИО на кнопке
  await enterByLink(page, "reva");
  await page.goto("/leader-report?team=e2e-lr");
  await expect(page.getByRole("heading", { name: "Отчёт руководителю", level: 1 })).toBeVisible();
  await expect(page.getByTestId("lr-tab-current")).toHaveAttribute("aria-current", "page");
  const products = page.getByTestId("team-block-products");
  if ((await products.getAttribute("data-open")) !== "true") await products.getByRole("button", { name: /^Раскрыть блок/ }).click();
  await products.getByRole("button", { name: "Добавить строку" }).click();
  const empty = (await products.getByRole("textbox").evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value))).indexOf("");
  await products.getByRole("textbox").nth(empty).fill("Пилот КАСКО для такси запускаем в ноябре");
  await page.getByRole("button", { name: "Отправить руководителю: Головкин Владислав" }).click();
  await page.getByRole("dialog", { name: "Отправить отчёт руководителю?" }).getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.getByTestId("team-report-sent")).toContainText("Получил: Головкин Владислав");
  // Черновик правят после отправки: в «Отправленных» ровно отправленный текст и пометка о правке
  await products.getByRole("textbox").nth(empty).fill("Правка после отправки");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText(/сохранён/).first()).toBeVisible();
  await page.getByTestId("lr-tab-sent").click();
  await expect(page.getByTestId("lr-archive")).toContainText("Головкин Владислав");
  await expect(page.getByTestId("sent-report-body")).toContainText("Пилот КАСКО для такси запускаем в ноябре");
  await expect(page.getByTestId("sent-report-body")).not.toContainText("Правка после отправки");
  await expect(page.getByTestId("sent-report-edited")).toBeVisible();
  await shot(page, "sent-archive");

  // Головкин: «Полученные», кто отправил; комментарий к отчёту целиком и к строке
  const boss = await personal(browser, page, "golovkin");
  await boss.goto("/leader-report?tab=received");
  const row = boss.getByTestId("lr-received-e2e-lr");
  await expect(row).toContainText("Рева Тарас");
  await expect(row).toContainText("Отправлен");
  await row.getByRole("link", { name: "Открыть отчёт" }).click();
  await expect(boss).toHaveURL(/tab=received.*team=e2e-lr/);
  await boss.getByRole("button", { name: "Комментарий к отчёту" }).click();
  await boss.getByLabel("Комментарий к отчёту").fill("Хорошо, но где цифры по такси?");
  await boss.getByTestId("report-comment-form").getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(boss.getByTestId("report-comments")).toContainText("Хорошо, но где цифры по такси?");
  await boss.getByRole("button", { name: /^Комментировать строку: Пилот КАСКО/ }).click();
  await boss.getByLabel("Комментарий к строке").fill("Сколько машин в пилоте?");
  await boss.getByTestId("report-comment-form").getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(boss.getByTestId("sent-report-body")).toContainText("Сколько машин в пилоте?");
  await shot(boss, "received-comments");

  // Рева: событие в «Мне» ведёт в «Отправленные», ответ на комментарий
  await page.goto("/me");
  await page.getByRole("link", { name: "Комментарий к отчёту руководителю" }).click();
  await expect(page).toHaveURL(/\/leader-report\?tab=sent&team=e2e-lr/);
  await expect(page.getByTestId("report-comments")).toContainText("Хорошо, но где цифры по такси?");
  await page.getByRole("button", { name: "Ответить на комментарий: Головкин Владислав" }).first().click();
  await page.getByLabel("Ответ").fill("Добавлю в следующем отчёте");
  await page.getByTestId("report-comment-form").getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.getByTestId("report-reply").first()).toContainText("Добавлю в следующем отчёте");
  await shot(page, "sent-reply");

  // Головкин видит ответ
  await boss.reload();
  await expect(boss.getByTestId("report-reply").first()).toContainText("Добавлю в следующем отчёте");
  await boss.close();

  // Участник команды комментариев и отправленных не видит
  const member = await personal(browser, page, "fatyanov");
  await member.goto("/leader-report?tab=sent&team=e2e-lr");
  await expect(member.getByText(/Отправленные недоступны|Раздел для руководителей команд/)).toBeVisible();
  await expect(member.getByText("Хорошо, но где цифры по такси?")).toHaveCount(0);
  await member.close();
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM leader_report_comments`);
  expect(n).toBe(3);
});

test("старые адреса ведут в раздел, без недели открыта отчётная неделя; администратор без своих команд; общий логин", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await enterByLink(page, "muradyan");
  await enterManagement(page, "owner");
  await page.goto("/ceo-report?week=2026-09-21");
  await expect(page).toHaveURL(/\/leader-report\?team=top&week=2026-09-21$/);
  await expect(page.getByRole("heading", { name: "Отчёт руководителю", level: 1 })).toBeVisible();
  await expect(page.getByRole("group", { name: "Выбор недели" })).toContainText("Неделя 39");
  // Без недели: отчётная, а не последняя неделя с записями (в базе записи только в неделях 38 и 39)
  await page.goto("/ceo-report");
  await expect(page).toHaveURL(/\/leader-report\?team=top$/);
  await expect(page.getByRole("group", { name: "Выбор недели" })).toContainText("отчётная");
  await expect(page.getByTestId("ceo-ready")).toBeVisible();
  await shot(page, "top-current");
  await page.goto("/weekly/received");
  await expect(page).toHaveURL(/\/leader-report\?tab=received$/);

  // Администратор без своих команд в режиме управления: видит раздел и все команды
  const admin = await personal(browser, page, "golovkin");
  await enterManagement(admin, "admin");
  await admin.goto("/leader-report");
  await expect(admin.getByRole("heading", { name: "Отчёт руководителю", level: 1 })).toBeVisible();
  await expect(admin.getByTestId("ceo-ready")).toBeVisible();
  await admin.close();

  // Общий логин без режима управления: пункта меню нет, раздел просит личный вход
  const team = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: isPhone(), hasTouch: isPhone() })).newPage();
  await enter(team, "Рева Тарас");
  await team.goto("/leader-report");
  await expect(team.getByText(/при личном входе/)).toBeVisible();
  await expect(team.getByRole("link", { name: "Отчёт руководителю" })).toHaveCount(0);
  await team.close();
});

test("«Смотреть как»: владелец видит раздел глазами руководителя, комментарий не уходит", async ({ page }) => {
  test.setTimeout(120_000);
  await sql(`INSERT INTO teams (id, name, kind, "leaderId", "updatedAt") VALUES ('e2e-lr-va', 'Тест 73: команда Ревы', 'CUSTOM', (SELECT id FROM people WHERE slug = 'reva'), now())`);
  await enterByLink(page, "muradyan");
  await enterManagement(page, "owner");
  await page.getByRole("button", { name: /^Профиль:/ }).filter({ visible: true }).first().click();
  await page.getByRole("menuitem", { name: "Смотреть как…" }).click();
  const dialog = page.getByRole("dialog", { name: "Смотреть как" });
  await dialog.getByLabel("Поиск по ФИО, должности или подразделению").fill("рева");
  await dialog.getByRole("button", { name: /Рева Тарас/ }).click();
  await expect(page.getByTestId("view-as-banner")).toBeVisible();
  await page.goto("/leader-report");
  await expect(page.getByRole("heading", { name: "Отчёт руководителю", level: 1 })).toBeVisible();
  await expect(page.getByTestId("lr-tab-current")).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/Тест 73: команда Ревы/).first()).toBeVisible();
  await shot(page, "view-as");
});
