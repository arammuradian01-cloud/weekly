import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 24: владелец подключает недельный отчёт (имитация) и выбирает цифры, лидер ставит прогноз, цифры и прогноз
// видны в отчёте CEO. На ноутбуке и телефоне

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-fc-${name}.png`, fullPage: true });
}

test.beforeEach(async () => {
  await resetDatabase();
  await sql(`DELETE FROM forecasts`);
  await sql(`DELETE FROM numbers_rows`);
  await sql(`DELETE FROM settings WHERE key LIKE 'numbers.%'`);
});

test("цифры недели из отчёта и прогноз лидера доходят до отчёта CEO", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/sync");
  const form = page.getByRole("form", { name: "Ссылка на недельный отчёт" });
  await form.getByLabel("Ссылка на недельный отчёт").fill("https://docs.google.com/spreadsheets/d/1o1IlcrQD6ZguW2_X1kZOdT-nFM0jKHihh38VfDYbcMg/edit");
  await form.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Отчёт подключён и прочитан").first()).toBeVisible();
  await page.getByLabel("Найти строку отчёта").fill("TRAFFIC");
  const row = page.getByRole("list", { name: "Строки отчёта" }).getByText(/TRAFFIC \/ TOTAL \/ OSAGO/).first();
  await expect(row).toBeVisible();
  await row.click();
  await page.getByLabel("Подпись 1").fill("Трафик ОСАГО");
  await page.getByRole("button", { name: "Сохранить цифры" }).click();
  await expect(page.getByText("Цифры недели: 1").first()).toBeVisible();

  // Страница прогноза за неделю отчёта: цифра с изменением, прогноз сохраняется
  await page.goto("/forecast?week=2026-10-05");
  await expect(page.getByText("Трафик ОСАГО")).toBeVisible();
  await expect(page.getByText("512 000")).toBeVisible();
  const mine = page.getByRole("region", { name: /Мой прогноз/ });
  await mine.getByRole("button", { name: "Добавить линию" }).click();
  await mine.getByLabel("Направление").selectOption("osago");
  await mine.getByLabel("Месяц").selectOption("2026-10");
  await mine.getByLabel(/Бюджет/).fill("468");
  await mine.getByLabel(/Прогноз, млн/).fill("440");
  await mine.getByRole("button", { name: "Сохранить прогноз" }).click();
  await expect(page.getByText(/назовите, что поехало/)).toBeVisible();
  await mine.getByLabel("Что поехало").selectOption("conversion");
  await mine.getByRole("button", { name: "Сохранить прогноз" }).click();
  await expect(page.getByText(/Прогноз за неделю \d+ сохранён/).first()).toBeVisible();
  const summary = page.getByRole("region", { name: "Прогноз до конца месяца" });
  await expect(summary.getByText("440 млн")).toBeVisible();
  await expect(summary.getByText("-6%")).toBeVisible();
  await shot(page, "forecast");

  // Отчёт CEO: цифры и прогноз в тексте
  await page.goto("/ceo-report?week=2026-10-05");
  await expect(page.getByRole("region", { name: "Цифры недели" }).getByText("512 000")).toBeVisible();
  await expect(page.getByRole("region", { name: "Прогноз до конца месяца" }).getByText("440 млн")).toBeVisible();
  await shot(page, "ceo");
  const [{ count }] = await sql(`SELECT count(*)::int AS count FROM forecasts WHERE month = '2026-10' AND forecast = 440`);
  expect(count).toBe(1);
});
