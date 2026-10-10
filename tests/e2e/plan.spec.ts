import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 32: прогноз месяца по драйверам. Владелец в режиме управления загружает бюджет и LBE из LRF (имитация), лидер
// ОСАГО по личному входу корректирует конверсию сайта с причиной и обоснованием и до сохранения видит, как поменяется
// выручка; под общим логином прогноз только виден. Неделя осталась второй вкладкой. Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-plan-${name}.png`, fullPage: true });
}

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
  // Этап 35: снимки загрузок, отметки проверки и факт по дням
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

test("бюджет и LBE из LRF, корректировка драйвера с обоснованием и пересчёт прогноза", async ({ page }) => {
  // Владелец: месяц ещё не загружен, загрузка в два шага
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/forecast");
  await expect(page.getByRole("link", { name: "Прогноз месяца" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/ещё не начат/)).toBeVisible();
  await shot(page, "empty");
  await page.getByTestId("plan-pull-open").click();
  const drawer = page.getByRole("dialog", { name: "Бюджет и LBE из LRF" });
  await expect(drawer.getByTestId("plan-pull-load")).toBeDisabled();
  await drawer.getByTestId("plan-pull-check").click();
  const preview = drawer.getByTestId("plan-pull-preview");
  await expect(preview.getByText("Всё читается")).toBeVisible();
  await expect(preview.getByRole("row", { name: /ОСАГО/ })).toContainText("450,0");
  await shot(page, "pull");
  await drawer.getByTestId("plan-pull-load").click();
  await expect(page.getByText(/Бюджет и LBE на .* загружены/).first()).toBeVisible();
  await expect(page.getByTestId("plan-source")).toContainText("Бюджет и LBE из LRF загружены");
  await expect(page.getByTestId("plan-stat-revenue")).toBeVisible();
  const [{ count }] = await sql(`SELECT count(*)::int AS count FROM plan_lines`);
  expect(count).toBeGreaterThan(100);

  // Под общим логином без режима управления прогноз виден, корректировать нельзя
  await page.context().clearCookies();
  await enter(page, "Головкин Владислав");
  await page.goto("/forecast");
  await expect(page.getByText(/общим логином/).first()).toBeVisible();
  await expect(page.getByTestId("plan-edit-crWeb")).toHaveCount(0);

  // Лидер ОСАГО по личному входу: конверсия сайта 10% станет 12%, выручка ОСАГО вырастет
  await page.context().clearCookies();
  await enterByLink(page, "golovkin");
  await page.goto("/forecast");
  const card = page.locator("#plan-product-osago");
  await expect(card.getByRole("heading", { name: "ОСАГО" })).toBeVisible();
  await expect(card.getByTestId("plan-row-revenue")).toContainText("450,0");
  await card.getByTestId("plan-edit-crWeb").click();
  const editor = card.getByTestId("plan-editor");
  // Пустое поле не снимает корректировку молча
  await editor.getByLabel(/Новое значение/).fill("");
  await editor.getByTestId("plan-save").click();
  await expect(editor.getByText("Укажите новое значение")).toBeVisible();
  await editor.getByLabel(/Новое значение/).fill("12");
  const impact = editor.getByTestId("plan-impact");
  await expect(impact).toContainText("станет 405 000");
  await expect(impact).toContainText("станет 483,6");
  await editor.getByTestId("plan-save").click();
  await expect(editor.getByText(/почему меняется прогноз/)).toBeVisible();
  await editor.getByLabel("Почему меняется прогноз").fill("Новая форма оплаты: конверсия первой недели 12%");
  await shot(page, "editor");
  await editor.getByTestId("plan-save").click();
  await expect(page.getByText("Конверсия сайта: корректировка сохранена").first()).toBeVisible();
  await expect(card.getByTestId("plan-row-crWeb")).toContainText("12,0%");
  await expect(card.getByTestId("plan-note-crWeb")).toContainText("Головкин В.");
  await expect(card.getByTestId("plan-note-crWeb")).toContainText("Новая форма оплаты");
  await expect(card.getByTestId("plan-row-revenue")).toContainText("483,6");
  await expect(page.getByTestId("plan-top-osago")).toContainText("483,6");
  await expect(page.getByTestId("plan-history")).toContainText("было 10,0%");
  await expect(page.getByTestId("plan-history")).toContainText("стало 12,0%");
  await shot(page, "adjusted");
  const rows = await sql(`SELECT value, previous, reason::text AS reason FROM plan_adjustments`);
  expect(rows).toEqual([{ value: 0.12, previous: 0.1, reason: "CONVERSION" }]);

  // Продукт другой команды: только просмотр
  await page.getByRole("radiogroup", { name: "Продукт" }).getByRole("radio", { name: "Вклады" }).click();
  await expect(page.locator("#plan-product-deposits").getByText(/корректирует его команда/)).toBeVisible();
  await expect(page.locator("#plan-product-deposits").getByRole("button", { name: /Изменить/ })).toHaveCount(0);

  // Вкладка недели на месте
  await page.getByTestId("tab-week").click();
  await expect(page).toHaveURL(/tab=week/);
  await expect(page.getByRole("heading", { name: "История прогноза по неделям" })).toBeVisible();
});
