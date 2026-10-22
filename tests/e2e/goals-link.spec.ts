import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, resetDatabase, sql } from "./helpers";

// Этап 65: задачи к целям перетаскиванием. Лидер на ноутбуке тянет задачу мышью на цель, отменяет, тянет две
// отмеченные задачи разом, перевязывает на другую цель, отвязывает в «Без цели» и кнопкой, привязывает с клавиатуры.
// Колонка целей закреплена, чужие задачи в блоке «Только посмотреть», фокус после привязки не теряется.
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

/** Открытая задача топ-команды, которую Фатьянов только видит: не он ответственный, не соисполнитель и не автор */
async function othersTask(): Promise<number> {
  const rows = await sql(
    `SELECT t.number FROM tasks t WHERE t."teamId" = 'top' AND t.status IN ('IN_PROGRESS', 'CLARIFY') AND t."archivedAt" IS NULL
       AND t."ownerId" IS DISTINCT FROM (SELECT id FROM people WHERE slug = 'fatyanov') AND t."createdById" IS DISTINCT FROM (SELECT id FROM people WHERE slug = 'fatyanov')
       AND NOT EXISTS (SELECT 1 FROM task_co_executors c WHERE c."taskId" = t.id AND c."personId" = (SELECT id FROM people WHERE slug = 'fatyanov'))
     ORDER BY t.number LIMIT 1`,
  );
  return rows[0]!.number as number;
}

/** Две открытые задачи Фатьянова из выгрузки Bord: их он ведёт сам. Первые две в списке «Мои задачи» (по сроку): видны без прокрутки */
async function ownTasks(): Promise<[number, number]> {
  const rows = await sql(
    `SELECT number FROM tasks WHERE "ownerId" = (SELECT id FROM people WHERE slug = 'fatyanov') AND status IN ('IN_PROGRESS', 'CLARIFY') AND "archivedAt" IS NULL ORDER BY due, number LIMIT 2`,
  );
  expect(rows.length, "у Фатьянова в выгрузке две открытые задачи").toBe(2);
  return [rows[0]!.number as number, rows[1]!.number as number];
}

const goalOf = async (number: number) => ((await sql(`SELECT "goalId" FROM tasks WHERE number = $1`, [number]))[0]!.goalId as string | null) ?? null;

/**
 * Перетаскивание мышью: dnd-kit начинает после сдвига на 6 точек. Перетаскивание началось, когда под указателем
 * карточка взятого (dragged: её текст). Диктор «Взяли» проверять здесь нельзя: у задачи из карточки цели указатель
 * сразу над этой целью, и «Над: …» тут же сменяет «Взяли» в живой области. Отпускаем, только когда цель уже под
 * задачей («Над: …»): иначе отпускание могло бы опередить перерисовку и уйти мимо цели
 */
async function drag(page: Page, from: Locator, to: Locator, over: string, dragged: string | RegExp = /./, startOver?: string) {
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  await page.mouse.move(a.x + 8, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 30, a.y + a.height / 2, { steps: 5 });
  await expect(page.getByTestId("link-drag-overlay")).toHaveText(dragged);
  if (startOver) await expect(page.getByText(`Над: ${startOver}`)).toBeAttached();
  const b = (await to.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 30), { steps: 15 });
  await expect(page.getByText(`Над: ${over}`)).toBeAttached();
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
  // Колонка целей закреплена на ноутбуке: задачу не тащат через всю страницу
  await expect(page.getByTestId("link-goals")).toHaveCSS("position", "sticky");
  // Задачи, которые Фатьянов только видит, не среди доступных, а в свёрнутом блоке с пояснением, кто может привязать
  const other = await othersTask();
  await expect(page.getByTestId("link-open").getByTestId(`link-task-${other}`)).toHaveCount(0);
  const viewOnly = page.getByTestId("link-view-only");
  await expect(viewOnly).toContainText("Только посмотреть");
  await expect(viewOnly).toContainText("Цель этих задач меняют ответственный, соисполнители, тот, кто поставил задачу, руководитель её команды или команды выше и режим управления");
  // Строки свёрнутого блока не рисуются, пока его не открыли
  await expect(viewOnly.getByTestId(`link-task-${other}`)).toHaveCount(0);
  await viewOnly.getByRole("heading", { name: /Только посмотреть/ }).click();
  await expect(viewOnly.getByTestId(`link-task-${other}`)).toBeVisible();
  await expect(viewOnly.getByRole("button", { name: `К цели: задача ${other}` })).toHaveCount(0);
  await expect(viewOnly.getByLabel(`Отметить задачу ${other}`, { exact: true })).toHaveCount(0);
  await shot(page, "start");

  // Одна задача мышью на цель: тост сразу, связь в базе
  await search(page, String(a));
  await expect(page.getByTestId(`link-task-${a}`)).toBeVisible();
  await drag(page, page.getByTestId(`drag-task-${a}`), d1, `цель «${name(D1)}»`, new RegExp(`^${a}\\. `));
  await expect(status).toContainText(`Задача ${a} привязана к цели «${name(D1)}»`);
  await expect.poll(() => goalOf(a)).toBe(D1.id);
  // В «Без цели» задачи больше нет
  await expect(page.getByTestId(`link-task-${a}`)).toHaveCount(0);

  // «Отменить» в тосте возвращает задачу без цели
  await status.getByRole("button", { name: "Отменить" }).click();
  await expect(status).toContainText("Отменено");
  await expect.poll(() => goalOf(a)).toBeNull();
  await expect(page.getByTestId(`link-task-${a}`)).toBeVisible();

  // Две отмеченные задачи тянутся вместе. Отмеченная, но скрытая поиском задача незаметно не уезжает: экран об этом говорит
  await search(page, "");
  await page.getByLabel(`Отметить задачу ${a}`, { exact: true }).check();
  await page.getByLabel(`Отметить задачу ${b}`, { exact: true }).check();
  await expect(page.getByTestId("link-selection")).toContainText("Отмечено 2 задачи");
  await search(page, String(b));
  await expect(page.getByTestId("link-selection")).toContainText("Отмечено 1 задача");
  await expect(page.getByTestId("link-selection")).toContainText("Ещё 1 скрыта поиском или фильтром: их не тронем");
  await search(page, "");
  await expect(page.getByTestId("link-selection")).toContainText("Отмечено 2 задачи");
  // «Снять отметку»: плашка пропадает, фокус на заголовке «Мои задачи»
  await page.getByTestId("link-selection").getByRole("button", { name: "Снять отметку" }).click();
  await expect(page.getByTestId("link-selection")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Мои задачи" })).toBeFocused();
  await page.getByLabel(`Отметить задачу ${a}`, { exact: true }).check();
  await page.getByLabel(`Отметить задачу ${b}`, { exact: true }).check();
  await expect(page.getByTestId("link-selection")).toContainText("Отмечено 2 задачи");
  await shot(page, "selected");
  // Обе строки и цель видны без прокрутки страницы: тянем вторую отмеченную, диктор говорит, что взяли обе
  await page.evaluate(() => window.scrollTo(0, 0));
  await drag(page, page.getByTestId(`drag-task-${b}`), d1, `цель «${name(D1)}»`, "Отмеченные задачи: 2");
  await expect(status).toContainText(`2 задачи привязаны к цели «${name(D1)}»`);
  await expect.poll(() => goalOf(a)).toBe(D1.id);
  await expect.poll(() => goalOf(b)).toBe(D1.id);
  await expect(page.getByTestId("link-selection")).toHaveCount(0);

  // Карточка цели раскрывается задачами; задачу тянут на другую цель
  await d1.getByRole("button", { name: new RegExp(`^Задачи 2, цель «${D1.code}`) }).click();
  await expect(d1.getByTestId(`link-goal-tally-${D1.id}`)).toHaveText("закрыто 0 из 2");
  await expect(d1.getByTestId(`link-goal-task-${a}`)).toBeVisible();
  await expect(d1.getByTestId(`link-goal-task-${b}`)).toBeVisible();
  await shot(page, "goal-open");
  // Взяли из карточки цели: указатель сразу над той же целью, она говорит, что задача уже у неё
  await drag(page, d1.getByTestId(`drag-goal-task-${a}`), d2, `цель «${name(D2)}»`, new RegExp(`^${a}\\. `), `цель «${name(D1)}», задача уже у неё`);
  await expect(status).toContainText(`Задача ${a} привязана к цели «${name(D2)}»`);
  await expect.poll(() => goalOf(a)).toBe(D2.id);
  await expect(d1.getByTestId(`link-goal-task-${a}`)).toHaveCount(0);

  // В «Без цели» задача отвязывается
  await d2.getByRole("button", { name: new RegExp(`^Задачи 1, цель «${D2.code}`) }).click();
  await drag(page, d2.getByTestId(`drag-goal-task-${a}`), page.getByTestId("link-none"), "без цели, цель снимется");
  await expect(status).toContainText(`Задача ${a} отвязана от цели`);
  await expect.poll(() => goalOf(a)).toBeNull();

  // Кнопкой в карточке цели; строки больше нет, фокус на кнопке «Задачи» этой цели
  await d1.getByRole("button", { name: `Отвязать задачу ${b} от цели` }).click();
  await expect(status).toContainText(`Задача ${b} отвязана от цели`);
  await expect.poll(() => goalOf(b)).toBeNull();
  await expect(d1.getByRole("button", { name: new RegExp(`^Задачи 0, цель «${D1.code}`) })).toBeFocused();
  await expect(d1.getByTestId(`link-goal-tally-${D1.id}`)).toHaveText("задач пока нет");

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
  // Строка ушла из «Без цели», других строк под поиском нет: фокус на заголовке «Мои задачи», а не потерян
  await expect(page.getByRole("heading", { name: "Мои задачи" })).toBeFocused();

  // «Снять цель» у отмеченной задачи во «Все»: тост, фокус на заголовке «Мои задачи»
  await page.getByRole("radiogroup", { name: "Показать" }).getByRole("radio", { name: /Все/ }).click();
  await page.getByLabel(`Отметить задачу ${a}`, { exact: true }).check();
  await page.getByTestId("link-selection").getByRole("button", { name: "Снять цель" }).click();
  await expect(status).toContainText(`Задача ${a} отвязана от цели`);
  await expect.poll(() => goalOf(a)).toBeNull();
  await expect(page.getByRole("heading", { name: "Мои задачи" })).toBeFocused();

  // Журнал: каждая связь и отмена записаны в истории задачи
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM audit_log WHERE entity = 'task' AND "entityId" = $1 AND field IN ('Цель', 'Цель (отмена)')`, [String(a)]);
  expect(n).toBeGreaterThanOrEqual(7);
  await search(page, "");
  await shot(page, "done");
});

test("колонка целей длиннее экрана: задача доезжает до последней цели у края колонки, колесо крутит колонку во время перетаскивания", async ({ page }) => {
  test.skip(isPhone(), "колонка целей закреплена и прокручивается сама только на ноутбуке");
  test.setTimeout(120_000);
  // Ещё 12 целей топ-команды: колонка заметно длиннее окна
  const extra = Array.from({ length: 12 }, (_, i) => ({ id: `e2e-goal-x${i + 1}`, code: `X${i + 1}`, title: `Дополнительная цель ${i + 1}` }));
  for (const [i, g] of extra.entries()) {
    await sql(`INSERT INTO goals (id, quarter, code, title, "teamId", "sortOrder", "updatedAt") VALUES ($1, $2, $3, $4, 'top', $5, now())`, [g.id, quarter(), g.code, g.title, 100 + i]);
  }
  const last = extra[extra.length - 1]!;
  const [a, b] = await ownTasks();
  await enter(page, "Фатьянов Евгений");
  await openLinkMode(page);
  const status = page.locator(".sv-toast");
  const column = page.getByTestId("link-goals");
  expect(await column.evaluate((el) => el.scrollHeight > el.clientHeight + 200), "у колонки целей своя прокрутка").toBe(true);
  // Курсор с задачей у нижнего края колонки: колонка крутится сама до последней цели. Страница внизу: колонка
  // прилипла к верху окна (и без этого край считается по видимой части колонки)
  await search(page, String(a));
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const from = page.getByTestId(`drag-task-${a}`);
  await from.scrollIntoViewIfNeeded();
  const s = (await from.boundingBox())!;
  await page.mouse.move(s.x + 8, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + 30, s.y + s.height / 2, { steps: 5 });
  const c = (await column.boundingBox())!;
  const bottom = Math.min(c.y + c.height, page.viewportSize()!.height);
  await page.mouse.move(c.x + c.width / 2, bottom - 12, { steps: 10 });
  await expect.poll(() => column.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2), { timeout: 15_000 }).toBe(true);
  const target = (await page.getByTestId(`link-goal-${last.id}`).boundingBox())!;
  await page.mouse.move(target.x + target.width / 2, target.y + Math.min(target.height / 2, 30), { steps: 8 });
  await expect(page.getByText(`Над: цель «${name(last)}»`)).toBeAttached();
  await page.mouse.up();
  await expect(status).toContainText(`Задача ${a} привязана к цели «${name(last)}»`);
  await expect.poll(() => goalOf(a)).toBe(last.id);
  await shot(page, "long-column");

  // Колесо во время перетаскивания крутит колонку, а не страницу: карточка задачи под курсором колесо не ловит
  await search(page, String(b));
  const from2 = page.getByTestId(`drag-task-${b}`);
  await from2.scrollIntoViewIfNeeded();
  const s2 = (await from2.boundingBox())!;
  await page.mouse.move(s2.x + 8, s2.y + s2.height / 2);
  await page.mouse.down();
  await page.mouse.move(s2.x + 30, s2.y + s2.height / 2, { steps: 5 });
  const c2 = (await column.boundingBox())!;
  const middle = (Math.max(c2.y, 0) + Math.min(c2.y + c2.height, page.viewportSize()!.height)) / 2;
  await page.mouse.move(c2.x + c2.width / 2, middle, { steps: 10 });
  await page.mouse.wheel(0, -5000);
  await expect.poll(() => column.evaluate((el) => el.scrollTop)).toBe(0);
  const first = (await page.getByTestId(`link-goal-${D1.id}`).boundingBox())!;
  await page.mouse.move(first.x + first.width / 2, first.y + Math.min(first.height / 2, 30), { steps: 8 });
  await expect(page.getByText(`Над: цель «${name(D1)}»`)).toBeAttached();
  await page.mouse.up();
  await expect(status).toContainText(`Задача ${b} привязана к цели «${name(D1)}»`);
  await expect.poll(() => goalOf(b)).toBe(D1.id);
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
  // Строка с кнопкой ушла из «Без цели»: фокус на заголовке «Мои задачи»
  await expect(page.getByRole("heading", { name: "Мои задачи" })).toBeFocused();

  // Во «Все» задача видна с целью; снова «К цели» и «Без цели»
  await page.getByRole("radiogroup", { name: "Показать" }).getByRole("radio", { name: /Все/ }).click();
  await expect(row).toContainText(name(D1));
  await row.getByRole("button", { name: `К цели: задача ${a}` }).click();
  await page.getByRole("dialog", { name: `Задача ${a}: к цели` }).getByRole("button", { name: /^Без цели/ }).click();
  await expect(status).toContainText(`Задача ${a} отвязана от цели`);
  await expect.poll(() => goalOf(a)).toBeNull();
  // Во «Все» строка осталась: фокус вернулся на её кнопку «К цели»
  await expect(row.getByRole("button", { name: `К цели: задача ${a}` })).toBeFocused();

  // Карточка цели на телефоне раскрывается и тоже без горизонтальной прокрутки
  const d1 = page.getByTestId(`link-goal-${D1.id}`);
  await d1.getByRole("button", { name: new RegExp(`^Задачи 0, цель «${D1.code}`) }).click();
  await expect(d1).toContainText("Задач пока нет");
  await shot(page, "done");
});
