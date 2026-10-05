import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { mkdirSync } from "node:fs";
import { E2E_PASSWORDS } from "./global-setup";

// Прототип этапа 2: экраны на задачах и weekly из Insurance&Invest Bord, правки живут в памяти браузера.
// Тесты не завязаны на число строк: таблица меняется, проверяем правила и сценарии

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
    ["/tasks/mine", /Просроченные|Срок на этой неделе|Срок на следующей неделе|Остальные в работе/],
    ["/tasks/review", /Задача со встречи|Критичные/],
    ["/tasks/13", /Договориться с ВСК о лучших условиях/],
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

test("лента weekly: последняя разобранная неделя и общие записи без автора", async ({ page }) => {
  await enter(page, "Головкин Владислав");
  await page.goto("/weekly");
  await expect(page.getByText(/За неделю \d+ записей пока нет\. Показана неделя 39/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Общее, без автора/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Рева Тарас" })).toBeVisible();
  await page.getByRole("radio", { name: "По блокам" }).click();
  await expect(page.getByRole("heading", { name: /^Цифры и прогноз/ })).toBeVisible();
});

test("быстрые фильтры, поиск и карточка задачи по ссылке", async ({ page }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/tasks");
  const overdue = page.getByRole("button", { name: /^Просроченные/ });
  const count = Number((await overdue.textContent())!.replace(/\D+/g, ""));
  await overdue.click();
  await expect(page.getByText(`Показано ${count} по фильтрам`)).toBeVisible();
  await overdue.click();

  // Задача 12 перенесена в таблице до запуска ресурса: исходный срок не записан
  await page.getByLabel("Поиск по тексту и номеру").fill("12");
  await expect(page.getByText("Показано 1 по фильтрам")).toBeVisible();
  await page.getByRole("button", { name: "Оценить рынок КАСКО" }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/task=12/);
  const card = page.getByRole("dialog");
  await expect(card.getByText(/Исходный срок не записан, переносов 1/)).toBeVisible();
  await expect(card.getByText("История переносов")).toBeVisible();
  // Чужую задачу лидер не меняет: статус показан меткой без выбора
  await expect(card.getByRole("button", { name: /^Статус:/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/task=/);
});

test("закрыть свою задачу можно только с итогом, последнее действие отменяется", async ({ page }) => {
  await enter(page, "Фатьянов Евгений");
  await page.goto("/tasks/13");
  await page.getByRole("button", { name: /^Статус: В работе/ }).click();
  await page.getByRole("menuitem", { name: "Выполнена", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Нужен короткий итог");
  await dialog.getByLabel("Итог или ссылка на результат").fill("Проверка сценария закрытия");
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("button", { name: /^Статус: Выполнена/ })).toBeVisible();
  await expect(page.getByText("Проверка сценария закрытия").first()).toBeVisible();

  await page.getByRole("status").getByRole("button", { name: "Отменить" }).click();
  await expect(page.getByRole("button", { name: /^Статус: В работе/ })).toBeVisible();
});

test("перенос срока без причины невозможен", async ({ page }) => {
  await enter(page, "Фатьянов Евгений");
  await page.goto("/tasks/12");
  await page.getByRole("button", { name: "Перенести срок" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Новый срок").fill("2030-01-15");
  await dialog.getByRole("button", { name: "Перенести" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Без причины перенести нельзя");
  await dialog.getByLabel("Причина переноса").fill("Проверка сценария переноса");
  await dialog.getByRole("button", { name: "Перенести" }).click();
  await expect(page.getByText(/переносов 2/)).toBeVisible();
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
