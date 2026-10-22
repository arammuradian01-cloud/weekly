import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterManagement, resetDatabase, sql } from "./helpers";
import { contrastReport } from "./contrast";

// Этап 68: новый дизайн страниц из дизайн-сессии (в пакете он назван этапами 61-64). Снимки светлой и тёмной темы на
// ноутбуке 1440 и телефоне 360 лежат в tests/e2e/screenshots/dizajn-68. На каждом снимке страница не шире экрана, а на
// переделанных экранах у текста контраст не ниже 4,5:1 в обеих темах. Отдельные сценарии: цели карточками и шкалой
// квартала, лента weekly с «Что решить» и свёрнутыми лидерами, новости одной лентой с главной новостью и одной темой
// из разных источников, справка с оглавлением, «Моя неделя» со счётчиками, «Новая задача» на телефоне, приветствие,
// 360 без прокрутки вбок.

const DIR = "tests/e2e/screenshots/dizajn-68";
mkdirSync(DIR, { recursive: true });

type Theme = "light" | "dark";
const phone = () => test.info().project.name === "phone";

/** Квартал по Москве, как в ресурсе: 2026-Q4 */
function quarterNow(): string {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const year = d.find((p) => p.type === "year")!.value;
  const month = Number(d.find((p) => p.type === "month")!.value);
  return `${year}-Q${Math.ceil(month / 3)}`;
}

const person = (slug: string) => `(SELECT id FROM people WHERE slug = '${slug}')`;

/** Цели, инициативы и новости для снимков: в стартовых данных их нет */
async function seed() {
  const q = quarterNow();
  await sql(`DELETE FROM goals WHERE id LIKE 'd68-%'`);
  await sql(
    `INSERT INTO goals (id, quarter, code, title, description, metric, base, target, "teamId", "ownerId", "atRisk", "riskNote", result, "sortOrder", "updatedAt") VALUES
      ('d68-g1', $1, 'D1', 'Маржа департамента 150 млн', 'Маржа по всем продуктам департамента за квартал', 'Маржа, млн', '100', '150', 'top', ${person("muradyan")}, false, NULL, 'IN_PROGRESS', 1, now()),
      ('d68-g2', $1, 'D2', 'Подписка ОСАГО запущена', NULL, NULL, NULL, NULL, 'top', ${person("reva")}, true, 'Партнёр сдвинул интеграцию на две недели', 'IN_PROGRESS', 2, now()),
      ('d68-g3', $1, 'D3', 'Новая форма расчёта на всём трафике', NULL, NULL, NULL, NULL, 'top', ${person("loginova")}, false, NULL, 'ACHIEVED', 3, now())`,
    [q],
  );
  await sql(`INSERT INTO goal_facts (id, "goalId", value, number, "authorId", at) VALUES ('d68-f1', 'd68-g1', '141', 141, ${person("muradyan")}, now())`);
  // Задача работает на цель подписки: в карточке цели видно «задачи 0 из 1»
  await sql(`UPDATE tasks SET "goalId" = 'd68-g2' WHERE number = (SELECT min(number) FROM tasks WHERE "ownerId" = ${person("reva")} AND status = 'IN_PROGRESS' AND "archivedAt" IS NULL)`);

  await sql(
    `INSERT INTO initiatives (id, title, why, "ownerId", "teamId", state, "stateSince", note, "noteAt", "createdAt", "updatedAt") VALUES
      ('d68-i1', 'Подписка ОСАГО в приложении', 'Страховые переводят розницу на подписку, нужен свой продукт', ${person("reva")}, 'top', 'SEARCHING', now() - interval '40 days', 'Выбираем партнёра для пилота', now() - interval '3 days', now(), now()),
      ('d68-i2', 'Продающий контакт-центр', 'Сложные продажи КАСКО и ипотеки идут через звонок', ${person("loginova")}, 'top', 'DOING', now() - interval '10 days', 'Набрали первую смену, запуск в ноябре', now(), now(), now())`,
  );

  await sql(`DELETE FROM news_items WHERE id LIKE 'd68-%'`);
  await sql(`DELETE FROM news_sources WHERE id LIKE 'd68-%'`);
  await sql(
    `INSERT INTO news_sources (id, name, url, "updatedAt", "lastFetchAt", "lastOkAt") VALUES
      ('d68-s1', 'Банк России', 'https://example.org/d68/cbr.rss', now(), now(), now()),
      ('d68-s2', 'Ведомости', 'https://example.org/d68/vedomosti.rss', now(), now(), now()),
      ('d68-s3', 'Интерфакс', 'https://example.org/d68/interfax.rss', now(), now(), now()),
      ('d68-s4', 'РСА', 'https://example.org/d68/rsa.rss', now(), now(), now())`,
  );
  await sql(
    `INSERT INTO news_items (id, "sourceId", guid, "urlKey", url, title, summary, "publishedAt", directions) VALUES
      ('d68-n1', 'd68-s1', 'n1', 'example.org/d68/n1', 'https://example.org/d68/n1', 'Банк России обсудил со страховщиками новые тарифы ОСАГО', 'Регулятор предложил расширить тарифный коридор и учитывать стаж водителя.', now() - interval '10 seconds', '{osago}'),
      ('d68-n2', 'd68-s2', 'n2', 'example.org/d68/n2', 'https://example.org/d68/n2', 'Страховщики подвели итоги продаж КАСКО за девять месяцев', 'Сборы по КАСКО выросли на 18 процентов, рост дали банковские продажи.', now() - interval '20 seconds', '{kasko}'),
      ('d68-n3', 'd68-s3', 'n3', 'example.org/d68/n3', 'https://example.org/d68/n3', 'Итоги продаж КАСКО за девять месяцев: страховщики подвели черту', 'Рынок КАСКО за девять месяцев вырос почти на пятую часть.', now() - interval '30 seconds', '{kasko}'),
      ('d68-n4', 'd68-s2', 'n4', 'example.org/d68/n4', 'https://example.org/d68/n4', 'Ипотечное страхование дорожает вслед за ставкой', 'Банки пересматривают требования к полисам при выдаче ипотеки.', now() - interval '1 day', '{deposits,osago,kasko}'),
      ('d68-n5', 'd68-s4', 'n5', 'example.org/d68/n5', 'https://example.org/d68/n5', 'РСА обновил справочник средней стоимости запчастей', 'Справочники для расчёта ремонта по ОСАГО обновлены с первого числа.', now() - interval '1 day 2 hours', '{osago}')`,
  );
}

async function clean() {
  await sql(`DELETE FROM news_items WHERE id LIKE 'd68-%'`);
  await sql(`DELETE FROM news_sources WHERE id LIKE 'd68-%'`);
  await sql(`DELETE FROM initiatives WHERE id LIKE 'd68-%'`);
  await sql(`UPDATE tasks SET "goalId" = NULL WHERE "goalId" LIKE 'd68-%'`);
  await sql(`DELETE FROM goals WHERE id LIKE 'd68-%'`);
}

/** Проверки снимка: тема применилась, страница не шире экрана, у текста контраст (на переделанных экранах), снимок */
async function shot(page: Page, theme: Theme, name: string, opts: { contrast?: boolean } = {}) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  if (opts.contrast) {
    const report = await contrastReport(page, 4.5);
    expect(report.unparsed, `цвета, которые проверка не разобрала на экране ${name}`).toEqual([]);
    expect(report.low, `текст без контраста на экране ${name} (${theme}): ${JSON.stringify(report.low)}`).toEqual([]);
  }
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${DIR}/${name}-${test.info().project.name}-${theme}.png`, fullPage: true });
}

test.beforeAll(async () => {
  await resetDatabase();
  await seed();
});

test.afterAll(async () => {
  await clean();
});

// Переделанные экраны: на них контраст проверяется в обеих темах. Остальные снимаются для глаза
const SCREENS: { name: string; path: string; ready: (page: Page) => Promise<void>; contrast?: boolean }[] = [
  { name: "roadmap", path: "/roadmap", contrast: true, ready: async (page) => void (await expect(page.getByTestId(phone() ? "roadmap-list" : "roadmap-timeline")).toBeVisible()) },
  { name: "lyudi", path: "/people", contrast: true, ready: async (page) => void (await expect(page.getByRole("heading", { name: "Люди", level: 1 })).toBeVisible()) },
  { name: "rukovoditelyu", path: "/people/leader", contrast: true, ready: async (page) => void (await expect(page.getByTestId("mt-teams-table")).toBeVisible()) },
  { name: "iniciativy", path: "/initiatives", contrast: true, ready: async (page) => void (await expect(page.getByText("Подписка ОСАГО в приложении")).toBeVisible()) },
  { name: "celi", path: "/goals", contrast: true, ready: async (page) => void (await expect(page.getByTestId("goals-cards")).toBeVisible()) },
  { name: "weekly-lenta", path: "/weekly?week=2026-09-21", contrast: true, ready: async (page) => void (await expect(page.getByTestId("weekly-digest")).toBeVisible()) },
  { name: "novosti", path: "/news", contrast: true, ready: async (page) => void (await expect(page.locator('[data-lead="true"]')).toBeVisible()) },
  { name: "spravka", path: "/help", contrast: true, ready: async (page) => void (await expect(page.getByRole("navigation", { name: "Разделы справки" })).toBeVisible()) },
  { name: "moya-nedelya", path: "/", contrast: true, ready: async (page) => void (await expect(page.getByRole("heading", { level: 1 })).toBeVisible()) },
  { name: "mne", path: "/me", contrast: true, ready: async (page) => void (await expect(page.getByRole("heading", { level: 1 })).toBeVisible()) },
  { name: "zadachi", path: "/tasks", ready: async (page) => void (await expect(page.getByRole("heading", { level: 1 })).toBeVisible()) },
  { name: "weekly-sdacha", path: "/weekly/submit", ready: async (page) => void (await expect(page.getByRole("heading", { level: 1 })).toBeVisible()) },
  { name: "nastroyki", path: "/settings", ready: async (page) => void (await expect(page.getByRole("heading", { level: 1 })).toBeVisible()) },
  { name: "privetstvie", path: "/welcome", ready: async (page) => void (await expect(page.getByTestId("welcome-start")).toBeVisible()) },
  { name: "vstrecha", path: "/weekly/meeting", ready: async (page) => void (await expect(page.getByRole("heading", { level: 1 })).toBeVisible()) },
  { name: "otchet-ceo", path: "/ceo-report", ready: async (page) => void (await expect(page.getByRole("heading", { name: "Отчёт CEO", level: 1 })).toBeVisible()) },
  { name: "weekly-komandy", path: "/people/teams", ready: async (page) => void (await expect(page.getByRole("heading", { name: "Люди", level: 1 })).toBeVisible()) },
];

for (const theme of ["light", "dark"] as Theme[]) {
  test(`снимки нового дизайна: ${theme === "light" ? "светлая" : "тёмная"} тема`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.context().addCookies([{ name: "theme", value: theme, url: "http://localhost:3100" }]);
    await enter(page, "Мурадян Арам");
    await enterManagement(page, "owner");
    for (const s of SCREENS) {
      await page.goto(s.path);
      await s.ready(page);
      await shot(page, theme, s.name, { contrast: s.contrast });
    }
    // Шапка: на ноутбуке верхняя панель, на телефоне компактная шапка сайта
    await page.goto("/");
    const header = page.locator(phone() ? ".sv-shell__header" : ".sv-shell__top");
    await expect(header).toBeVisible();
    await header.screenshot({ path: `${DIR}/shapka-${test.info().project.name}-${theme}.png` });
    // Тема плитками в меню профиля: подпись «Как в системе» видна и не вылезает за плитку
    await page.getByRole("button", { name: /^Профиль: / }).filter({ visible: true }).first().click();
    const tiles = page.getByRole("radiogroup", { name: "Тема оформления" });
    await expect(tiles).toBeVisible();
    const system = tiles.getByRole("radio", { name: "Как в системе" });
    await expect(system).toBeVisible();
    const fits = await system.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(fits, "подпись «Как в системе» вылезает за плитку").toBe(true);
    await page.screenshot({ path: `${DIR}/tema-${test.info().project.name}-${theme}.png` });
  });
}

test("цели: шкала квартала включает отбор, карточки по командам, «Подробнее» с клавиатуры, «Факт» открывает таблицу", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/goals");
  const bar = page.getByTestId("goals-quarter-bar");
  await expect(bar.getByRole("button", { name: /^Все\s*3$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("goal-card-d68-g1")).toContainText("факт 141");
  // Отбор «В риске»: остаётся одна карточка, риск одной строкой
  await bar.getByRole("button", { name: /В риске\s*1/ }).click();
  await expect(page.locator("[data-testid^='goal-card-']")).toHaveCount(1);
  const risky = page.getByTestId("goal-card-d68-g2");
  await expect(risky).toContainText("Партнёр сдвинул интеграцию на две недели");
  // «Подробнее» с клавиатуры: Enter раскрывает задачи цели
  const more = risky.getByRole("button", { name: /^Подробнее: D2\./ });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(risky.getByRole("link").first()).toBeVisible();
  // «Факт» у числовой цели открывает таблицу на этой цели
  await bar.getByRole("button", { name: /^Все/ }).click();
  const numeric = page.getByTestId("goal-card-d68-g1");
  await numeric.getByRole("button", { name: /^Подробнее: D1\./ }).click();
  await numeric.getByRole("button", { name: "Факт" }).click();
  await expect(page.getByRole("radiogroup", { name: "Вид" }).getByRole("radio", { name: "Таблица" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("goal-row-D1")).toBeVisible();
  // Ссылка на цель (метка цели у задачи) открывает таблицу с раскрытой строкой
  await page.goto(`/goals#goal-d68-g1`);
  await expect(page.getByTestId("goal-details")).toBeVisible();
});

test("лента weekly: «Что решить» колонками, лидеры свёрнуты, раскрываются по одному и все сразу", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await page.goto("/weekly?week=2026-09-21");
  const digest = page.getByTestId("weekly-digest");
  await expect(digest).toBeVisible();
  await expect(digest.getByRole("heading").first()).toBeVisible();
  const toggle = page.getByRole("button", { name: /^Записи: \d+, / }).first();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Свернуть записи: / }).first()).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Развернуть всех" }).click();
  await expect(page.getByRole("button", { name: "Свернуть всех" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Записи: \d+, / })).toHaveCount(0);
});

test("новости: главная новость сверху, одна тема из разных источников под одной строкой, колонка «Официально» на ноутбуке", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await page.goto("/news");
  const lead = page.locator('[data-lead="true"]');
  await expect(lead).toContainText("Главное сегодня");
  await expect(lead).toContainText("Банк России обсудил со страховщиками новые тарифы ОСАГО");
  // Две новости про итоги КАСКО из разных источников: вторая под первой, «Ещё в 1 источнике»
  const more = page.getByText("Ещё в 1 источнике");
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.getByRole("link", { name: /^Интерфакс: Итоги продаж КАСКО/ })).toBeVisible();
  // Главная в ленте не повторяется: каждая новость один раз
  await expect(page.locator('[data-news-id="d68-n1"]')).toHaveCount(1);
  // «Официально» от 1280 px: регулятор и союзы этой страницы без главной новости
  if (phone()) await expect(page.getByTestId("news-official")).toBeHidden();
  else await expect(page.getByTestId("news-official")).toContainText("РСА обновил справочник средней стоимости запчастей");
});

test("справка: оглавление, пункт ведёт к разделу, раздел не прячется под шапкой", async ({ page }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/help");
  const toc = page.getByRole("navigation", { name: "Разделы справки" });
  await expect(toc).toBeVisible();
  await toc.getByTestId("toc-roadmap").click();
  await expect(page).toHaveURL(/#roadmap$/);
  await expect(page.getByRole("heading", { name: "Roadmap", level: 2 })).toBeInViewport();
  const top = await page.locator("#roadmap").evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(56);
  expect(top).toBeLessThan(phone() ? 260 : 200);
  await expect(toc.getByTestId("toc-roadmap")).toHaveAttribute("aria-current", "location");
});

test("«Новая задача»: на телефоне одна кнопка в шапке «Задач», на ноутбуке в верхней панели высотой с поле поиска", async ({ page }) => {
  await enter(page, "Рева Тарас");
  if (phone()) {
    await page.goto("/tasks");
    await expect(page.getByRole("button", { name: "Новая задача" }).filter({ visible: true })).toHaveCount(1);
    return;
  }
  const bar = page.locator(".sv-topbar");
  const button = await bar.getByRole("button", { name: "Новая задача" }).boundingBox();
  const search = await bar.locator(".sv-topbar__search").boundingBox();
  expect(button && search && Math.abs(button.height - search.height)).toBeLessThanOrEqual(4);
});

test("«Моя неделя»: счётчики «Требует внимания» ведут к группам «Мне», срок сдачи крупно", async ({ page }) => {
  await sql(`UPDATE tasks SET due = CURRENT_DATE - 3 WHERE number = (SELECT min(number) FROM tasks WHERE "ownerId" = ${person("reva")} AND status = 'IN_PROGRESS' AND "archivedAt" IS NULL)`);
  await enter(page, "Рева Тарас");
  const figures = page.getByTestId("my-attention-figures");
  await expect(figures).toBeVisible();
  await figures.getByRole("link", { name: /срок прошёл/ }).click();
  await expect(page).toHaveURL(/\/me#me-late$/);
  await expect(page.getByTestId("me-late")).toBeVisible();
});

test("приветствие: «Начать работу» выше формы почты", async ({ page }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/welcome");
  const start = await page.getByTestId("welcome-start").boundingBox();
  const email = await page.locator("#welcome-email").boundingBox();
  expect(start && email && start.y < email.y).toBe(true);
});

// Экраны с таблицами и лентами, которые на 360 должны прокручиваться внутри себя
const WIDE = ["/", "/tasks", "/tasks/people", "/goals", "/roadmap", "/initiatives", "/decisions", "/forecast", "/forecast?tab=week", "/one-on-one", "/people", "/people/leader", "/people/analytics", "/people/structure", "/people/teams", "/weekly", "/weekly/meeting", "/ceo-report", "/settings", "/help", "/news"];

test("360: страница не прокручивается вбок, широкие обёртки прокручиваются внутри себя и доступны с клавиатуры", async ({ page }) => {
  test.skip(!phone(), "Проверка телефона 360");
  test.setTimeout(180_000);
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  const problems: string[] = [];
  for (const path of WIDE) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const r = await page.evaluate(() => {
      const doc = document.documentElement;
      const wraps = [...document.querySelectorAll<HTMLElement>("main *")].filter((el) => {
        const s = getComputedStyle(el);
        return (s.overflowX === "auto" || s.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1;
      });
      // Обёртка, которая прокручивается вбок: до неё можно дойти с клавиатуры (своя фокусировка или ссылки и кнопки внутри)
      const unreachable = wraps.filter((el) => el.tabIndex < 0 && !el.querySelector("a, button, input, select, textarea, [tabindex]")).map((el) => el.className.toString().slice(0, 60));
      return { page: doc.scrollWidth - doc.clientWidth, unreachable };
    });
    if (r.page > 1) problems.push(`${path}: страница шире экрана на ${r.page} px`);
    if (r.unreachable.length) problems.push(`${path}: прокручиваемые обёртки без фокуса с клавиатуры: ${r.unreachable.join("; ")}`);
  }
  expect(problems).toEqual([]);
});
