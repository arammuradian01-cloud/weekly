import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 35б: партнёрский канал в прогнозе месяца. Владелец загружает LBE вместе с листами LRF b2b, руководитель канала
// по личному входу меняет полисы партнёра с обоснованием, лидер ОСАГО учитывает изменение в полисах B2B продукта.
// Поиск и отборы партнёров, канал в сводке отчёта CEO. Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-plan35b-${name}.png`, fullPage: true });
}

const moscowToday = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
const thisWeek = () => {
  const d = new Date(`${moscowToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const weekMonth = () => {
  const d = new Date(`${thisWeek()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3);
  return d.toISOString().slice(0, 7);
};

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
  for (const table of ["plan_partner_adjustments", "plan_partner_totals", "plan_partners", "plan_facts", "plan_checks", "plan_pulls", "plan_adjustments", "plan_lines"]) await sql(`DELETE FROM ${table}`);
  await sql(`DELETE FROM settings WHERE key LIKE 'plan.%'`);
});

async function pull(page: Page, month?: string) {
  await page.goto("/forecast");
  await page.getByTestId("plan-pull-open").click();
  const drawer = page.getByRole("dialog", { name: "Бюджет и LBE из LRF" });
  if (month) await drawer.getByLabel("Месяц").selectOption(month);
  await drawer.getByTestId("plan-pull-check").click();
  await expect(drawer.getByTestId("plan-pull-preview").getByText("Всё читается")).toBeVisible();
  await expect(drawer.getByTestId("plan-pull-partners")).toContainText("Партнёрский канал загрузится. Партнёров: 12");
  await drawer.getByTestId("plan-pull-load").click();
  await expect(page.getByText(/Бюджет и LBE на .* загружены/).first()).toBeVisible();
}

const partnerRow = (page: Page, name: string, product = "ОСАГО") => page.getByTestId("partners-table").locator("tbody > tr").filter({ has: page.getByRole("rowheader", { name: new RegExp(`^${name}\\s*(, скорректировано)?\\s*${product}`) }) });

test("руководитель канала меняет полисы партнёра, лидер ОСАГО учитывает изменение в полисах B2B", async ({ page }) => {
  test.setTimeout(120_000);
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await pull(page);
  const section = page.locator("#plan-partners");
  await expect(section.getByRole("heading", { name: "Партнёрский канал", level: 2 })).toBeVisible();
  await expect(section.getByTestId("partners-stat-revenue")).toContainText("млн");
  await expect(section.getByTestId("partners-totals")).toContainText("CPA и отказной");
  await expect(section.getByTestId("partners-review")).toContainText("ждёт проверки");

  // Руководитель канала по личному входу: событие и корректировка полисов партнёра
  await page.context().clearCookies();
  await enterByLink(page, "sakhibullina");
  await page.goto("/me");
  await expect(page.getByText(/Проверьте прогноз: Партнёрский канал/)).toBeVisible();
  await page.goto("/forecast");
  const row = partnerRow(page, "Банк Север");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("20 000");
  await row.getByRole("button", { name: "Драйверы" }).click();
  const card = page.getByTestId("partner-card");
  await expect(card.getByTestId("partner-row-commission")).toContainText("80,0%");
  await card.getByTestId("partner-edit-policies").click();
  const editor = page.getByTestId("partner-editor");
  await editor.getByLabel(/Новое значение/).fill("22 000");
  await expect(editor.getByTestId("partner-impact")).toContainText("станет 23,76");
  await editor.getByLabel("Почему меняется прогноз").fill("Партнёр подтвердил объём на месяц");
  await shot(page, "editor");
  await editor.getByTestId("partner-save").click();
  await expect(page.getByText("Банк Север, полисы через Сравни: корректировка сохранена").first()).toBeVisible();
  await expect(partnerRow(page, "Банк Север")).toContainText("22 000");
  await expect(page.getByTestId("partners-review")).toContainText("скорректирован: Сахибуллина А.");
  await expect(page.getByTestId("partners-history")).toContainText("Банк Север, ОСАГО: полисы через Сравни");
  await shot(page, "channel");

  // Лидер ОСАГО видит, что полисы партнёров выросли на 2 000, и учитывает это в полисах B2B продукта
  await page.context().clearCookies();
  await enterByLink(page, "golovkin");
  await page.goto("/forecast");
  const band = page.locator("#plan-product-osago").getByTestId("plan-partner-band");
  await expect(band).toContainText("полисы партнёров по прогнозу больше LBE на 2 000");
  await band.getByTestId("plan-partner-apply").click();
  const productEditor = page.getByTestId("plan-editor");
  await expect(productEditor.getByLabel(/Новое значение/)).toHaveValue("152000");
  await expect(productEditor.getByLabel("Почему меняется прогноз")).toHaveValue("По прогнозу партнёрского канала: +2 000 полисов к LBE");
  await productEditor.getByTestId("plan-save").click();
  await expect(band).toContainText("Изменение партнёров учтено");
  await expect(band).toContainText("Полисы B2B продукта: LBE 150 000, прогноз 152 000");
  await expect(band.getByTestId("plan-partner-apply")).toHaveCount(0);
  // Партнёров Головкин видит, но не корректирует: он не в команде канала
  await partnerRow(page, "Банк Север").getByRole("button", { name: "Подробно" }).click();
  await expect(page.getByTestId("partner-card").getByTestId("partner-edit-policies")).toHaveCount(0);
  await shot(page, "product-band");
});

test("отборы и поиск партнёров, партнёры без продаж свёрнуты, «Прогноз проверен» у канала", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await pull(page);
  await page.context().clearCookies();
  await enterByLink(page, "afanasyev");
  await page.goto("/forecast");
  const table = page.getByTestId("partners-table");
  // Банк Юг ещё не продаёт: по умолчанию свёрнут, кнопка показывает таких партнёров
  await expect(table.getByText("Банк Юг")).toHaveCount(0);
  await page.getByTestId("partners-idle").click();
  await expect(table.getByText("Банк Юг")).toBeVisible();
  await page.locator("#partners-channel").selectOption("agents");
  await expect(table.locator("tbody > tr")).toHaveCount(4);
  await page.locator("#partners-product").selectOption("red-mortgage");
  await expect(table.locator("tbody > tr")).toHaveCount(1);
  await page.locator("#partners-channel").selectOption("all");
  await page.locator("#partners-product").selectOption("all");
  await page.getByLabel("Поиск партнёра").fill("сеть путеш");
  await expect(table.locator("tbody > tr")).toHaveCount(1);
  await expect(table).toContainText("CPA-сеть Путешествия");
  await page.getByLabel("Поиск партнёра").fill("нет такого");
  await expect(page.getByTestId("partners-empty")).toHaveText("Партнёров с таким названием нет.");
  await page.getByTestId("partners-check").click();
  await expect(page.getByText("Партнёрский канал: прогноз отмечен проверенным").first()).toBeVisible();
  await expect(page.getByTestId("partners-review")).toContainText("проверен без корректировок: Афанасьев П.");
  await shot(page, "filters");
});

test("канал в сводке отчёта CEO: строкой под итогом по продуктам", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await pull(page, weekMonth());
  await page.goto(`/ceo-report?week=${thisWeek()}`);
  await expect(page.getByTestId("plan-brief-partners")).toContainText("Партнёрский канал, внутри продуктов:");
  await expect(page.getByTestId("plan-brief-partners")).toContainText("млн");
  await shot(page, "ceo");
});
