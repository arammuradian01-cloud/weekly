import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 62: рынок КАСКО и ОСАГО. Владелец при личном входе загружает пакет рынка (синтетический
// tests/fixtures/market/bundle.json, цифры выдуманные), дашборд работает в изолированном окне: расчёты, фильтр и
// вкладка внутри окна, вкладка и фильтр в адресе страницы. Владелец открывает раздел Реве в настройках, Рева видит
// пункт меню и дашборд. Логинова не из списка и вход по общему логину: пункта меню нет, раздел закрыт, данных нет.
// На первой встрече месяца первым пунктом разбор рынка, кнопка «Открыть рынок» только у тех, кому раздел открыт.
// Ноутбук 1440 и телефон 360 без горизонтальной прокрутки

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

const BUNDLE = "tests/fixtures/market/bundle.json";
const FRAME = '[data-testid="market-frame"]';

const isPhone = () => test.info().project.name === "phone";

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-market-${name}.png`, fullPage: true });
}

async function personal(browser: Browser, page: Page, slug: string) {
  const p = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: isPhone(), hasTouch: isPhone() })).newPage();
  await enterByLink(p, slug);
  return p;
}

async function teamLogin(browser: Browser, page: Page, fullName: string) {
  const p = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: isPhone(), hasTouch: isPhone() })).newPage();
  await enter(p, fullName);
  return p;
}

/** Ссылка «Рынок» в меню: на ноутбуке в боковом меню, на телефоне в панели «Ещё» */
async function marketLinks(page: Page) {
  if (isPhone()) {
    await page.getByRole("button", { name: "Ещё" }).click();
    return page.getByRole("dialog", { name: "Разделы" }).getByRole("link", { name: "Рынок", exact: true });
  }
  return page.getByRole("navigation", { name: "Разделы" }).filter({ visible: true }).first().getByRole("link", { name: "Рынок", exact: true });
}

/** Пакет загружается тем же обработчиком, что и кнопкой: тело запроса файл пакета */
async function upload(page: Page) {
  return page.request.post("/api/market/upload", { headers: { "Content-Type": "application/json" }, data: readFileSync(BUNDLE) });
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("владелец загружает пакет, вкладка и фильтр работают внутри окна и живут в адресе, Рева из списка видит раздел", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await enterByLink(page, "muradyan");
  await page.goto("/market");
  await expect(page.getByRole("heading", { name: "Рынок КАСКО и ОСАГО", level: 1 })).toBeVisible();
  await expect(page.getByText("Данных рынка пока нет")).toBeVisible();
  await shot(page, "empty");

  await page.getByTestId("market-upload-input").setInputFiles(BUNDLE);
  await expect(page.getByText("Пакет рынка загружен: 2 набора данных, 6 строк").first()).toBeVisible();
  await expect(page.getByTestId("market-meta")).toContainText("загрузил Мурадян Арам");
  await expect(page.getByTestId("market-meta")).toContainText("Данные от ");
  // Окно изолировано: только скрипты, без своего источника
  await expect(page.locator(FRAME)).toHaveAttribute("sandbox", "allow-scripts");
  const frame = page.frameLocator(FRAME);
  await expect(frame.locator("#k-total")).toHaveText("42");
  // Расчёт с исключением даёт ошибку, остальное работает; d3 из пакета подключён до кода страницы
  await expect(frame.locator("#k-status")).toHaveText("Расчёт с ошибкой: error, d3: заглушка");
  // Блок обновления данных внутри дашборда спрятан: обновление у нас загрузкой пакета
  await expect(frame.locator("#c-import")).toBeHidden();

  // Фильтр внутри окна пересчитывает и попадает в адрес
  await frame.locator("#metric").selectOption("prem");
  await expect(frame.locator("#k-total")).toHaveText("6");
  await expect(page).toHaveURL(/[?&]metric=prem/);
  // Вкладка ОСАГО внутри окна и в адресе
  await frame.getByRole("tab", { name: "ОСАГО" }).click();
  await expect(frame.locator("#o-count")).toHaveText("2");
  await expect(page).toHaveURL(/[?&]tab=osago/);
  await shot(page, "owner");

  // Ссылкой открывается та же вкладка с тем же фильтром
  await page.reload();
  await expect(frame.getByRole("tab", { name: "ОСАГО" })).toHaveAttribute("aria-selected", "true");
  await expect(frame.locator("#o-count")).toHaveText("2");
  await frame.getByRole("tab", { name: "КАСКО" }).click();
  await expect(frame.locator("#k-total")).toHaveText("6");
  await expect(frame.locator("#metric")).toHaveValue("prem");

  // В журнале только счёт наборов и строк
  const [log] = await sql(`SELECT after, via FROM audit_log WHERE action = 'market.upload' ORDER BY id DESC LIMIT 1`);
  expect(log).toMatchObject({ after: "Наборов 2, строк 6, файлов кода 3" });
  expect(log!.via).not.toBe("TEAM");

  // Владелец открывает раздел Реве в настройках
  await enterManagement(page, "owner");
  await page.goto("/settings#market");
  const section = page.getByTestId("market-settings");
  await expect(section.getByRole("heading", { name: "Рынок КАСКО и ОСАГО" })).toBeVisible();
  await section.getByLabel("Люди с доступом").fill("Рева");
  await page.getByRole("option", { name: /Рева Тарас/ }).click();
  await section.getByTestId("market-settings-save").click();
  await expect(page.getByText("Настройка рынка сохранена").first()).toBeVisible();
  await expect(section.getByTestId("market-settings-count")).toContainText("Сейчас раздел видят 2 человека, из них владельцев 1");
  await shot(page, "settings");
  const [setting] = await sql(`SELECT value FROM settings WHERE key = 'market.access'`);
  expect(setting!.value).toEqual({ people: ["reva"] });

  // Рева при личном входе: пункт меню, дашборд с данными, без кнопки загрузки
  const reva = await personal(browser, page, "reva");
  const link = await marketLinks(reva);
  await expect(link).toBeVisible();
  await link.click();
  await expect(reva).toHaveURL(/\/market$/);
  const revaFrame = reva.frameLocator(FRAME);
  await expect(revaFrame.locator("#k-total")).toHaveText("42");
  await revaFrame.getByRole("tab", { name: "ОСАГО" }).click();
  await expect(revaFrame.locator("#o-count")).toHaveText("2");
  await expect(reva).toHaveURL(/\/market\?tab=osago$/);
  await expect(reva.getByTestId("market-upload")).toHaveCount(0);
  await shot(reva, "reva");
});

test("человек не из списка и общий логин: пункта меню нет, раздел закрыт, данных и загрузки нет", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const owner = await personal(browser, page, "muradyan");
  expect((await upload(owner)).status()).toBe(200);
  await sql(`INSERT INTO settings (key, value, "updatedAt") VALUES ('market.access', '{"people": ["reva"]}'::jsonb, now())`);

  // Логинова при личном входе
  await enterByLink(page, "loginova");
  await expect(await marketLinks(page)).toHaveCount(0);
  await page.goto("/market");
  await expect(page.getByTestId("market-closed")).toHaveText("Раздел открыт отдельным людям, доступ даёт владелец.");
  await expect(page.locator(FRAME)).toHaveCount(0);
  await expect(page.getByTestId("market-upload")).toHaveCount(0);
  const data = await page.request.get("/api/market/data");
  expect(data.status()).toBe(403);
  expect(await data.text()).not.toContain("k_demo");
  expect((await upload(page)).status()).toBe(403);
  await shot(page, "closed");

  // Рева из списка, но по общему логину: раздела нет
  const team = await teamLogin(browser, page, "Рева Тарас");
  await expect(await marketLinks(team)).toHaveCount(0);
  await team.goto("/market");
  await expect(team.getByTestId("market-closed")).toBeVisible();
  await expect(team.getByText("только при личном входе")).toBeVisible();
  expect((await team.request.get("/api/market/data")).status()).toBe(403);
});

test("первая встреча месяца начинается с разбора рынка; кнопку видят только те, кому раздел открыт", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await enterByLink(page, "muradyan");
  expect((await upload(page)).status()).toBe(200);
  await enterManagement(page, "owner");
  await page.goto("/weekly/meeting");
  await page.getByRole("button", { name: "Собрать повестку" }).click();
  await expect(page.getByText("Повестка собрана").first()).toBeVisible();

  // Встреч топ-команды раньше в этом месяце нет (база с чистого листа): первым пунктом рынок
  const [first] = await sql(`SELECT a.kind, a.title FROM agenda_items a JOIN meetings m ON m.id = a."meetingId" WHERE m."teamId" = 'top' ORDER BY a."sortOrder" LIMIT 1`);
  expect(first!.kind).toBe("MARKET");
  expect(first!.title).toMatch(/^Рынок КАСКО и ОСАГО: итоги [а-я]+( \d{4})?$/);
  await expect(page.getByRole("heading", { level: 2, name: first!.title })).toBeVisible();
  await expect(page.getByTestId("agenda-market-open")).toHaveAttribute("href", "/market");
  await shot(page, "meeting");

  // Пересборка повестки пункт не дублирует
  await page.getByRole("button", { name: "Обновить повестку" }).click();
  await expect(page.getByText("Повестка обновлена").first()).toBeVisible();
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM agenda_items WHERE kind = 'MARKET'`);
  expect(n).toBe(1);

  // Логинова видит пункт, но рынок ей закрыт
  const loginova = await personal(browser, page, "loginova");
  await loginova.goto("/weekly/meeting");
  await expect(loginova.getByRole("heading", { level: 2, name: first!.title })).toBeVisible();
  await expect(loginova.getByTestId("agenda-market-closed")).toHaveText("Разбор рынка: открывают участники с доступом");
  await expect(loginova.getByTestId("agenda-market-open")).toHaveCount(0);
  await shot(loginova, "meeting-closed");
});
