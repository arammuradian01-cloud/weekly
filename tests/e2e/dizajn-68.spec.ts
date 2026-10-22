import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";
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
  // Задача работает на цель подписки: в карточке цели видно «закрыто 0 из 1»
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
  { name: "rukovoditelyu", path: "/people/leader", contrast: true, ready: async (page) => void (await expect(page.getByTestId("mt-team-cards")).toBeVisible()) },
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

/** Нижняя граница липкой шапки: верхняя панель на ноутбуке или шапка сайта на телефоне (видна одна из двух) */
async function headerBottom(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(0, ...[...document.querySelectorAll(".sv-shell__top, .sv-shell__header")].map((el) => (el.getBoundingClientRect().height ? el.getBoundingClientRect().bottom : 0))));
}

/** Контраст двух цветов фона по WCAG: отрезок шкалы к дорожке */
async function bgContrast(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(
    ([sa, sb]) => {
      const rgb = (sel: string) => (getComputedStyle(document.querySelector(sel)!).backgroundColor.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = (c: number[]) => {
        const [r, g, bl] = c.map((v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
      };
      const [l1, l2] = [lum(rgb(sa)), lum(rgb(sb))].sort((x, y) => y - x);
      return (l1! + 0.05) / (l2! + 0.05);
    },
    [a, b],
  );
}

test("цели: шкала квартала включает отбор, карточки по командам, «Подробнее» с клавиатуры, «Факт» открывает таблицу", async ({ page }) => {
  // На время проверки ещё две цели: закрыта частично и в работе с задачей (без риска, факт не нужен: цель текстовая)
  await sql(
    `INSERT INTO goals (id, quarter, code, title, "teamId", "ownerId", result, "sortOrder", "updatedAt") VALUES
      ('d68-g4', $1, 'D4', 'Кросс-продажи НС к ОСАГО', 'top', ${person("fatyanov")}, 'PARTIAL', 4, now()),
      ('d68-g5', $1, 'D5', 'Витрина ВЗР у партнёра', 'top', ${person("fatyanov")}, 'IN_PROGRESS', 5, now())`,
    [quarterNow()],
  );
  await sql(`UPDATE tasks SET "goalId" = 'd68-g5', due = (now() AT TIME ZONE 'Europe/Moscow')::date + 10 WHERE number = (SELECT min(number) FROM tasks WHERE "ownerId" = ${person("fatyanov")} AND status = 'IN_PROGRESS' AND "archivedAt" IS NULL AND "goalId" IS NULL)`);
  try {
    await enter(page, "Мурадян Арам");
    await enterManagement(page, "owner");
    await page.goto("/goals");
    const bar = page.getByTestId("goals-quarter-bar");
    await expect(bar.getByRole("button", { name: /^Все\s*5$/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("goal-card-d68-g1")).toContainText("факт 141");
    // Отборы взаимоисключающие: D1 без задач, D2 в риске, D3 достигнута, D4 закрыта частично, D5 в работе
    for (const name of ["Достигнуты", "В риске", "Без задач", "Закрыты не полностью", "В работе"]) await expect(bar.getByRole("button", { name: new RegExp(`^${name}\\s*1$`) })).toBeVisible();
    await expect(bar.getByRole("button", { name: /Без свежего факта/ })).toHaveCount(0);
    // Сумма по кнопкам равна числу целей
    const counters = await bar.getByRole("button").filter({ hasNotText: /^Все/ }).locator(".sv-counter").allTextContents();
    expect(counters.map(Number).reduce((x, y) => x + y, 0)).toBe(5);
    // Ширина отрезка: доля от всех целей (одна из пяти), полоса не шире карточки, отрезок в одну цель виден
    const track = bar.locator("[aria-hidden='true']").first();
    expect(await track.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const share = await bar.getByTestId("goals-bar-risk").evaluate((el) => el.getBoundingClientRect().width / el.parentElement!.getBoundingClientRect().width);
    expect(share).toBeGreaterThan(0.17);
    expect(share).toBeLessThan(0.21);
    for (const key of ["done", "risk", "notasks", "closed", "work"]) expect((await bar.getByTestId(`goals-bar-${key}`).boundingBox())!.width).toBeGreaterThanOrEqual(4);
    // Серый отрезок «В работе» держит 3:1 к дорожке шкалы в обеих темах
    const sel = ["[data-testid='goals-bar-work']", "[data-testid='goals-quarter-bar'] > [aria-hidden='true']"] as const;
    expect(await bgContrast(page, ...sel)).toBeGreaterThanOrEqual(3);
    await page.context().addCookies([{ name: "theme", value: "dark", url: "http://localhost:3100" }]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await bgContrast(page, ...sel)).toBeGreaterThanOrEqual(3);
    await page.context().addCookies([{ name: "theme", value: "light", url: "http://localhost:3100" }]);
    await page.reload();
    // Отбор «Закрыты не полностью»: только D4
    await bar.getByRole("button", { name: /Закрыты не полностью/ }).click();
    await expect(page.locator("[data-testid^='goal-card-']")).toHaveCount(1);
    await expect(page.getByTestId("goal-card-d68-g4")).toBeVisible();
    // Отбор «В риске»: остаётся одна карточка, риск одной строкой
    await bar.getByRole("button", { name: /В риске\s*1/ }).click();
    await expect(page.locator("[data-testid^='goal-card-']")).toHaveCount(1);
    const risky = page.getByTestId("goal-card-d68-g2");
    await expect(risky).toContainText("Партнёр сдвинул интеграцию на две недели");
    // «Подробнее» с клавиатуры: Enter раскрывает задачи цели
    const more = risky.getByRole("button", { name: /^Подробнее: D2\./ });
    await more.focus();
    await page.keyboard.press("Enter");
    // Имя кнопки сменилось на «Свернуть: ...», фокус остался на ней
    const less = risky.getByRole("button", { name: /^Свернуть: D2\./ });
    await expect(less).toHaveAttribute("aria-expanded", "true");
    await expect(less).toBeFocused();
    await expect(risky.getByRole("link").first()).toBeVisible();
    // «Факт» у числовой цели открывает таблицу с раскрытой строкой этой цели, поиск не трогает
    await bar.getByRole("button", { name: /^Все/ }).click();
    const numeric = page.getByTestId("goal-card-d68-g1");
    await numeric.getByRole("button", { name: /^Подробнее: D1\./ }).click();
    await numeric.getByRole("button", { name: "Факт" }).click();
    await expect(page.getByRole("radiogroup", { name: "Вид" }).getByRole("radio", { name: "Таблица" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("goal-row-D1")).toBeVisible();
    await expect(page.getByTestId("goal-details")).toBeVisible();
    await expect(page.getByLabel("Поиск цели")).toHaveValue("");
    await expect(page.getByTestId("goal-row-D2")).toBeVisible();
    // Ссылка на цель (метка цели у задачи) открывает таблицу с раскрытой строкой
    await page.goto(`/goals#goal-d68-g1`);
    await expect(page.getByTestId("goal-details")).toBeVisible();
  } finally {
    await sql(`UPDATE tasks SET "goalId" = NULL WHERE "goalId" IN ('d68-g4', 'd68-g5')`);
    await sql(`DELETE FROM goals WHERE id IN ('d68-g4', 'd68-g5')`);
  }
});

test("цели: «Факт» не виден без права вписывать факт и править цель", async ({ page }) => {
  // Общий вход Ревы: цель D1 не его и не его команды, факт не вписывает
  await enter(page, "Рева Тарас");
  await page.goto("/goals");
  const numeric = page.getByTestId("goal-card-d68-g1");
  await numeric.getByRole("button", { name: /^Подробнее: D1\./ }).click();
  await expect(numeric.getByRole("button", { name: /^Свернуть: D1\./ })).toHaveAttribute("aria-expanded", "true");
  await expect(numeric.getByRole("button", { name: "Факт" })).toHaveCount(0);
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
  // С любым фильтром карточки лидеров не сворачиваются: отобранные записи видны сразу, кнопок «Записи» нет.
  // Записи типа «Результат» за эту неделю есть минимум у двух лидеров (проверяем в базе до фильтра)
  const results = await sql(
    `SELECT p.slug, e.what FROM weekly_entries e JOIN weeks w ON w.id = e."weekId" JOIN dictionary_items d ON d.id = e."typeId" JOIN people p ON p.id = e."authorId"
      WHERE w.start = '2026-09-21' AND d.code = 'result' ORDER BY p.slug, e."sortOrder", e.id`,
  );
  const byLeader = new Map<string, string>();
  for (const r of results) if (!byLeader.has(r.slug as string)) byLeader.set(r.slug as string, r.what as string);
  expect(byLeader.size, "записи «Результат» за неделю 21.09 у двух лидеров").toBeGreaterThanOrEqual(2);
  await page.goto("/weekly?week=2026-09-21");
  await expect(page.getByRole("button", { name: /^Записи: \d+, / }).first()).toBeVisible();
  await page.getByRole("button", { name: "Фильтры" }).click();
  await page.locator("#f-type").selectOption("result");
  await expect(page.getByRole("button", { name: /^(Записи: \d+|Свернуть записи): / })).toHaveCount(0);
  expect(await page.locator("[data-testid^='weekly-leader-']").count()).toBeGreaterThan(2);
  for (const [slug, what] of [...byLeader].slice(0, 2)) await expect(page.getByTestId(`weekly-leader-${slug}`).getByText(what).first()).toBeVisible();
});

test("люди: «сдают все» в подсказке и у команды со сроком департамента", async ({ page }) => {
  await sql(`INSERT INTO teams (id, name, kind, "leaderId", "specialistsWeekly", "updatedAt") VALUES ('e2e-team68', 'Тест 68: команда вкладов', 'CUSTOM', ${person("reva")}, true, now()) ON CONFLICT (id) DO NOTHING`);
  await sql(`INSERT INTO team_members ("teamId", "personId") SELECT 'e2e-team68', id FROM people WHERE slug = 'cheychenets' ON CONFLICT DO NOTHING`);
  try {
    // Личный вход: общий логин без режима управления видит только топ-команду
    await enterByLink(page, "reva");
    await page.context().addCookies([{ name: "team", value: "e2e-team68", url: "http://localhost:3100" }]);
    await page.goto("/people");
    await expect(page.getByRole("heading", { name: "Тест 68: команда вкладов", level: 2 })).toBeVisible();
    // Свой срок не задан (срок департамента): срок не пишется, «сдают все» пишется
    await expect(page.getByText("Задачи и weekly за отчётную неделю, сдают все", { exact: true })).toBeVisible();
  } finally {
    // Команда Ревы только для этой проверки: остальные тесты файла видят прежнюю структуру
    await sql(`DELETE FROM team_members WHERE "teamId" = 'e2e-team68'`);
    await sql(`DELETE FROM teams WHERE id = 'e2e-team68'`);
  }
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
  await expect(page.getByRole("link", { name: /^Интерфакс\s?: Итоги продаж КАСКО/ })).toBeVisible();
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
  const header = await headerBottom(page);
  expect(header).toBeGreaterThan(0);
  expect(top).toBeGreaterThanOrEqual(header);
  expect(top).toBeLessThan(header + (phone() ? 200 : 140));
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

test("«Моя неделя»: счётчики «Требует внимания» ведут к группам «Мне», срок сдачи прошёл и написан красным", async ({ page }) => {
  await sql(`UPDATE tasks SET due = (now() AT TIME ZONE 'Europe/Moscow')::date - 3 WHERE number = (SELECT min(number) FROM tasks WHERE "ownerId" = ${person("reva")} AND status = 'IN_PROGRESS' AND "archivedAt" IS NULL)`);
  await enter(page, "Рева Тарас");
  const figures = page.getByTestId("my-attention-figures");
  await expect(figures).toBeVisible();
  // Срок сдачи отчётной недели в базе уже прошёл: подпись и значение красные без условий (цвет у самих строк). На
  // телефоне блок срока скрыт, но разметка и цвет те же
  const number = Number((await page.getByRole("heading", { name: /^Мой weekly за неделю \d+$/ }).textContent())!.match(/\d+$/)![0]);
  const [week] = await sql(`SELECT id, deadline FROM weeks WHERE "isoNumber" = $1 ORDER BY start DESC LIMIT 1`, [number]);
  await sql(`UPDATE weeks SET deadline = now() - interval '1 hour' WHERE id = $1`, [week!.id]);
  try {
    await page.reload();
    const deadline = page.getByTestId("my-deadline");
    await expect(deadline).toHaveAttribute("data-late", "true");
    await expect(deadline).toContainText("Срок прошёл");
    const red = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.className = "text-danger-ink";
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    const lines = await deadline.locator("span").all();
    expect(lines.length).toBe(2);
    for (const line of lines) expect(await line.evaluate((el) => getComputedStyle(el).color)).toBe(red);
  } finally {
    await sql(`UPDATE weeks SET deadline = $2 WHERE id = $1`, [week!.id, week!.deadline]);
  }
  await page.reload();
  await figures.getByRole("link", { name: /срок прошёл/ }).click();
  await expect(page).toHaveURL(/\/me#me-late$/);
  await expect(page.getByTestId("me-late")).toBeVisible();
  // Заголовок группы не уходит под липкую шапку: верх заголовка ниже нижней границы шапки
  const top = await page.locator("#me-late").evaluate((el) => el.getBoundingClientRect().top);
  const header = await headerBottom(page);
  expect(header).toBeGreaterThan(0);
  expect(top).toBeGreaterThanOrEqual(header);
});

test("«Моя неделя»: «Ещё N в «Мне»» ведёт в группу, где остались непоказанные задачи", async ({ page }) => {
  const MSK = "(now() AT TIME ZONE 'Europe/Moscow')::date";
  const reva = person("reva");
  // Задачи Ревы и «Все лидеры» (они тоже его) на время проверки: срок далеко, потом шесть своих задач по сценарию
  const mine = `status IN ('IN_PROGRESS', 'CLARIFY', 'PROPOSED') AND "archivedAt" IS NULL AND ("ownerId" = ${reva} OR "ownerId" IS NULL OR id IN (SELECT "taskId" FROM task_co_executors WHERE "personId" = ${reva}))`;
  const saved = await sql(`SELECT number, "ownerId", due::text AS due FROM tasks WHERE ${mine} OR number IN (SELECT number FROM tasks WHERE "teamId" = 'top' AND status = 'IN_PROGRESS' AND "archivedAt" IS NULL AND "ownerId" IS NOT NULL ORDER BY number LIMIT 6)`);
  try {
    await sql(`UPDATE tasks SET due = ${MSK} + 20 WHERE ${mine}`);
    // Только задачи с одним ответственным: у задачи «Все лидеры» ответственного не поставить (ownerAll)
    const six = (await sql(`SELECT number FROM tasks WHERE "teamId" = 'top' AND status = 'IN_PROGRESS' AND "archivedAt" IS NULL AND "ownerId" IS NOT NULL ORDER BY number LIMIT 6`)).map((r) => r.number as number);
    await sql(`UPDATE tasks SET "ownerId" = ${reva}, due = ${MSK} - 3 WHERE number = ANY($1)`, [six]);
    await enter(page, "Рева Тарас");
    // Шесть просроченных: пять в списке, шестая просроченная, ссылка на «Срок прошёл»
    const more = page.getByTestId("my-urgent-more");
    await expect(more).toHaveText("Ещё 1 в «Мне»");
    await expect(more).toHaveAttribute("href", "/me#me-late");
    // Две просроченные и четыре на сегодня: в списке обе просроченные и три срочные, осталась срочная
    await sql(`UPDATE tasks SET due = ${MSK} WHERE number = ANY($1)`, [six.slice(2)]);
    await page.reload();
    await expect(more).toHaveText("Ещё 1 в «Мне»");
    await expect(more).toHaveAttribute("href", "/me#me-soon");
  } finally {
    for (const r of saved) await sql(`UPDATE tasks SET "ownerId" = $2, due = $3::date WHERE number = $1`, [r.number, r.ownerId, r.due]);
  }
});

test("приветствие: «Начать работу» выше формы почты", async ({ page }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/welcome");
  const start = await page.getByTestId("welcome-start").boundingBox();
  const email = await page.locator("#welcome-email").boundingBox();
  expect(start && email && start.y < email.y).toBe(true);
});

test("карточка задачи: поле «Начало» задаётся и убирается тем, кто меняет срок; без прав только просмотр", async ({ page }) => {
  const [own] = await sql(`SELECT t.number FROM tasks t JOIN people p ON p.id = t."ownerId" WHERE p.slug = 'reva' AND t.status = 'IN_PROGRESS' AND t."archivedAt" IS NULL ORDER BY t.number LIMIT 1`);
  const n = own!.number as number;
  await sql(`UPDATE tasks SET due = (now() AT TIME ZONE 'Europe/Moscow')::date + 20, "startOn" = NULL WHERE number = $1`, [n]);
  await enter(page, "Рева Тарас");
  await page.goto(`/tasks/${n}`);
  await page.getByRole("button", { name: `Задать начало задачи ${n}` }).click();
  const input = page.getByLabel(`Начало задачи ${n}`);
  const [{ d, due }] = await sql(`SELECT ((now() AT TIME ZONE 'Europe/Moscow')::date + 3)::text AS d, due::text AS due FROM tasks WHERE number = $1`, [n]);
  // Начальное значение не позже срока, подсказка «Не позже срока» связана с полем
  expect((await input.inputValue()) <= (due as string)).toBe(true);
  await expect(input).toHaveAttribute("aria-describedby", `task-start-${n}-hint`);
  await expect(page.locator(`#task-start-${n}-hint`)).toContainText("Не позже срока");
  // «Отмена» возвращает фокус на «Задать»
  await page.locator("form").filter({ has: input }).getByRole("button", { name: "Отмена" }).click();
  await expect(page.getByRole("button", { name: `Задать начало задачи ${n}` })).toBeFocused();
  await page.getByRole("button", { name: `Задать начало задачи ${n}` }).click();
  await input.fill(d as string);
  await page.locator("form").filter({ has: input }).getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText(`Начало задачи ${n}:`).first()).toBeVisible();
  await expect(page.getByTestId("task-start")).not.toContainText("Не задано");
  // После «Сохранить» фокус на «Изменить»
  await expect(page.getByRole("button", { name: `Изменить начало задачи ${n}` })).toBeFocused();
  const [saved] = await sql(`SELECT "startOn"::text AS s FROM tasks WHERE number = $1`, [n]);
  expect(saved!.s).toBe(d);
  // Другой лидер видит начало, но не меняет: кнопок нет
  const ctx = await page.context().browser()!.newContext({ viewport: page.viewportSize()!, isMobile: phone(), hasTouch: phone() });
  const other = await ctx.newPage();
  await enter(other, "Логинова Светлана");
  await other.goto(`/tasks/${n}`);
  await expect(other.getByTestId("task-start")).toBeVisible();
  await expect(other.getByRole("button", { name: new RegExp(`начало задачи ${n}`) })).toHaveCount(0);
  await ctx.close();
  // Убрать: начало снова от даты постановки
  await page.getByRole("button", { name: `Убрать начало задачи ${n}` }).click();
  await expect(page.getByText(`Начало задачи ${n} убрано`).first()).toBeVisible();
  // После «Убрать» фокус на «Задать»
  await expect(page.getByRole("button", { name: `Задать начало задачи ${n}` })).toBeFocused();
  const [cleared] = await sql(`SELECT "startOn" FROM tasks WHERE number = $1`, [n]);
  expect(cleared!.startOn).toBeNull();
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
