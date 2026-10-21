import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 58: единая воронка, шаг 1. Владелец загружает снимок «Все СК» и план ОСАГО по СК из хаба в имитации, в карточке
// ОСАГО появляется таблица по СК с ранрейтом (с 4-го числа); лидер КАСКО видит полисы, но не выручку и КВ. Время загрузки
// факта и плана видно отдельно, поле соответствия названий СК у владельца. Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-plan58-${name}.png`, fullPage: true });
}

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
  for (const table of ["plan_sk_snapshots", "plan_sk_lines", "plan_partner_adjustments", "plan_partner_totals", "plan_partners", "plan_facts", "plan_checks", "plan_pulls", "plan_adjustments", "plan_lines"]) await sql(`DELETE FROM ${table}`);
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

test("владелец загружает хаб, в карточке ОСАГО появляется ранрейт по СК, лидер КАСКО не видит выручку и КВ", async ({ page }) => {
  test.setTimeout(120_000);
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await pull(page);

  // До загрузки хаба раздела по СК нет
  await page.goto("/forecast");
  await expect(page.getByTestId("plan-sk")).toHaveCount(0);
  await page.getByTestId("plan-hub-open").click();
  const drawer = page.getByRole("dialog", { name: "ОСАГО по СК из хаба" });
  await expect(drawer.getByTestId("plan-hub-link")).toBeVisible();
  await expect(drawer.getByTestId("plan-hub-loaded")).toContainText("Факт «Все СК» ещё не загружен. План по СК ещё не загружен.");
  // Соответствие названий СК правит владелец в той же панели
  await expect(drawer.getByTestId("plan-hub-aliases")).toBeVisible();
  await expect(drawer.getByTestId("plan-hub-aliases-save")).toBeDisabled();
  await drawer.getByTestId("plan-hub-check").click();
  const preview = drawer.getByTestId("plan-hub-preview");
  await expect(preview.getByText("Всё читается")).toBeVisible();
  await expect(preview.getByTestId("plan-hub-fact")).toContainText("СК: 4");
  await expect(preview.getByTestId("plan-hub-fact")).toContainText("загрузится");
  await expect(preview.getByTestId("plan-hub-plan")).toContainText("План ОСАГО по СК");
  await shot(page, "hub-drawer");
  await drawer.getByTestId("plan-hub-load").click();
  await expect(page.getByText(/Снимок «Все СК» на .* загружен/).first()).toBeVisible();

  // Карточка ОСАГО: таблица по СК, итог, сверка с LBE, метод
  const sk = page.getByTestId("plan-sk");
  await expect(sk).toBeVisible();
  await expect(sk.getByRole("heading", { name: "ОСАГО по СК: план, факт и ранрейт" })).toBeVisible();
  await expect(sk.getByTestId("plan-sk-row")).toHaveCount(4);
  await expect(sk.getByTestId("plan-sk-total")).toContainText("ИТОГО");
  // Факт в «Все СК» по вчерашний день: 1-го числа факта за месяц ещё нет, ранрейт не считается; 2-го и 3-го факта меньше
  // трёх дней, ранрейт и «К плану» появятся с 4-го числа
  const today = Number(new Date().toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric" }));
  if (today === 1) await expect(sk.getByTestId("plan-sk-tomorrow")).toContainText("появится завтра");
  else if (today <= 3) {
    await expect(sk.getByTestId("plan-sk-early")).toContainText("появятся с 4-го числа");
    await expect(sk.getByTestId("plan-sk-forecast")).toHaveCount(0);
  } else {
    await expect(sk.getByTestId("plan-sk-method")).toContainText("Прогноз линейный по дням");
    await expect(sk.getByTestId("plan-sk-method")).toContainText("14 дней с дневным фактом");
    await expect(sk.getByTestId("plan-sk-forecast")).toHaveCount(5);
  }
  await expect(sk.getByTestId("plan-sk-loaded")).toContainText("Факт загружен");
  await expect(sk.getByTestId("plan-sk-loaded")).toContainText("План загружен");
  await expect(sk.getByTestId("plan-sk-lbe")).toContainText(today <= 3 ? "LBE полисов ОСАГО на месяц" : "против LBE полисов ОСАГО");
  await expect(sk.getByTestId("plan-sk-stale")).toHaveCount(0);
  // Владелец видит выручку и КВ: на телефоне шапки нет, поэтому проверяем ячейки
  await expect(sk.getByTestId("plan-sk-revenue")).toHaveCount(5);
  await expect(sk.getByTestId("plan-sk-kv").first()).toContainText("%");
  await shot(page, "osago-sk-owner");

  // Лидер КАСКО по личному входу: таблица есть, чувствительных колонок нет
  await page.context().clearCookies();
  await enterByLink(page, "fatyanov");
  await page.goto("/forecast");
  await expect(page.getByTestId("plan-hub-open")).toHaveCount(0);
  const osagoRow = page.getByTestId("plan-products-table").locator("tbody > tr").filter({ hasText: "ОСАГО" }).first();
  if (await osagoRow.count()) await osagoRow.click();
  const skKasko = page.getByTestId("plan-sk");
  await expect(skKasko).toBeVisible();
  await expect(skKasko.getByTestId("plan-sk-row")).toHaveCount(4);
  await expect(skKasko.getByTestId("plan-sk-revenue")).toHaveCount(0);
  await expect(skKasko.getByTestId("plan-sk-kv")).toHaveCount(0);
  await expect(skKasko.getByTestId("plan-sk-total")).toContainText("ИТОГО");
  await shot(page, "osago-sk-kasko");
});
