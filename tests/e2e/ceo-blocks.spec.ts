import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 66: weekly по смысловым блокам. Владелец собирает отчёт CEO по блокам (новости рынка и команды, неделя к неделе,
// месяц, конкуренты, продукты, партнёрский канал, риски, план на неделю), правит блок, скрывает, меняет порядок,
// отправляет CEO в приложении, CEO видит отчёт по блокам. Руководитель задаёт блоки weekly своей команды, участник сдаёт
// запись по блоку, руководитель отправляет отчёт команды своему руководителю, тот видит его по событию в «Мне».
// Правки по проверке: цифры недели и месяца живые, поправленный руками блок с обновившимися цифрами предлагает
// пересобраться; длинная подпись источника обрезается. Ноутбук 1440 и телефон 360 без горизонтальной прокрутки, снимки.

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

const isPhone = () => test.info().project.name === "phone";

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-cb-${name}.png`, fullPage: true });
}

async function personal(browser: Browser, page: Page, slug: string) {
  const p = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: isPhone(), hasTouch: isPhone() })).newPage();
  await enterByLink(p, slug);
  return p;
}

/** Понедельник недели по Москве: со смещением, чтобы новость точно попала в неделю отчёта */
function monday(shiftWeeks = 0): Date {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + shiftWeeks * 7);
  return d;
}

/** Длинное имя ленты: подпись источника обрезается многоточием и не даёт горизонтальной прокрутки на телефоне */
const LONG_SOURCE = "Агентство страховых новостей: лента рынка страхования и финансов";

const STANDARD = ["Новости рынка и команды", "Неделя к неделе", "Месяц: к прошлому году, к прошлому месяцу, план продаж", "Конкуренты", "Продукты", "Партнёрский канал", "Риски", "План на неделю"];

test.beforeEach(async () => {
  await resetDatabase();
  await sql("DELETE FROM team_weekly_reports");
  await sql("DELETE FROM team_weekly_templates");
  await sql("DELETE FROM news_items");
  await sql("DELETE FROM settings WHERE key = 'ceo.competitors'");
  // CEO подключён: профиль ceo включён, структуры компании в тестовой базе нет
  await sql("UPDATE people SET active = true WHERE slug = 'ceo'");
});

test("этап 66: владелец собирает отчёт CEO по смысловым блокам, правит, скрывает, меняет порядок и отправляет; CEO видит блоки", async ({ page, browser }) => {
  test.setTimeout(150_000);
  // Новость о конкуренте в среду этой и прошлой недели: какая-то из них в неделе отчёта (отчётная неделя меняется во вторник)
  const [source] = await sql(`INSERT INTO news_sources (id, name, url, "updatedAt") VALUES ('e2e66-src', $1, 'https://e2e66.example/rss', now()) ON CONFLICT (url) DO UPDATE SET name = $1 RETURNING id`, [LONG_SOURCE]);
  for (const [i, shift] of [0, -1].entries()) {
    const wed = monday(shift);
    wed.setUTCDate(wed.getUTCDate() + 2);
    wed.setUTCHours(9);
    await sql(`INSERT INTO news_items (id, "sourceId", guid, "urlKey", url, title, summary, "publishedAt", directions) VALUES ($1, $2, $1, $3, $4, $5, '', $6, ARRAY['kasko'])`, [
      `e2e66-${i}`,
      source!.id,
      `e2e66.example/${i}`,
      `https://e2e66.example/${i}`,
      `Пампаду запустил КАСКО по подписке ${i + 1}`,
      wed,
    ]);
  }

  await enterByLink(page, "muradyan");
  await enterManagement(page, "owner");
  await page.goto("/ceo-report");
  const editor = page.getByTestId("ceo-editor");
  // Стандартный набор блоков в порядке отчёта CEO
  await expect(editor.getByRole("heading", { level: 2 })).toHaveText(STANDARD);
  // Конкуренты из новостей недели: строка с продуктом и ссылкой на новость
  const competitors = page.getByTestId("ceo-block-competitors");
  await expect(competitors.getByRole("textbox").first()).toHaveValue(/^Пампаду: Пампаду запустил КАСКО по подписке/);
  await expect(competitors.getByRole("combobox").first()).toHaveValue("kasko");
  await expect(competitors.getByRole("link", { name: LONG_SOURCE }).first()).toHaveAttribute("href", /https:\/\/e2e66\.example\//);
  await expect(page.getByTestId("ceo-block-month")).toBeVisible();
  await shot(page, "ceo-editor");

  // Правка блока: строка в «Продуктах» с продуктом КАСКО
  const products = page.getByTestId("ceo-block-products");
  await products.getByRole("button", { name: "Добавить строку" }).click();
  // Новая строка пустая; строки в «Продуктах» идут подразделами продуктов, поэтому ищем её по пустому тексту
  const values = () => products.getByRole("textbox").evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
  const i = (await values()).indexOf("");
  expect(i).toBeGreaterThanOrEqual(0);
  await products.getByRole("textbox").nth(i).fill("Пилот КАСКО для такси запускаем в ноябре");
  await products.getByTestId("block-line").nth(i).getByRole("combobox").selectOption("kasko");
  // Скрыть блок: в отчёт не попадёт
  await page.getByRole("button", { name: "Скрыть блок «Новости рынка и команды»" }).click();
  await expect(page.getByTestId("ceo-block-news").getByTestId("block-hidden")).toContainText("Скрыт: в отчёт не попадёт");
  // Порядок: план на неделю выше рисков
  await page.getByRole("button", { name: "Поднять блок «План на неделю»" }).click();
  const titles = await editor.getByRole("heading", { level: 2 }).allTextContents();
  expect(titles.indexOf("План на неделю")).toBeLessThan(titles.indexOf("Риски"));

  // Предпросмотр: что получит CEO
  await page.getByTestId("ceo-blocks-preview").locator("summary").click();
  const preview = page.getByTestId("ceo-blocks-preview");
  await expect(preview.getByRole("region", { name: "Продукты" })).toContainText("Пилот КАСКО для такси запускаем в ноябре");
  await expect(preview.getByRole("region", { name: "Новости рынка и команды" })).toHaveCount(0);

  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText(/Отчёт за неделю \d+ сохранён/).first()).toBeVisible();
  await page.reload();
  expect(await values()).toContain("Пилот КАСКО для такси запускаем в ноябре");
  await expect(page.getByTestId("ceo-block-news").getByTestId("block-hidden")).toBeVisible();

  // Отправить CEO: только в приложении, в новой структуре
  await page.getByRole("button", { name: "Отправить CEO", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Отправить weekly CEO?" });
  await expect(dialog).toContainText("без письма");
  await dialog.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.getByText(/Weekly отправлен CEO/).first()).toBeVisible();
  await expect(page.getByTestId("ceo-report-sent")).toContainText("Отправлен CEO");
  const [report] = await sql(`SELECT "sentAt" IS NOT NULL AS sent, jsonb_array_length("sentSnapshot"->'blocks') AS blocks, main FROM ceo_reports`);
  expect(report).toMatchObject({ sent: true, blocks: 8 });
  expect(report!.main).toContain("- КАСКО. Пилот КАСКО для такси запускаем в ноябре");
  await shot(page, "ceo-sent-owner");

  // CEO: событие в «Мне», отчёт по блокам только для чтения, скрытого блока нет
  const ceo = await personal(browser, page, "ceo");
  await ceo.goto("/me");
  await ceo.getByRole("link", { name: "Weekly для CEO" }).click();
  await expect(ceo).toHaveURL(/\/ceo-report\?week=/);
  const sent = ceo.getByTestId("ceo-sent-report");
  await expect(sent.getByRole("region", { name: "Продукты" })).toContainText("Пилот КАСКО для такси запускаем в ноябре");
  await expect(sent.getByRole("region", { name: "Продукты" }).getByRole("heading", { name: "КАСКО" })).toBeVisible();
  await expect(sent.getByRole("region", { name: "Конкуренты" })).toContainText("Пампаду");
  // Подпись источника целиком в ссылке, на экране обрезана многоточием: прокрутки вбок нет (проверяет снимок)
  await expect(sent.getByRole("region", { name: "Конкуренты" }).getByRole("link", { name: LONG_SOURCE }).first()).toBeVisible();
  await expect(sent.getByRole("region", { name: "Новости рынка и команды" })).toHaveCount(0);
  await expect(ceo.getByRole("button", { name: "Сохранить" })).toHaveCount(0);
  await shot(ceo, "ceo-view");
  await ceo.close();
});

test("этап 66: цифры недели живые, поправленный руками блок помечен, а когда цифры обновились, предлагает пересобраться", async ({ page }) => {
  test.setTimeout(120_000);
  await enterByLink(page, "muradyan");
  await enterManagement(page, "owner");
  await page.goto("/ceo-report");
  const wow = page.getByTestId("ceo-block-wow");
  await expect(wow).toBeVisible();
  // Строка руками в блоке цифр: блок помечен поправленным, сам больше не пересобирается
  await wow.getByRole("button", { name: "Добавить строку" }).click();
  await wow.getByRole("textbox").last().fill("Трафик ОСАГО держится на уровне прошлой недели");
  await expect(wow.getByTestId("block-edited")).toContainText("Цифры поправлены руками");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText(/Отчёт за неделю \d+ сохранён/).first()).toBeVisible();
  // Автосборка с тех пор изменилась: отпечаток цифр в сохранённом блоке другой
  await sql(
    `UPDATE ceo_reports SET blocks = (SELECT jsonb_agg(CASE WHEN b->>'key' = 'wow' THEN b || '{"basis":"e2estale"}'::jsonb ELSE b END ORDER BY n) FROM jsonb_array_elements(blocks) WITH ORDINALITY AS t(b, n)), "updatedAt" = "updatedAt"`,
  );
  await page.reload();
  await expect(wow.getByTestId("block-stale")).toContainText("Цифры обновились");
  await expect(wow.getByRole("textbox").last()).toHaveValue("Трафик ОСАГО держится на уровне прошлой недели");
  await shot(page, "ceo-stale");
  await wow.getByRole("button", { name: "Пересобрать" }).click();
  await page.getByRole("dialog", { name: "Собрать блок «Неделя к неделе» заново?" }).getByRole("button", { name: "Собрать блок" }).click();
  await expect(wow.getByTestId("block-stale")).toHaveCount(0);
  await expect(wow.getByTestId("block-edited")).toHaveCount(0);
  expect(await wow.getByRole("textbox").evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value))).not.toContain("Трафик ОСАГО держится на уровне прошлой недели");
});

test("этап 66: руководитель задаёт блоки weekly команды, участник сдаёт запись по блоку, руководитель отправляет отчёт своему руководителю", async ({ page, browser }) => {
  test.setTimeout(150_000);
  // Команда Ревы без команды выше: отчёт уходит его руководителю по структуре (Фатьянов)
  await sql(`INSERT INTO teams (id, name, kind, "leaderId", "specialistsWeekly", "updatedAt") VALUES ('e2e-team66', 'Тест 66: команда вкладов', 'CUSTOM', (SELECT id FROM people WHERE slug = 'reva'), true, now())`);
  await sql(`INSERT INTO team_members ("teamId", "personId") SELECT 'e2e-team66', id FROM people WHERE slug = 'cheychenets'`);
  await sql(`UPDATE people SET "managerId" = (SELECT id FROM people WHERE slug = 'fatyanov') WHERE slug = 'reva'`);

  await enterByLink(page, "reva");
  await page.goto("/weekly/team-report?team=e2e-team66");
  await expect(page.getByText("Блоки weekly команды «Тест 66: команда вкладов» не заданы")).toBeVisible();
  const template = page.getByTestId("team-template");
  await template.getByRole("button", { name: "Взять стандартный набор" }).click();
  await expect(template.getByTestId("team-template-block")).toHaveCount(8);
  // Лишние блоки убираем, свой блок добавляем, порядок меняем
  for (const name of ["Неделя к неделе", "Месяц: к прошлому году, к прошлому месяцу, план продаж", "Конкуренты", "Партнёрский канал"]) {
    await template.getByRole("button", { name: `Убрать блок «${name}»` }).click();
  }
  await template.getByLabel("Свой блок").fill("Найм и команда");
  await template.getByRole("button", { name: "Добавить свой" }).click();
  await template.getByRole("button", { name: "Поднять блок «Найм и команда»" }).click();
  await expect(template.getByTestId("team-template-block")).toHaveText([/Новости рынка и команды/, /Продукты/, /Риски/, /Найм и команда/, /План на неделю/]);
  await shot(page, "team-template");
  await template.getByRole("button", { name: "Сохранить блоки" }).click();
  await expect(page.getByText("Блоки weekly команды сохранены").first()).toBeVisible();
  await expect(page.getByTestId("team-editor")).toBeVisible();

  // Участник сдаёт weekly по блокам команды
  const member = await personal(browser, page, "cheychenets");
  await member.goto("/weekly/submit");
  await expect(member.getByTestId("weekly-template-hint")).toContainText("Команда «Тест 66: команда вкладов» сдаёт weekly по блокам");
  await member.getByRole("button", { name: "Добавить запись" }).click();
  await member.getByLabel("Блок отчёта").selectOption({ label: "Найм и команда" });
  await member.getByLabel("Что произошло").fill("Закрыли вакансию аналитика вкладов");
  await member.getByRole("button", { name: "Сохранить запись" }).click();
  await expect(member.getByText("Закрыли вакансию аналитика вкладов").first()).toBeVisible();
  await shot(member, "team-submit");
  const [entry] = await sql(`SELECT section FROM weekly_entries WHERE what = 'Закрыли вакансию аналитика вкладов'`);
  expect(entry!.section).toMatch(/^c:[a-z0-9]{8}$/);
  await member.close();

  // Руководитель видит отчёт команды по блокам: запись в своём блоке, строка с продуктом
  await page.reload();
  const hire = page.getByTestId("team-editor").getByRole("region", { name: "Найм и команда" });
  await expect(hire.getByRole("textbox").first()).toHaveValue("Закрыли вакансию аналитика вкладов");
  await expect(hire.getByRole("combobox").first()).toHaveValue("deposits");
  await shot(page, "team-report");
  await page.getByRole("button", { name: "Отправить руководителю" }).click();
  const dialog = page.getByRole("dialog", { name: "Отправить weekly команды?" });
  await expect(dialog).toContainText("Фатьянов Евгений");
  await dialog.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.getByText(/Weekly команды отправлен/).first()).toBeVisible();
  await expect(page.getByTestId("team-report-sent")).toContainText("Получил: Фатьянов Евгений");

  // Руководитель руководителя: событие в «Мне» и отчёт только для чтения
  const boss = await personal(browser, page, "fatyanov");
  await boss.goto("/me");
  await boss.getByRole("link", { name: "Weekly команды по блокам" }).click();
  await expect(boss).toHaveURL(/\/weekly\/team-report\?team=e2e-team66/);
  await expect(boss.getByTestId("team-report-view").getByRole("region", { name: "Найм и команда" })).toContainText("Закрыли вакансию аналитика вкладов");
  await expect(boss.getByRole("button", { name: "Отправить руководителю" })).toHaveCount(0);
  await shot(boss, "team-report-boss");
  await boss.close();
});
