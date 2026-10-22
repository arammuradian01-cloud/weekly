import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, resetDatabase, sql } from "./helpers";

// Этап 65: задачи к целям перетаскиванием. Лидер на ноутбуке тянет задачу мышью на цель, отменяет, тянет две
// отмеченные задачи разом, перевязывает на другую цель, отвязывает в «Без цели» и кнопкой, привязывает с клавиатуры.
// На телефоне без перетаскивания: «К цели» у задачи и выбор цели из списка. Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

const D1 = { id: "e2e-goal-d1", code: "D1", title: "Маржа департамента 150 млн" };
const D2 = { id: "e2e-goal-d2", code: "D2", title: "Доля приложения 15%" };
const name = (g: { code: string; title: string }) => `${g.code}. ${g.title}`;

/** Текущий квартал по Москве: цели экрана на него */
function quarter(): string {
  const now = new Date(Date.now() + 3 * 3_600_000);
  return `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
}

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
  for (const [i, g] of [D1, D2].entries()) {
    await sql(`INSERT INTO goals (id, quarter, code, title, "teamId", "sortOrder", "updatedAt") VALUES ($1, $2, $3, $4, 'top', $5, now())`, [g.id, quarter(), g.code, g.title, (i + 1) * 10]);
  }
});

const isPhone = () => test.info().project.name === "phone";

async function shot(page: Page, label: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${label}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-gl-${label}.png`, fullPage: true });
}

/** Две открытые задачи Фатьянова из выгрузки Bord: их он ведёт сам */
async function ownTasks(): Promise<[number, number]> {
  const rows = await sql(
    `SELECT number FROM tasks WHERE "ownerId" = (SELECT id FROM people WHERE slug = 'fatyanov') AND status IN ('IN_PROGRESS', 'CLARIFY') AND "archivedAt" IS NULL ORDER BY number LIMIT 2`,
  );
  expect(rows.length, "у Фатьянова в выгрузке две открытые задачи").toBe(2);
  return [rows[0]!.number as number, rows[1]!.number as number];
}

const goalOf = async (number: number) => ((await sql(`SELECT "goalId" FROM tasks WHERE number = $1`, [number]))[0]!.goalId as string | null) ?? null;

/** Перетаскивание мышью: dnd-kit начинает после сдвига на 6 точек */
async function drag(page: Page, from: Locator, to: Locator) {
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  await page.mouse.move(a.x + 8, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 30, a.y + a.height / 2, { steps: 5 });
  const b = (await to.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 30), { steps: 15 });
  await page.mouse.up();
}

async function openLinkMode(page: Page) {
  await page.goto("/goals");
  const tab = page.getByTestId("goals-tab-link");
  await expect(tab).toHaveText("Связать задачи с целями");
  if (isPhone()) expect((await tab.boundingBox())!.height, "вкладка не ниже 44 px").toBeGreaterThanOrEqual(44);
  await tab.click();
  await expect(page).toHaveURL(/\/goals\?mode=link/);
  await expect(page.getByRole("heading", { name: "Мои задачи" })).toBeVisible();
  await expect(page.getByTestId(`link-goal-${D1.id}`)).toBeVisible();
}

async function search(page: Page, text: string) {
  await page.getByLabel("Поиск задачи").fill(text);
}

test("лидер перетаскивает задачи к целям: привязать, отменить, две разом, перевязать, отвязать, с клавиатуры", async ({ page }) => {
  test.skip(isPhone(), "на телефоне задачи к целям привязывают кнопкой «К цели», это следующий тест");
  test.setTimeout(120_000);
  const [a, b] = await ownTasks();
  await enter(page, "Фатьянов Евгений");
  await openLinkMode(page);
  // Тост приложения: у перетаскивания своя живая область для экранного диктора, она тоже role="status"
  const status = page.locator(".sv-toast");
  const d1 = page.getByTestId(`link-goal-${D1.id}`);
  const d2 = page.getByTestId(`link-goal-${D2.id}`);
  await expect(page.getByRole("radiogroup", { name: "Показать" }).getByRole("radio", { name: /Без цели/ })).toHaveAttribute("aria-checked", "true");
  await shot(page, "start");

  // Одна задача мышью на цель: тост сразу, связь в базе
  await search(page, String(a));
  await expect(page.getByTestId(`link-task-${a}`)).toBeVisible();
  await drag(page, page.getByTestId(`drag-task-${a}`), d1);
  await expect(status).toContainText(`Задача ${a} привязана к цели «${name(D1)}»`);
  await expect.poll(() => goalOf(a)).toBe(D1.id);
  // В «Без цели» задачи больше нет
  await expect(page.getByTestId(`link-task-${a}`)).toHaveCount(0);

  // «Отменить» в тосте возвращает задачу без цели
  await status.getByRole("button", { name: "Отменить" }).click();
  await expect(status).toContainText("Отменено");
  await expect.poll(() => goalOf(a)).toBeNull();
  await expect(page.getByTestId(`link-task-${a}`)).toBeVisible();

  // Две отмеченные задачи тянутся вместе
  await page.getByLabel(`Отметить задачу ${a}`, { exact: true }).check();
  await search(page, String(b));
  await page.getByLabel(`Отметить задачу ${b}`, { exact: true }).check();
  await expect(page.getByTestId("link-selection")).toContainText("Отмечено 2 задачи");
  await shot(page, "selected");
  await drag(page, page.getByTestId(`drag-task-${b}`), d1);
  await expect(status).toContainText(`2 задачи привязаны к цели «${name(D1)}»`);
  await expect.poll(() => goalOf(a)).toBe(D1.id);
  await expect.poll(() => goalOf(b)).toBe(D1.id);
  await expect(page.getByTestId("link-selection")).toHaveCount(0);

  // Карточка цели раскрывается задачами; задачу тянут на другую цель
  await d1.getByRole("button", { name: new RegExp(`^Задачи 2, цель «${D1.code}`) }).click();
  await expect(d1.getByTestId(`link-goal-task-${a}`)).toBeVisible();
  await expect(d1.getByTestId(`link-goal-task-${b}`)).toBeVisible();
  await shot(page, "goal-open");
  await drag(page, d1.getByTestId(`drag-goal-task-${a}`), d2);
  await expect(status).toContainText(`Задача ${a} привязана к цели «${name(D2)}»`);
  await expect.poll(() => goalOf(a)).toBe(D2.id);
  await expect(d1.getByTestId(`link-goal-task-${a}`)).toHaveCount(0);

  // В «Без цели» задача отвязывается
  await d2.getByRole("button", { name: new RegExp(`^Задачи 1, цель «${D2.code}`) }).click();
  await drag(page, d2.getByTestId(`drag-goal-task-${a}`), page.getByTestId("link-none"));
  await expect(status).toContainText(`Задача ${a} отвязана от цели`);
  await expect.poll(() => goalOf(a)).toBeNull();

  // Кнопкой в карточке цели
  await d1.getByRole("button", { name: `Отвязать задачу ${b} от цели` }).click();
  await expect(status).toContainText(`Задача ${b} отвязана от цели`);
  await expect.poll(() => goalOf(b)).toBeNull();

  // С клавиатуры: пробел берёт задачу, стрелка ведёт к первой подходящей цели, пробел отпускает
  await search(page, String(a));
  const handle = page.getByTestId(`drag-task-${a}`);
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(page.getByText(new RegExp(`Взяли: задача ${a}`))).toBeAttached();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByText(`Над: цель «${name(D1)}»`)).toBeAttached();
  await page.keyboard.press("Space");
  await expect(status).toContainText(`Задача ${a} привязана к цели «${name(D1)}»`);
  await expect.poll(() => goalOf(a)).toBe(D1.id);

  // Журнал: каждая связь и отмена записаны в истории задачи
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM audit_logs WHERE entity = 'task' AND "entityId" = $1 AND field IN ('Цель', 'Цель (отмена)')`, [String(a)]);
  expect(n).toBeGreaterThanOrEqual(6);
  await page.getByRole("radiogroup", { name: "Показать" }).getByRole("radio", { name: /Все/ }).click();
  await search(page, "");
  await shot(page, "done");
});

test("на телефоне задача к цели кнопкой «К цели» и выбором из списка", async ({ page }) => {
  test.skip(!isPhone(), "на ноутбуке перетаскивание проверяет прошлый тест");
  test.setTimeout(90_000);
  const [a] = await ownTasks();
  await enter(page, "Фатьянов Евгений");
  await openLinkMode(page);
  await shot(page, "start");
  // Тост приложения: у перетаскивания своя живая область для экранного диктора, она тоже role="status"
  const status = page.locator(".sv-toast");

  await search(page, String(a));
  const row = page.getByTestId(`link-task-${a}`);
  const button = row.getByRole("button", { name: `К цели: задача ${a}` });
  await expect(button).toBeVisible();
  // Цели нажатия на телефоне не меньше 44 px
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await row.locator("label").boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await button.click();
  const dialog = page.getByRole("dialog", { name: `Задача ${a}: к цели` });
  await expect(dialog.getByTestId(`link-pick-${D1.id}`)).toBeEnabled();
  expect((await dialog.getByTestId(`link-pick-${D1.id}`).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await shot(page, "picker");
  await dialog.getByTestId(`link-pick-${D1.id}`).click();
  await expect(dialog).toHaveCount(0);
  await expect(status).toContainText(`Задача ${a} привязана к цели «${name(D1)}»`);
  await expect.poll(() => goalOf(a)).toBe(D1.id);

  // Во «Все» задача видна с целью; снова «К цели» и «Без цели»
  await page.getByRole("radiogroup", { name: "Показать" }).getByRole("radio", { name: /Все/ }).click();
  await expect(row).toContainText(name(D1));
  await row.getByRole("button", { name: `К цели: задача ${a}` }).click();
  await page.getByRole("dialog", { name: `Задача ${a}: к цели` }).getByRole("button", { name: /^Без цели/ }).click();
  await expect(status).toContainText(`Задача ${a} отвязана от цели`);
  await expect.poll(() => goalOf(a)).toBeNull();

  // Карточка цели на телефоне раскрывается и тоже без горизонтальной прокрутки
  const d1 = page.getByTestId(`link-goal-${D1.id}`);
  await d1.getByRole("button", { name: new RegExp(`^Задачи 0, цель «${D1.code}`) }).click();
  await expect(d1).toContainText("Задач пока нет");
  await shot(page, "done");
});
