import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, resetDatabase } from "./helpers";

// Этап 36: визуальная система разделов, волна 1. Ключевые цифры плитками под заголовком, таблицы вместо сплошного
// текста, пустые экраны с действием. Каждый раздел открывается без горизонтальной прокрутки, цифры ведут на отбор.
// Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-vs-${name}.png`, fullPage: true });
}

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
});

test("задачи: цифры под заголовком ведут на список с фильтром, по людям таблицей, изменения журналом", async ({ page }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/tasks");
  const figures = page.getByRole("list", { name: "Задачи в цифрах" });
  await expect(figures).toBeVisible();
  const overdue = page.getByTestId("tasks-fig-overdue");
  const count = Number((await overdue.locator(".sv-figure__value").textContent())!.trim());
  expect(count).toBeGreaterThan(0);
  await shot(page, "tasks");
  await overdue.getByRole("link").click();
  await expect(page).toHaveURL(/\/tasks\?f=overdue/);
  await expect(page.getByText(`Показано ${count} по фильтрам`)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Просроченные/ })).toHaveAttribute("aria-pressed", "true");

  await page.goto("/tasks/people");
  await expect(page.getByTestId("task-people")).toBeVisible();
  await expect(page.getByTestId("task-people-reva")).toContainText("Рева Тарас");
  await shot(page, "tasks-people");

  await page.goto("/tasks/changes");
  await expect(page.getByRole("list", { name: "Задачи в цифрах" })).toBeVisible();
  await shot(page, "tasks-changes");
});

test("команда и мои команды: цифры и таблицы", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await page.goto("/team");
  await expect(page.getByRole("list", { name: "Команда в цифрах" })).toBeVisible();
  await expect(page.getByTestId("team-fig-weekly")).toContainText(/\d+ из \d+/);
  const table = page.getByTestId("team-summary");
  await expect(table.getByText("Вся команда")).toBeVisible();
  await expect(table.getByRole("link", { name: "Рева Тарас" })).toBeVisible();
  await shot(page, "team");

  await page.goto("/my-teams");
  await expect(page.getByRole("list", { name: /в цифрах/ })).toBeVisible();
  await expect(page.getByTestId("mt-teams-table")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Требует внимания/ })).toBeVisible();
  await shot(page, "my-teams");
});

test("инициативы и решения: цифры, таблица решений, пустой поиск", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await page.goto("/initiatives");
  // Инициатив нет: цифр нет, понятная фраза и кнопка заведения у управления
  await expect(page.getByText("Крупных инициатив пока нет.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Инициативы в цифрах" })).toHaveCount(0);
  await shot(page, "initiatives-empty");

  await page.goto("/decisions");
  await expect(page.getByRole("heading", { name: "Решений пока нет" }).or(page.getByTestId("decisions-table"))).toBeVisible();
  await page.getByPlaceholder("Поиск по словам").fill("несуществующее словосочетание");
  await expect(page.getByText("Ничего не нашлось", { exact: true })).toBeVisible();
  await shot(page, "decisions");
});

test("мне и моя неделя: цифры ведут к разделам страницы", async ({ page }) => {
  // У Головкина всё разобрано и сроков нет: цифр нет, пять нулей не нужны
  await enterByLink(page, "golovkin");
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "Всё разобрано" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Мне в цифрах" })).toHaveCount(0);
  // У Ревы просроченные задачи: цифры видны и ведут к разделам
  await page.context().clearCookies();
  await enterByLink(page, "reva");
  await page.goto("/me");
  await expect(page.getByTestId("me-fig-late")).not.toContainText(/^0/);
  const figures = page.getByRole("list", { name: "Мне в цифрах" });
  await expect(figures).toBeVisible();
  await expect(page.getByTestId("me-fig-events")).toBeVisible();
  await page.getByTestId("me-fig-requests").getByRole("link").click();
  await expect(page).toHaveURL(/#me-requests$/);
  await shot(page, "me");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Мой weekly за неделю/ })).toBeVisible();
  await shot(page, "home");
});
