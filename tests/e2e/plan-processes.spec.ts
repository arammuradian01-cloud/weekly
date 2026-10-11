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
  await sql(`DELETE FROM plan_partner_adjustments`);
  await sql(`DELETE FROM plan_partner_totals`);
  await sql(`DELETE FROM plan_partners`);
  await sql(`DELETE FROM plan_adjustments`);
  await sql(`DELETE FROM plan_lines`);
  await sql(`DELETE FROM settings WHERE key LIKE 'plan.%'`);
});

/** Месяц недели, как у отчёта CEO и встречи: месяц её четверга */
const weekMonth = () => {
  const d = new Date(`${thisWeek()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3);
  return d.toISOString().slice(0, 7);
};

async function pull(page: Page, month?: string) {
  await page.goto("/forecast");
  await page.getByTestId("plan-pull-open").click();
  const drawer = page.getByRole("dialog", { name: "Бюджет и LBE из LRF" });
  if (month) await drawer.getByLabel("Месяц").selectOption(month);
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
  // Этап 46: карточка продукта раскрывается под строкой таблицы; у владельца ОСАГО уже раскрыт
  const osago = page.getByTestId("plan-top-osago").getByRole("button", { name: "ОСАГО" });
  if ((await osago.getAttribute("aria-expanded")) !== "true") await osago.click();
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
  // У недели на стыке месяцев месяц четверга может отличаться от сегодняшнего
  await pull(page, weekMonth());
  // Прошлый месяц закрыт: проверять его уже не просят
  const open = weekMonth() >= moscowToday().slice(0, 7);
  await page.goto(`/ceo-report?week=${thisWeek()}`);
  // Этап 47: блок прогноза в отчёте свёрнут
  await page.getByTestId("ceo-plan-block").locator("summary").click();
  const brief = page.getByTestId("plan-brief").first();
  await expect(brief).toBeVisible();
  await expect(page.getByTestId("plan-brief-revenue")).toContainText("млн");
  if (open) {
    await expect(page.getByTestId("plan-brief-waiting")).toContainText("Ждут проверки после загрузки LBE: ОСАГО, КАСКО");
    await expect(page.getByTestId("plan-brief-waiting")).toContainText("Проверяют: Головкин Владислав, Рева Тарас, Фатьянов Евгений");
    await expect(page.getByTestId("plan-brief-table")).toContainText("ждёт проверки");
  }
  await shot(page, "ceo");
  await page.goto(`/weekly/meeting?week=${thisWeek()}`);
  await expect(page.getByTestId("plan-brief")).toBeVisible();
  if (open) await expect(page.getByTestId("plan-brief-waiting")).toContainText("КАСКО");
  // На встрече сводка короткая: без таблицы продуктов
  await expect(page.getByTestId("plan-brief-table")).toHaveCount(0);
  await shot(page, "meeting");
});

test("отчёт CEO за прошлую неделю: прогноз на её конец и сравнение с прогнозом сейчас вместе с партнёрским каналом", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  // Неделя до отчётной: её ключ из переключателя недель отчёта
  await page.goto("/ceo-report");
  await page.getByRole("button", { name: "Предыдущая неделя" }).click();
  await expect(page).toHaveURL(/week=\d{4}-\d{2}-\d{2}/);
  const week = new URL(page.url()).searchParams.get("week")!;
  const thursday = new Date(`${week}T00:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const month = thursday.toISOString().slice(0, 7);
  const sunday = new Date(`${week}T00:00:00Z`);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const sundayKey = sunday.toISOString().slice(0, 10);
  await pull(page, month);

  // Загрузка сегодня, а неделя закончилась раньше: снимка на её конец нет, это видно
  await page.goto(`/ceo-report?week=${week}`);
  await page.getByTestId("ceo-plan-block").locator("summary").click();
  const brief = page.locator("#plan-brief");
  await expect(brief.getByRole("heading", { name: new RegExp(`на конец недели \\d+, ${ru(sundayKey).slice(0, 5).replace(".", "\\.")}$`) })).toBeVisible();
  await expect(brief).toContainText("Снимка загрузки LBE на конец недели");
  // Проверки на прошлый момент нет
  await expect(page.getByTestId("plan-brief-waiting")).toHaveCount(0);

  // Загрузка была до конца той недели: прогноз из её снимка, без пометки
  await sql(`UPDATE plan_pulls SET at = $1`, [new Date(`${week}T09:00:00Z`)]);
  await sql(`UPDATE plan_partners SET "pulledAt" = $1`, [new Date(`${week}T09:00:00Z`)]);
  await page.reload();
  await expect(brief).not.toContainText("Снимка загрузки LBE");
  await expect(page.getByTestId("plan-brief-revenue")).toContainText("млн");
  await shot(page, "ceo-past-week");

  // Сравнение с прогнозом сейчас: версия на конец воскресенья, ниже партнёрский канал отдельной таблицей
  await brief.getByRole("link", { name: "Сравнить с прогнозом сейчас" }).click();
  const compare = page.getByTestId("plan-compare");
  await expect(compare.getByLabel("Версия А")).toHaveValue(`day:${sundayKey}`);
  await expect(compare.getByLabel("Версия Б")).toHaveValue("forecast");
  const partners = page.getByTestId("plan-compare-partners");
  await expect(partners).toBeVisible();
  await expect(page.getByTestId("plan-compare-partner-osago:cpa")).toContainText("CPA и отказной");
  await expect(page.getByTestId("plan-compare-partner-total")).toContainText("Итого по каналу");
  await page.getByRole("radiogroup", { name: "Показатель канала" }).getByRole("radio", { name: "Полисы" }).click();
  await expect(page.getByTestId("plan-compare-partner-total")).not.toContainText("нет");
  await shot(page, "compare-partners");
});

test("общий логин и человек не из команд продуктов: прогноз виден, выгрузки и проверки нет", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await pull(page);
  await page.context().clearCookies();
  // Этап 35б: Сахибуллина по умолчанию в команде партнёрского канала; без команды канала она вне команд продуктов
  await sql(`INSERT INTO settings (key, value, "updatedAt") VALUES ('plan.owners', '{"b2b": []}'::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = '{"b2b": []}'::jsonb`);
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
