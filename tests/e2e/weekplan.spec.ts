import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 81: неделя к плану. Владелец в режиме управления проверяет и загружает план из таблицы недель (имитация), факт
// Weekly читается сразу. Экраны «Итог», «Продукт» (у ОСАГО страховые, каналы, типы продаж, регионы), «Партнёрка»,
// переключение версии плана и недели. Сотрудник без режима управления видит те же цифры без кнопки загрузки.
// Ноутбук 1440 и телефон 360: страница не прокручивается вбок

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-weekplan81-${name}.png`, fullPage: true });
}

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
  await sql("DELETE FROM week_fact_fixes");
  await sql("DELETE FROM week_facts");
  await sql("DELETE FROM week_plan_values");
  await sql("DELETE FROM week_plan_lines");
  await sql("DELETE FROM settings WHERE key LIKE 'weekplan.%'");
});

test("владелец загружает план, все видят итог, продукт и партнёрку", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/plan-fact");
  await expect(page.getByTestId("weekplan-empty")).toBeVisible();
  await shot(page, "empty");

  await page.getByTestId("weekplan-admin-open").click();
  await page.getByTestId("weekplan-check").click();
  await expect(page.getByTestId("weekplan-preview")).toContainText("План читается: строк справочника 34");
  await expect(page.getByTestId("weekplan-sums")).toContainText("Выручка от продаж всех продуктов");
  await shot(page, "preview");
  await page.getByTestId("weekplan-load").click();
  await expect(page.getByText(/План загружен: строк справочника 34/)).toBeVisible();

  // Итог: последняя закрытая неделя с фактом, плитки, график, таблица продуктов
  await page.goto("/plan-fact");
  await expect(page.getByTestId("weekplan-week")).toContainText("Неделя");
  await expect(page.getByTestId("weekplan-tile-all")).toBeVisible();
  await expect(page.getByTestId("weekplan-tile-os-s")).not.toContainText("нет факта");
  await expect(page.getByTestId("weekplan-product-row")).toHaveCount(3);
  await expect(page.getByTestId("weekplan-status")).toContainText("Weekly Sravni");
  await shot(page, "total");

  // Версия плана: LRF
  await page.getByTestId("weekplan-base-lrf").click();
  await expect(page).toHaveURL(/base=lrf/);
  await expect(page.getByTestId("weekplan-tile-os-s")).toContainText("LRF");

  // Продукт ОСАГО: страховые, каналы, типы, регионы
  await page.getByTestId("weekplan-tab-product").click();
  await expect(page.getByTestId("weekplan-sk")).toBeVisible();
  await expect(page.getByTestId("weekplan-sk-row")).toHaveCount(3);
  await expect(page.getByTestId("weekplan-channels")).toBeVisible();
  await expect(page.getByTestId("weekplan-types")).toBeVisible();
  await expect(page.getByTestId("weekplan-regions")).toBeVisible();
  await expect(page.getByTestId("weekplan-month-only")).toBeVisible();
  await shot(page, "product-osago");

  // Партнёрка: ипотечное сходится с каналом партнёров
  await page.getByTestId("weekplan-tab-partners").click();
  await page.getByTestId("weekplan-group-MI").click();
  await expect(page.getByText("Сумма плана партнёров равна каналу партнёров продукта")).toBeVisible();
  await expect(page.getByTestId("weekplan-partners-total")).toBeVisible();
  await shot(page, "partners");

  // Неделя назад и неполная неделя 28.09: процента нет, предупреждение
  await page.goto("/plan-fact?week=2026-09-28");
  await expect(page.getByTestId("weekplan-partial")).toBeVisible();
  await expect(page.getByTestId("weekplan-prev")).toHaveCount(0);
  await page.getByTestId("weekplan-next").click();
  await expect(page).toHaveURL(/week=2026-10-05/);
});

test("сотрудник видит цифры без загрузки", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/plan-fact");
  await page.getByTestId("weekplan-admin-open").click();
  await page.getByTestId("weekplan-check").click();
  await page.getByTestId("weekplan-load").click();
  await expect(page.getByText(/План загружен/)).toBeVisible();

  await page.context().clearCookies();
  await enter(page, "Головкин");
  await page.goto("/plan-fact");
  await expect(page.getByTestId("weekplan-tile-all")).toBeVisible();
  await expect(page.getByTestId("weekplan-admin-open")).toHaveCount(0);
  await page.getByRole("link", { name: "Неделя к плану" }).first().isVisible();
  await page.goto("/plan-fact?tab=product&p=OS");
  await expect(page.getByTestId("weekplan-sk")).toContainText("АльфаСтрахование");
  await shot(page, "employee-product");
});
