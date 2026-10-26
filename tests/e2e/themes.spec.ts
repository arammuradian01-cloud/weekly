import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterManagement, resetDatabase } from "./helpers";
import { contrastReport } from "./contrast";

// Этап 49: тёмная тема в проходе; этап 50: тот же проход и для светлой. Ключевые страницы снимаются в обеих темах
// на ноутбуке и телефоне, без горизонтальной прокрутки; у текста на странице есть контраст с фоном (ловит светлый
// текст на светлой плашке или тёмный на тёмной, когда цвет задан не токеном темы)

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

type Theme = "light" | "dark";

async function shot(page: Page, theme: Theme, name: string) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  // Фон страницы под тему: тема правда применилась, а не только атрибут
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const m = /rgb\((\d+), (\d+), (\d+)/.exec(bg)!;
  const sum = Number(m[1]) + Number(m[2]) + Number(m[3]);
  if (theme === "dark") expect(sum, `фон страницы ${name} не тёмный: ${bg}`).toBeLessThan(200);
  else expect(sum, `фон страницы ${name} не светлый: ${bg}`).toBeGreaterThan(600);
  // Порог 4,5:1 по WCAG AA для обычного текста (этап 50: после правки строки просрочки в тёмной теме и полосы сдачи
  // ниже порога ничего не осталось); выключенные элементы не считаются
  const report = await contrastReport(page, 4.5);
  expect(report.unparsed, `цвета, которые проверка не разобрала на экране ${name}`).toEqual([]);
  expect(report.low, `текст без контраста на экране ${name} (${theme}): ${JSON.stringify(report.low)}`).toEqual([]);
  // Курсор в угол: снимок без строки под наведением
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${theme}-${name}.png`, fullPage: true });
}

for (const theme of ["light", "dark"] as Theme[]) {
  test.describe(`тема ${theme === "dark" ? "тёмная" : "светлая"}`, () => {
    test.beforeEach(async ({ page }) => {
      await resetDatabase({ weekly: false });
      // Выбор темы лежит в cookie на устройстве: ставим его до первого захода
      await page.context().addCookies([{ name: "theme", value: theme, url: "http://localhost:3100" }]);
    });

    test("главная с «Ждёт вас», weekly, задачи, карточка задачи, люди, цели", async ({ page }) => {
      test.setTimeout(60_000);
      await enter(page, "Рева Тарас");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // Этап 76: очередь «Мне» на главной блоком «Ждёт вас», отдельного снимка нет
      await expect(page.getByRole("heading", { name: /^Ждёт вас/, level: 2 })).toBeVisible();
      await shot(page, theme, "home");
      await page.goto("/weekly");
      await expect(page.getByRole("heading", { name: "Weekly", level: 1 })).toBeVisible();
      await shot(page, theme, "weekly");
      await page.goto("/tasks");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator(".sv-task-rows section, .sv-table tbody tr").filter({ visible: true }).first()).toBeVisible();
      await shot(page, theme, "tasks");
      await page.goto("/tasks/1");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await shot(page, theme, "task");
      await page.goto("/people");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await shot(page, theme, "people");
      await page.goto("/goals");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await shot(page, theme, "goals");
    });

    test("режим управления: отчёт CEO, встреча, прогноз, настройки, синхронизация", async ({ page }) => {
      test.setTimeout(60_000);
      await enter(page, "Мурадян Арам");
      await enterManagement(page, "owner");
      await page.goto("/ceo-report");
      await expect(page.getByRole("heading", { name: "Отчёт CEO", level: 1 })).toBeVisible();
      await shot(page, theme, "ceo");
      await page.goto("/weekly/meeting");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await shot(page, theme, "meeting");
      await page.goto("/forecast");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await shot(page, theme, "forecast");
      await page.goto("/settings");
      await expect(page.getByRole("heading", { name: "Настройки", level: 1 })).toBeVisible();
      await shot(page, theme, "settings");
      await page.goto("/sync");
      await expect(page.getByRole("heading", { name: "Синхронизация", level: 1 })).toBeVisible();
      await shot(page, theme, "sync");
    });
  });
}
