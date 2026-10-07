import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 25: фильтры в адресе, сортировка, сохранённый вид, массовое действие, чек-лист, повтор, командная строка
// и страница поиска. На ноутбуке и телефоне

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-sv-${name}.png`, fullPage: true });
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("фильтры и сортировка живут в адресе, вид сохраняется, массовое действие меняет приоритет у двух задач", async ({ page, isMobile }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/tasks");
  await page.getByRole("button", { name: /^Мои/ }).click();
  await expect(page).toHaveURL(/f=mine/);
  await page.getByLabel("Группировать").selectOption("none");
  await expect(page).toHaveURL(/group=none/);
  if (!isMobile) {
    const dueHeader = page.getByRole("columnheader", { name: "Срок" });
    await dueHeader.getByRole("button").click();
    await expect(page).toHaveURL(/sort=due/);
    await expect(dueHeader).toHaveAttribute("aria-sort", "ascending");
    await dueHeader.getByRole("button").click();
    await expect(page).toHaveURL(/dir=desc/);
  }
  // Ссылка открывает тот же вид после перезагрузки
  await page.reload();
  await expect(page.getByRole("button", { name: /^Мои/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Группировать")).toHaveValue("none");

  // Сохранённый вид
  await page.getByRole("button", { name: "Сохранить вид" }).click();
  await page.getByLabel("Имя вида").fill("Мои по сроку");
  await page.getByRole("dialog", { name: "Сохранить вид" }).getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Вид «Мои по сроку» сохранён").first()).toBeVisible();
  const chip = page.getByRole("link", { name: "Мои по сроку" });
  await expect(chip).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Сбросить" }).click();
  await expect(page).not.toHaveURL(/f=mine/);
  await chip.click();
  await expect(page).toHaveURL(/f=mine/);
  await shot(page, "views");

  // Массовое действие: приоритет у двух задач. Журнал только дописывается, поэтому считаем прирост
  const logQuery = `SELECT count(*)::int AS n FROM audit_log WHERE entity = 'task' AND "entityId" IN ('13', '28') AND field = 'Приоритет'`;
  const before = (await sql(logQuery))[0].n;
  await page.goto("/tasks?group=none");
  await page.locator('input[aria-label="Выбрать задачу 13"]:visible').check();
  await page.locator('input[aria-label="Выбрать задачу 28"]:visible').check();
  await page.getByRole("region", { name: "Выбранные задачи" }).getByRole("button", { name: "Приоритет" }).click();
  const dialog = page.getByRole("dialog", { name: /Приоритет у 2 задач/ });
  await dialog.getByLabel("Новый приоритет").selectOption("critical");
  await dialog.getByRole("button", { name: "Изменить у 2" }).click();
  await expect(page.getByText("Изменено задач: 2").first()).toBeVisible();
  const rows = await sql(`SELECT count(*)::int AS n FROM tasks WHERE number IN (13, 28) AND priority = 'CRITICAL'`);
  expect(rows[0].n).toBe(2);
  expect((await sql(logQuery))[0].n - before).toBe(2);
});

test("чек-лист ведётся в карточке, повтор создаёт следующую задачу при закрытии", async ({ page }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/tasks/28");
  await page.getByLabel("Новый пункт").fill("Собрать цифры");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(page.getByText("Пункт добавлен").first()).toBeVisible();
  await page.getByLabel("Новый пункт").fill("Согласовать с СК");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await page.getByRole("checkbox", { name: "Собрать цифры" }).check();
  await expect(page.getByRole("heading", { name: /Чек-лист 1 из 2/ })).toBeVisible();

  // Повтор еженедельно
  await page.getByRole("button", { name: "Повторять" }).click();
  const rp = page.getByRole("dialog", { name: /Повтор задачи 28/ });
  await rp.getByLabel("Как часто").selectOption("weekly");
  await rp.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Еженедельно, при закрытии").first()).toBeVisible();
  await shot(page, "checklist");

  // Закрываем: появляется следующая
  await page.getByRole("button", { name: /^Статус: В работе/ }).click();
  await page.getByRole("menuitem", { name: "Выполнена", exact: true }).click();
  const st = page.getByRole("dialog");
  await st.getByLabel("Итог или ссылка на результат").fill("Прогноз сдан");
  await st.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("button", { name: /^Статус: Выполнена/ })).toBeVisible();
  await expect(page.getByText(/следующая: \d+/)).toBeVisible();
  const [{ number, title, due }] = await sql(`SELECT n.number, n.title, to_char(n.due, 'YYYY-MM-DD') AS due FROM tasks n JOIN tasks p ON n."repeatOfId" = p.id WHERE p.number = 28`);
  const [{ pdue }] = await sql(`SELECT to_char(due + 7, 'YYYY-MM-DD') AS pdue FROM tasks WHERE number = 28`);
  expect(title).toBe((await sql(`SELECT title FROM tasks WHERE number = 28`))[0].title);
  expect(due >= pdue).toBe(true);
  const items = await sql(`SELECT text, done FROM task_checklist_items WHERE "taskId" = (SELECT id FROM tasks WHERE number = $1) ORDER BY "sortOrder"`, [number]);
  expect(items).toEqual([
    { text: "Собрать цифры", done: false },
    { text: "Согласовать с СК", done: false },
  ]);
});

test("командная строка ищет по словоформам и открывает задачу, страница поиска показывает группы", async ({ page, isMobile }) => {
  await enter(page, "Мурадян Арам");
  await page.goto("/");
  if (isMobile) await page.getByRole("button", { name: "Поиск и действия" }).click();
  else await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox", { name: "Поиск и действия" });
  await expect(box).toBeFocused();
  await expect(page.getByRole("option", { name: /Новая задача/ })).toBeVisible();
  const [{ title }] = await sql(`SELECT title FROM tasks WHERE number = 28`);
  const word = title.split(/\s+/).find((w: string) => w.length > 5)!.replace(/[^\p{L}]/gu, "");
  await box.fill(word.slice(0, -1));
  const option = page.getByRole("option", { name: new RegExp(`^28 `) });
  await expect(option).toBeVisible();
  await shot(page, "palette");
  await option.click();
  await expect(page).toHaveURL(/\/tasks\/28$/);

  // Страница поиска со ссылкой
  await page.goto(`/search?q=${encodeURIComponent(word)}`);
  await expect(page.getByRole("heading", { name: /^Задачи/ })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`28 ${title.slice(0, 15)}`) })).toBeVisible();
  await shot(page, "search");
  await page.goto("/search?q=ыыыыыы");
  await expect(page.getByText(/ничего не нашлось/)).toBeVisible();
});
