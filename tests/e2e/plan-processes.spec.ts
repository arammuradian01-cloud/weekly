import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 35: прогноз месяца в процессах. После загрузки LBE лидер ОСАГО получает событие в «Мне», открывает прогноз и
// отмечает «Прогноз проверен». Владелец загружает факт по дням и видит темп к прогнозу, сравнивает версии месяца,
// выгружает Excel. Прогноз месяца виден в отчёте CEO и на встрече топ-команды. Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-plan35-${name}.png`, fullPage: true });
}

const moscowToday = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
const ru = (iso: string) => iso.split("-").reverse().join(".");
/** Понедельник текущей недели по Москве: ключ недели. Отчёт и встреча по умолчанию открывают неделю из данных теста */
const thisWeek = () => {
  const d = new Date(`${moscowToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
  await sql(`DELETE FROM plan_facts`);
  await sql(`DELETE FROM plan_checks`);
  await sql(`DELETE FROM plan_pulls`);
  await sql(`DELETE FROM plan_adjustments`);
  await sql(`DELETE FROM plan_lines`);
  await sql(`DELETE FROM settings WHERE key LIKE 'plan.%'`);
});

async function pull(page: Page) {
  await page.goto("/forecast");
  await page.getByTestId("plan-pull-open").click();
  const drawer = page.getByRole("dialog", { name: "Бюджет и LBE из LRF" });
  await drawer.getByTestId("plan-pull-check").click();
  await expect(drawer.getByTestId("plan-pull-preview").getByText("Всё читается")).toBeVisible();
  await drawer.getByTestId("plan-pull-load").click();
  await expect(page.getByText(/Бюджет и LBE на .* загружены/).first()).toBeVisible();
}

test("после загрузки LBE: событие в «Мне», «Прогноз проверен», факт по дням, сравнение версий и выгрузка", async ({ page }) => {
  test.setTimeout(90_000);
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await pull(page);
  // Все продукты ждут проверки
  await expect(page.getByTestId("plan-waiting-osago")).toBeVisible();

  // Лидер ОСАГО по личному входу: событие в «Мне» ведёт в прогноз месяца
  await page.context().clearCookies();
  await enterByLink(page, "golovkin");
  await page.goto("/me");
  const event = page.getByRole("link", { name: "Прогноз месяца" });
  await expect(event).toBeVisible();
  await expect(page.getByText(/Загружен LBE на .*Проверьте прогноз: ОСАГО/)).toBeVisible();
  await shot(page, "inbox");
  await event.click();
  await expect(page).toHaveURL(/\/forecast\?month=\d{4}-\d{2}/);
  const card = page.locator("#plan-product-osago");
  await expect(card.getByTestId("plan-review")).toContainText("ждёт проверки после загрузки LBE");
  await card.getByTestId("plan-check").click();
  await expect(page.getByText("ОСАГО: прогноз отмечен проверенным").first()).toBeVisible();
  await expect(card.getByTestId("plan-review")).toContainText("проверен без корректировок: Головкин В.");
  await expect(card.getByTestId("plan-check")).toHaveCount(0);
  await expect(page.getByTestId("plan-waiting-osago")).toHaveCount(0);
  // Выгрузка в Excel у команды продукта есть
  const href = await page.getByTestId("plan-export").getAttribute("href");
  const file = await page.request.get(href!);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toContain("spreadsheetml");
  expect(file.headers()["content-disposition"]).toMatch(/prognoz-\d{4}-\d{2}\.xlsx/);

  // Владелец загружает факт по дням: сначала ошибка в строке, потом верная вставка
  await page.context().clearCookies();
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/forecast");
  const day = moscowToday().slice(0, 8) + "01";
  await page.getByTestId("plan-facts-open").click();
  const drawer = page.getByRole("dialog", { name: "Факт по дням" });
  await drawer.getByLabel("Строки отчёта").fill(["Дата\tПродукт\tПродажи\tВыручка, млн", `${ru(day)}\tОСАГО\t9000\t15,5`, `${ru(day)}\tНет такого\t1\t1`].join("\n"));
  await drawer.getByTestId("plan-facts-check").click();
  await expect(drawer.getByText(/Строка 3: продукт «Нет такого» не найден/)).toBeVisible();
  await expect(drawer.getByTestId("plan-facts-load")).toBeDisabled();
  await drawer.getByLabel("Строки отчёта").fill(["Дата\tПродукт\tПродажи\tВыручка, млн", `${ru(day)}\tОСАГО\t9000\t15,5`].join("\n"));
  await drawer.getByTestId("plan-facts-check").click();
  await expect(drawer.getByTestId("plan-facts-preview")).toContainText("Строк 1, значений 2");
  await shot(page, "facts-drawer");
  await drawer.getByTestId("plan-facts-load").click();
  await expect(page.getByText("Факт загружен: значений 2").first()).toBeVisible();
  await page.getByRole("radiogroup", { name: "Продукт" }).getByRole("radio", { name: "ОСАГО" }).click();
  const facts = page.locator("#plan-product-osago").getByTestId("plan-facts");
  await expect(facts.getByTestId("plan-fact-revenue")).toContainText("15,5");
  await expect(facts.getByTestId("plan-fact-units")).toContainText("9 000");
  await expect(page.getByTestId("plan-stat-fact")).toContainText("15,5");
  await shot(page, "facts");

  // Сравнение версий: бюджет против прогноза сейчас, затем LBE против прогноза
  await page.getByTestId("tab-compare").click();
  const compare = page.getByTestId("plan-compare");
  await expect(compare.getByLabel("Версия А")).toHaveValue("budget");
  await expect(compare.getByLabel("Версия Б")).toHaveValue("forecast");
  await expect(compare.getByTestId("plan-compare-osago")).toContainText("440,0");
  await expect(compare.getByTestId("plan-compare-osago")).toContainText("450,0");
  await compare.getByLabel("Версия А").selectOption("lbe");
  await expect(page).toHaveURL(/a=lbe/);
  await expect(compare.getByTestId("plan-compare-total")).toContainText("0");
  await compare.getByRole("radiogroup", { name: "Показатель" }).getByRole("radio", { name: "Продажи" }).click();
  await expect(compare.getByTestId("plan-compare-total")).toHaveCount(0);
  await shot(page, "compare");
});

test("прогноз месяца в отчёте CEO и на встрече топ-команды; кто ещё не проверил", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await pull(page);
  await page.goto(`/ceo-report?week=${thisWeek()}`);
  const brief = page.getByTestId("plan-brief").first();
  await expect(brief).toBeVisible();
  await expect(page.getByTestId("plan-brief-revenue")).toContainText("млн");
  await expect(page.getByTestId("plan-brief-waiting")).toContainText("Ждут проверки после загрузки LBE: ОСАГО, КАСКО");
  await expect(page.getByTestId("plan-brief-waiting")).toContainText("Проверяют: Головкин Владислав, Рева Тарас, Фатьянов Евгений");
  await expect(page.getByTestId("plan-brief-table")).toContainText("ждёт проверки");
  await shot(page, "ceo");
  await page.goto(`/weekly/meeting?week=${thisWeek()}`);
  await expect(page.getByTestId("plan-brief")).toBeVisible();
  await expect(page.getByTestId("plan-brief-waiting")).toContainText("КАСКО");
  // На встрече сводка короткая: без таблицы продуктов
  await expect(page.getByTestId("plan-brief-table")).toHaveCount(0);
  await shot(page, "meeting");
});

test("общий логин и человек не из команд продуктов: прогноз виден, выгрузки и проверки нет", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await pull(page);
  await page.context().clearCookies();
  await enterByLink(page, "sakhibullina");
  await page.goto("/forecast");
  await expect(page.getByTestId("plan-stat-revenue")).toBeVisible();
  await expect(page.getByTestId("plan-export")).toHaveCount(0);
  await expect(page.getByTestId("plan-check")).toHaveCount(0);
  const denied = await page.request.get("/forecast/export");
  expect(denied.status()).toBe(403);
  await page.context().clearCookies();
  await enter(page, "Головкин Владислав");
  await page.goto("/me");
  await expect(page.getByRole("link", { name: "Прогноз месяца" })).toHaveCount(0);
});
