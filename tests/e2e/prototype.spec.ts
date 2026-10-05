import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { mkdirSync } from "node:fs";
import { E2E_PASSWORDS } from "./global-setup";

// Прототип этапа 2: экраны на выдуманных данных, правки живут в памяти браузера

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

test.beforeEach(async () => {
  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  await client.query("DELETE FROM login_attempts");
  await client.end();
});

async function enter(page: Page, fullName: string) {
  await page.goto("/login");
  await page.getByLabel("Логин").fill("team");
  await page.getByLabel("Пароль").fill(E2E_PASSWORDS.team);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/choose$/);
  await page.getByRole("button", { name: new RegExp(fullName) }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function noOverflow(page: Page, name: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-p-${name}.png`, fullPage: true });
}

test("все экраны прототипа открываются без горизонтальной прокрутки", async ({ page }) => {
  await enter(page, "Головкин Владислав");
  const pages: [string, RegExp][] = [
    ["/", /Мой weekly за неделю/],
    ["/weekly", /Сдали \d из 8/],
    ["/weekly/submit", /Обновить задачи/],
    ["/weekly/meeting", /Риски и запросы помощи/],
    ["/tasks", /Задача и где сейчас|Показано/],
    ["/tasks/board", /Перетащите карточку/],
    ["/tasks/mine", /Просроченные|Срок на этой неделе/],
    ["/tasks/review", /Задача со встречи|Критичные/],
    ["/tasks/13", /Запустить калькулятор КАСКО по VIN/],
    ["/team", /Вся команда|В работе/],
    ["/ui", /Образец компонентов/],
  ];
  for (const [path, marker] of pages) {
    await page.goto(path);
    await expect(page.getByText(marker).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText("Прототип.").first()).toBeVisible();
    await noOverflow(page, path.replace(/\W+/g, "_") || "home");
  }
});

test("быстрые фильтры, поиск и карточка задачи по ссылке", async ({ page }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/tasks");
  await page.getByRole("button", { name: /^Просроченные/ }).click();
  await expect(page.getByText("Показано 7 по фильтрам")).toBeVisible();
  await page.getByRole("button", { name: /^Просроченные/ }).click();

  await page.getByLabel("Поиск по тексту и номеру").fill("13");
  await expect(page.getByText("Показано 1 по фильтрам")).toBeVisible();
  await page.getByRole("button", { name: "Запустить калькулятор КАСКО по VIN" }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/task=13/);
  const card = page.getByRole("dialog");
  await expect(card.getByText("Исходный срок")).toBeVisible();
  await expect(card.getByText("История переносов")).toBeVisible();
  // Чужую задачу лидер не меняет: статус показан меткой без выбора
  await expect(card.getByRole("button", { name: /^Статус:/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/task=/);
});

test("закрыть свою задачу можно только с итогом, последнее действие отменяется", async ({ page }) => {
  await enter(page, "Фатьянов Евгений");
  await page.goto("/tasks/28");
  await page.getByRole("button", { name: /^Статус: Требует уточнений/ }).click();
  await page.getByRole("menuitem", { name: "Выполнена", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Нужен короткий итог");
  await dialog.getByLabel("Итог или ссылка на результат").fill("Условия пилота согласованы");
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("button", { name: /^Статус: Выполнена/ })).toBeVisible();
  await expect(page.getByText("Условия пилота согласованы").first()).toBeVisible();

  await page.getByRole("status").getByRole("button", { name: "Отменить" }).click();
  await expect(page.getByRole("button", { name: /^Статус: Требует уточнений/ })).toBeVisible();
});

test("перенос срока без причины невозможен", async ({ page }) => {
  await enter(page, "Фатьянов Евгений");
  await page.goto("/tasks/13");
  await page.getByRole("button", { name: "Перенести срок" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Новый срок").fill("2030-01-15");
  await dialog.getByRole("button", { name: "Перенести" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Без причины перенести нельзя");
  await dialog.getByLabel("Причина переноса").fill("Ждём второго поставщика VIN-базы");
  await dialog.getByRole("button", { name: "Перенести" }).click();
  await expect(page.getByText(/переносов 3/)).toBeVisible();
});

test("лидер сдаёт weekly в три шага", async ({ page }) => {
  await enter(page, "Афанасьев Павел");
  await page.getByRole("link", { name: "Сдать weekly" }).click();
  await expect(page).toHaveURL(/\/weekly\/submit$/);
  await expect(page.getByRole("button", { name: "Сдать weekly" })).toBeDisabled();

  await page.getByLabel("Главное одной фразой").fill("Договорились с двумя дилерами о пилоте");
  await page.getByRole("button", { name: "Добавить запись" }).click();
  await page.getByLabel("Что произошло").fill("Два дилера готовы к пилоту в ноябре");
  await page.getByRole("button", { name: "Сохранить запись" }).click();
  await expect(page.getByRole("heading", { name: "Два дилера готовы к пилоту в ноябре" })).toBeVisible();

  await page.getByRole("button", { name: "Сдать weekly" }).click();
  await expect(page.getByText("Weekly сдан").first()).toBeVisible();
});

test("лидер предлагает задачу другому по клавише N", async ({ page }) => {
  await enter(page, "Логинова Светлана");
  await page.goto("/tasks");
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "Новая задача" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Задача", { exact: true }).fill("Сверить тарифы ВЗР с партнёрами");
  await dialog.getByLabel("Что нужно сделать").fill("Таблица тарифов по трём партнёрам");
  await dialog.getByLabel("Ответственный").selectOption("sakhibullina");
  await expect(dialog.getByText("уйдёт со статусом «Предложена»")).toBeVisible();
  await dialog.getByRole("button", { name: "Предложить задачу" }).click();
  await expect(page).toHaveURL(/task=52/);
  await expect(page.getByRole("dialog").getByText("Предложена").first()).toBeVisible();
});
