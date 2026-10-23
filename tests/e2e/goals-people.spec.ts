import { expect, test } from "@playwright/test";
import { enter, resetDatabase, sql } from "./helpers";

test("[Codex] цели разделены по людям, мои и несколько сотрудников сочетаются с поиском", async ({ page }) => {
  await resetDatabase({ weekly: false });
  await sql(`INSERT INTO goals (id, quarter, code, title, "teamId", "ownerId", "updatedAt")
    SELECT 'codex-goal-' || v.code, '2026-Q4', v.code, v.title, 'top', p.id, now()
    FROM (VALUES ('M1', 'Маржа моей команды', 'muradyan'), ('M2', 'Конверсия моей команды', 'muradyan'),
      ('G1', 'Маржа партнёров', 'golovkin'), ('N1', 'Общая цель без владельца', NULL)) v(code, title, slug)
    LEFT JOIN people p ON p.slug = v.slug`);
  await enter(page, "Мурадян Арам");
  await page.goto("/goals?q=2026-Q4");
  const cards = page.getByTestId("goals-cards");
  const mine = cards.getByRole("region", { name: /Мурадян Арам/ });
  const other = cards.getByRole("region", { name: /Головкин Владислав/ });
  await expect(mine.getByTestId("goal-card-codex-goal-M1")).toBeVisible();
  await expect(mine.getByTestId("goal-card-codex-goal-M2")).toBeVisible();
  await expect(mine.getByTestId("goal-card-codex-goal-G1")).toHaveCount(0);
  await expect(other.getByTestId("goal-card-codex-goal-G1")).toBeVisible();
  await expect(cards.getByRole("region", { name: /Без владельца/ })).toBeVisible();

  await page.getByRole("button", { name: "Мои цели", exact: true }).click();
  await expect(cards.locator("li[id^=goal-]")).toHaveCount(2);
  await expect(other).toHaveCount(0);
  await page.getByLabel("Поиск цели").fill("маржа");
  await expect(cards.locator("li[id^=goal-]")).toHaveCount(1);

  await page.getByRole("button", { name: /Выбрать сотрудников/ }).click();
  await page.getByRole("menuitemcheckbox", { name: "Головкин Владислав", exact: true }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Мурадян Арам", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Поиск цели")).toHaveValue("маржа");
  await expect(cards.locator("li[id^=goal-]")).toHaveCount(2);
  await expect(other).toBeVisible();
  await page.screenshot({ path: `tests/e2e/screenshots/${test.info().project.name}-codex-goals-people.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("radiogroup", { name: "Вид", exact: true }).getByRole("radio", { name: "Таблица", exact: true }).click();
  await expect(page.getByTestId("goal-row-M1")).toBeVisible();
  await expect(page.getByTestId("goal-row-G1")).toBeVisible();
  await expect(page.getByTestId("goal-row-M2")).toHaveCount(0);
  await page.getByRole("button", { name: /Выбрать сотрудников/ }).click();
  await page.getByRole("menuitemcheckbox", { name: "Мурадян Арам", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("goal-row-M1")).toHaveCount(0);
  await expect(page.getByTestId("goal-row-G1")).toBeVisible();
  await page.getByRole("button", { name: "Все сотрудники", exact: true }).click();
  await page.getByLabel("Поиск цели").fill("");
  await expect(page.getByTestId("goal-row-N1")).toBeVisible();
  await page.getByRole("radiogroup", { name: "Группы" }).getByRole("radio", { name: "По командам" }).click();
  await expect(page.getByTestId("goal-row-M1")).toBeVisible();
});
