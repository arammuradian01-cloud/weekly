import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 56: roadmap. Задачи топ-команды по направлениям и месяцам, важные со звёздочками, фильтры в адресе,
// смена важности прямо на карточке. Ноутбук 1440 и телефон 360.
// Этап 68: на ноутбуке по умолчанию карта сроков; доска вторым видом («Доска по месяцам», ?view=board)

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-rm-${name}.png`, fullPage: true });
}

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
});

test("доска по направлениям и срокам, звёздочки важности, фильтры и смена важности", async ({ page }) => {
  const phone = test.info().project.name === "phone";
  const open = await sql(`SELECT number FROM tasks WHERE "teamId" = 'top' AND status = 'IN_PROGRESS' AND "archivedAt" IS NULL AND "ownerId" IS NOT NULL ORDER BY number LIMIT 3`);
  const [a, b, c] = open.map((r) => r.number as number);
  const dir = (code: string) => `(SELECT id FROM dictionary_items WHERE kind = 'DIRECTION' AND code = '${code}')`;
  // Две важные задачи ОСАГО в этом месяце и обычная задача КАСКО в следующем
  await sql(`UPDATE tasks SET priority = 'CRITICAL', due = CURRENT_DATE + 2, "directionId" = ${dir("osago")} WHERE number = $1`, [a]);
  await sql(`UPDATE tasks SET priority = 'HIGH', due = CURRENT_DATE + 3, "directionId" = ${dir("osago")} WHERE number = $1`, [b]);
  await sql(`UPDATE tasks SET priority = 'MEDIUM', due = (date_trunc('month', CURRENT_DATE) + interval '1 month' + interval '4 days')::date, "directionId" = ${dir("kasko")} WHERE number = $1`, [c]);

  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  // На ноутбуке раздел в боковом меню, на телефоне он в «Ещё»: туда идём по адресу
  if (phone) await page.goto("/roadmap");
  else await page.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: "Roadmap" }).click();
  await expect(page).toHaveURL(/\/roadmap/);
  await expect(page.getByRole("heading", { name: "Roadmap", level: 1 })).toBeVisible();

  // Этап 68: на ноутбуке открывается карта сроков, доска вторым видом
  if (!phone) {
    await expect(page.getByTestId("roadmap-timeline")).toBeVisible();
    await page.getByRole("radio", { name: "Доска по месяцам" }).click();
    await expect(page).toHaveURL(/view=board/);
  }

  const board = page.getByTestId(phone ? "roadmap-list" : "roadmap-grid");
  await expect(board).toBeVisible();
  const osago = board.locator("section").filter({ has: page.getByRole("heading", { name: /^ОСАГО/ }) });
  await expect(osago.getByTestId(`roadmap-task-${a}`)).toBeVisible();
  // Критичная задача первой в ячейке, у неё две звёздочки: кнопка важности говорит «критичная»
  await expect(osago.getByRole("button", { name: `Важность задачи ${a}: критичная. Изменить` })).toBeVisible();
  await expect(osago.getByRole("button", { name: `Важность задачи ${b}: важная. Изменить` })).toBeVisible();
  const order = await osago.locator("[data-testid^='roadmap-task-']").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  expect(order.indexOf(`roadmap-task-${a}`)).toBeLessThan(order.indexOf(`roadmap-task-${b}`));
  await expect(page.getByTestId("roadmap-summary")).toContainText("важных");
  await shot(page, "board");

  // Важность меняется звёздочкой: обычная задача КАСКО становится важной
  await board.getByRole("button", { name: `Важность задачи ${c}: обычная. Изменить` }).click();
  await page.getByRole("menuitemradio", { name: /^Важная/ }).click();
  await expect(page.getByText(`Важность задачи ${c}: важная`).first()).toBeVisible();
  await expect(board.getByRole("button", { name: `Важность задачи ${c}: важная. Изменить` })).toBeVisible();
  const [changed] = await sql("SELECT priority FROM tasks WHERE number = $1", [c]);
  expect(changed!.priority).toBe("HIGH");

  // Только важные: фильтр в адресе, обычных задач нет
  await page.getByLabel("Только важные").check();
  await expect(page).toHaveURL(/important=1/);
  const [important] = await sql(`SELECT count(*)::int AS n FROM tasks WHERE "teamId" = 'top' AND "archivedAt" IS NULL AND status IN ('IN_PROGRESS', 'CLARIFY', 'PROPOSED') AND priority IN ('CRITICAL', 'HIGH')`);
  await expect(page.getByTestId("roadmap-summary")).toContainText(`На доске ${important!.n} `);
  await expect(page.getByTestId("roadmap-summary")).toContainText(`важных ${important!.n}`);

  // Доска человека: ссылкой можно поделиться
  const [owner] = await sql(`SELECT p.slug, p."fullName" FROM tasks t JOIN people p ON p.id = t."ownerId" WHERE t.number = $1`, [a]);
  await page.getByLabel("Чьи задачи").selectOption(owner!.slug as string);
  await expect(page).toHaveURL(new RegExp(`person=${owner!.slug}`));
  await expect(board.getByTestId(`roadmap-task-${a}`)).toBeVisible();

  // Карточка открывает задачу
  await board.getByTestId(`roadmap-task-${a}`).getByRole("button", { name: new RegExp(`^${a}`) }).click();
  await expect(page).toHaveURL(new RegExp(`task=${a}`));
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  // Пусто по фильтру: понятное пустое состояние
  await sql(`UPDATE tasks SET priority = 'MEDIUM' WHERE "ownerId" = (SELECT id FROM people WHERE slug = $1)`, [owner!.slug]);
  await page.reload();
  await expect(page.getByText("Важных задач нет")).toBeVisible();
  await shot(page, "empty");
});

test("карта сроков: начало и срок тянутся мышью и с клавиатуры, срок с причиной", async ({ page }) => {
  test.skip(test.info().project.name === "phone", "Карта сроков только на широком экране");
  const [row] = await sql(`SELECT number FROM tasks WHERE "teamId" = 'top' AND status = 'IN_PROGRESS' AND "archivedAt" IS NULL AND "ownerId" IS NOT NULL ORDER BY number LIMIT 1`);
  const n = row!.number as number;
  await sql(`UPDATE tasks SET priority = 'CRITICAL', due = CURRENT_DATE + 14, "startOn" = NULL WHERE number = $1`, [n]);

  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/roadmap");
  const bar = page.getByTestId(`timeline-bar-${n}`);
  await expect(bar).toBeVisible();
  await shot(page, "timeline");

  // Клавиатура: Alt+стрелка вправо три раза двигает начало, Enter сохраняет без причины
  await bar.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByText(`Начало задачи ${n}:`).first()).toBeVisible();
  const [started] = await sql(`SELECT "startOn" FROM tasks WHERE number = $1`, [n]);
  expect(started!.startOn).not.toBeNull();

  // Мышь: правый край на несколько дней вправо, окно с причиной, срок переносится, перенос записан
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 60, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const dialog = page.getByRole("dialog", { name: `Перенести срок задачи ${n}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Перенести срок" })).toBeDisabled();
  await dialog.getByLabel("Причина переноса").fill("Ждём данные партнёра");
  await dialog.getByRole("button", { name: "Перенести срок" }).click();
  await expect(page.getByText(`Срок задачи ${n} перенесён`).first()).toBeVisible();
  const [moved] = await sql(`SELECT (due > CURRENT_DATE + 14) AS later, (SELECT count(*)::int FROM task_transfers tt WHERE tt."taskId" = t.id) AS transfers FROM tasks t WHERE number = $1`, [n]);
  expect(moved!.later).toBe(true);
  expect(moved!.transfers).toBeGreaterThan(0);

  // Нажатие без перетаскивания открывает задачу
  await bar.click();
  await expect(page).toHaveURL(new RegExp(`task=${n}`));
});
