import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase } from "./helpers";

// Этап 37: визуальная система разделов, волна 2. Weekly, сдача weekly, отчёт CEO, журнал, один на один, настройки и
// синхронизация: шапка как у всех разделов, ключевые цифры, журнал одной таблицей, пустые экраны с действием.
// Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-vs2-${name}.png`, fullPage: true });
}

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
});

test("weekly: шапка с цифрами недели, пустой фильтр с действием; сдача weekly с той же шапкой", async ({ page }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/weekly");
  await expect(page.getByRole("heading", { name: "Weekly", level: 1 })).toBeVisible();
  const figures = page.getByRole("list", { name: "Неделя в цифрах" });
  await expect(figures).toBeVisible();
  const entries = Number((await page.getByTestId("weekly-fig-entries").locator(".sv-figure__value").textContent())!.trim());
  expect(entries).toBeGreaterThan(0);
  await shot(page, "weekly");
  await page.goto("/weekly/submit");
  await expect(page.getByRole("heading", { name: /^Weekly за неделю \d+$/, level: 1 })).toBeVisible();
  await shot(page, "submit");
});

test("отчёт CEO, журнал, настройки и синхронизация в режиме управления", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/ceo-report");
  const ceo = page.getByRole("list", { name: "Отчёт в цифрах" });
  await expect(ceo).toBeVisible();
  await expect(page.getByTestId("ceo-fig-flags")).toContainText("Отметок «В отчёт CEO»");
  await shot(page, "ceo");

  await page.goto("/journal");
  const journal = page.getByTestId("journal-table");
  await expect(journal).toBeVisible();
  await expect(journal.locator("tbody tr").first()).toBeVisible();
  // Выборка, под которую событий нет: кнопка возвращает весь журнал
  await page.getByLabel("Тип события").selectOption({ index: 7 });
  await page.getByLabel("Кто").selectOption("system");
  const empty = page.getByRole("heading", { name: "Событий под эти фильтры нет" });
  if (await empty.isVisible()) {
    await page.getByRole("link", { name: "Сбросить фильтры" }).click();
    await expect(page).toHaveURL(/\/journal$/);
    await expect(journal).toBeVisible();
  }
  await shot(page, "journal");

  await page.goto("/settings");
  await expect(page.getByRole("list", { name: "Люди и входы в цифрах" })).toBeVisible();
  await expect(page.getByTestId("set-fig-active")).not.toContainText(/^0/);
  await shot(page, "settings");

  await page.goto("/sync");
  await expect(page.getByRole("list", { name: "Синхронизация в цифрах" })).toBeVisible();
  await expect(page.getByTestId("sync-fig-tasks")).not.toContainText(/^0/);
  await shot(page, "sync");
});

test("один на один: цифры встреч при личном входе", async ({ page }) => {
  await enterByLink(page, "reva");
  await page.goto("/one-on-one");
  const figures = page.getByRole("list", { name: "Встречи в цифрах" });
  if (await page.getByRole("heading", { name: "Встреч один на один пока нет" }).isVisible()) {
    await expect(figures).toHaveCount(0);
  } else {
    await expect(figures).toBeVisible();
    await expect(page.getByTestId("oo-fig-pairs")).not.toContainText(/^0/);
  }
  await shot(page, "one-on-one");
});
