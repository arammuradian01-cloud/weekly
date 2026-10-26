import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterManagement, resetDatabase, sql } from "./helpers";
import { contrastReport } from "./contrast";

// Этап 77: roadmap по целям. Группировка «По задачам», «По целям» и «Цели и задачи» на карте сроков и на доске,
// выбор в адресе (?group=), переход к цели на экран «Цели», группа «Задачи без цели», свёртка групп, перетаскивание
// полосы задачи под целью с проверкой прав, у строки цели перетаскивания нет. Ноутбук 1440 и телефон 360.

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });
const phone = () => test.info().project.name === "phone";

/** Сегодня по Москве в базе */
const MSK = "(now() AT TIME ZONE 'Europe/Moscow')::date";

/** Квартал по Москве, как в ресурсе: 2026-Q4 */
function quarterNow(): string {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const year = d.find((p) => p.type === "year")!.value;
  const month = Number(d.find((p) => p.type === "month")!.value);
  return `${year}-Q${Math.ceil(month / 3)}`;
}

const person = (slug: string) => `(SELECT id FROM people WHERE slug = '${slug}')`;

async function shot(page: Page, name: string, opts: { contrast?: boolean } = {}) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  if (opts.contrast) {
    const report = await contrastReport(page, 4.5);
    expect(report.unparsed, `цвета, которые проверка не разобрала на экране ${name}`).toEqual([]);
    expect(report.low, `текст без контраста на экране ${name}: ${JSON.stringify(report.low)}`).toEqual([]);
  }
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-rm77-${name}.png`, fullPage: true });
}

/**
 * Три цели топ-команды: РТ-1 с двумя задачами (Ревы и Фатьянова), РТ-2 в риске с одной задачей, РТ-3 без задач.
 * Остальные открытые задачи топ-команды без цели. Возвращает номера задач
 */
async function seed() {
  const q = quarterNow();
  await sql(
    `INSERT INTO goals (id, quarter, code, title, "teamId", "ownerId", "atRisk", "riskNote", result, "sortOrder", "updatedAt") VALUES
      ('e77-g1', $1, 'РТ-1', 'Подписка ОСАГО запущена', 'top', ${person("reva")}, false, NULL, 'IN_PROGRESS', 1, now()),
      ('e77-g2', $1, 'РТ-2', 'Продающий контакт-центр', 'top', ${person("loginova")}, true, 'Нет подрядчика', 'IN_PROGRESS', 2, now()),
      ('e77-g3', $1, 'РТ-3', 'Новая форма расчёта на всём трафике', 'top', ${person("muradyan")}, false, NULL, 'IN_PROGRESS', 3, now())`,
    [q],
  );
  const pick = async (slug: string, skip: number[] = []) =>
    (
      await sql(
        `SELECT t.number FROM tasks t JOIN people p ON p.id = t."ownerId" WHERE p.slug = $1 AND t."teamId" = 'top' AND t.status = 'IN_PROGRESS' AND t."archivedAt" IS NULL AND NOT (t.number = ANY($2)) ORDER BY t.number LIMIT 1`,
        [slug, skip],
      )
    )[0]!.number as number;
  const own = await pick("reva");
  const other = await pick("fatyanov");
  const risky = await pick("reva", [own]);
  await sql(`UPDATE tasks SET "goalId" = 'e77-g1', "startOn" = ${MSK} + 2, due = ${MSK} + 20, priority = 'HIGH' WHERE number = $1`, [own]);
  await sql(`UPDATE tasks SET "goalId" = 'e77-g1', "startOn" = ${MSK} + 5, due = ${MSK} + 30 WHERE number = $1`, [other]);
  await sql(`UPDATE tasks SET "goalId" = 'e77-g2', "startOn" = ${MSK} + 1, due = ${MSK} + 10 WHERE number = $1`, [risky]);
  const [free] = await sql(`SELECT number FROM tasks WHERE "teamId" = 'top' AND status = 'IN_PROGRESS' AND "archivedAt" IS NULL AND "goalId" IS NULL ORDER BY number LIMIT 1`);
  return { q, own, other, risky, free: free!.number as number };
}

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
});

test("три группировки на карте сроков и на доске, задачи без цели, свёртка, адрес хранит выбор, переход к цели", async ({ page }) => {
  test.setTimeout(150_000);
  const { q, own, other, risky, free } = await seed();
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/roadmap");
  const groupSwitch = page.getByRole("radiogroup", { name: "Группировка" });
  await expect(groupSwitch.getByRole("radio", { name: "По задачам" })).toHaveAttribute("aria-checked", "true");

  if (phone()) {
    // Телефон: переключатель помещается в 360, кнопки не ниже 44 px, вида карты сроков нет
    const box = (await groupSwitch.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    for (const name of ["По задачам", "По целям", "Цели и задачи"]) {
      const b = (await groupSwitch.getByRole("radio", { name }).boundingBox())!;
      expect(b.height, `высота кнопки «${name}»`).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByRole("radiogroup", { name: "Вид roadmap" })).toHaveCount(0);
  } else {
    await expect(page.getByTestId("roadmap-timeline")).toBeVisible();
  }

  // По целям
  await groupSwitch.getByRole("radio", { name: "По целям" }).click();
  await expect(page).toHaveURL(/group=goals/);
  if (phone()) {
    const list = page.getByTestId("roadmap-list");
    await expect(list).toHaveAttribute("data-group", "goals");
    await expect(list.getByTestId("roadmap-goal-e77-g1")).toBeVisible();
    await expect(list.getByTestId("roadmap-goal-e77-g2")).toContainText("В риске");
    await expect(list.getByTestId("roadmap-goal-e77-g3")).toHaveAttribute("data-empty", "true");
    await expect(list.getByTestId("roadmap-goal-e77-g3")).toContainText("задач нет, до конца квартала");
    await shot(page, "goals-list", { contrast: true });
  } else {
    const tl = page.getByTestId("roadmap-timeline");
    await expect(tl.getByTestId("timeline-goals")).toBeVisible();
    await expect(tl.getByTestId("timeline-goal-e77-g1")).toContainText("РТ-1");
    await expect(tl.getByTestId("timeline-goal-e77-g2")).toContainText("В риске");
    // Цель без задач: полоса пунктиром до конца квартала
    await expect(tl.getByTestId("timeline-goalbar-e77-g3")).toHaveAttribute("data-empty", "true");
    await expect(tl.getByTestId("timeline-goalbar-e77-g3")).toContainText("задач нет");
    await expect(tl.getByTestId("timeline-goalbar-e77-g1")).not.toHaveAttribute("data-empty", "true");
    // У строки цели нет ручек перетаскивания и подсказки про клавиатуру
    await expect(tl.getByTestId("timeline-goal-e77-g1").locator("[data-handle]")).toHaveCount(0);
    await expect(page.getByTestId("roadmap-summary")).toContainText("На карте 3 цели");
    await shot(page, "goals-timeline", { contrast: true });

    // Доска по месяцам: карточки целей по месяцу самого позднего срока
    await page.getByRole("radio", { name: "Доска по месяцам" }).click();
    await expect(page).toHaveURL(/view=board/);
    await expect(page).toHaveURL(/group=goals/);
    const grid = page.getByTestId("roadmap-grid");
    await expect(grid).toHaveAttribute("data-group", "goals");
    await expect(grid.getByTestId("roadmap-goal-e77-g1")).toBeVisible();
    await expect(grid.getByTestId("roadmap-goal-e77-g3")).toHaveAttribute("data-empty", "true");
    await shot(page, "goals-board");
  }

  // Цели и задачи
  await groupSwitch.getByRole("radio", { name: "Цели и задачи" }).click();
  await expect(page).toHaveURL(/group=both/);
  const container = page.getByTestId(phone() ? "roadmap-list" : "roadmap-grid");
  await expect(container).toHaveAttribute("data-group", "both");
  const g1 = container.getByTestId("roadmap-group-e77-g1");
  await expect(g1.getByTestId(`roadmap-task-${own}`)).toBeVisible();
  await expect(g1.getByTestId(`roadmap-task-${other}`)).toBeVisible();
  await expect(container.getByTestId("roadmap-group-e77-g2").getByTestId(`roadmap-task-${risky}`)).toBeVisible();
  await expect(container.getByTestId("roadmap-group-e77-g3")).toContainText("Открытых задач у цели нет");
  // Задачи без цели последней группой, счётчик в заголовке
  const nogoal = container.getByTestId("roadmap-nogoal");
  await expect(nogoal.getByTestId(`roadmap-task-${free}`)).toBeVisible();
  await expect(nogoal.getByRole("heading", { name: /Задачи без цели/ })).toContainText(/\d+ задач/);
  const order = await container.locator("section[data-testid^='roadmap-']").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  expect(order.at(-1)).toBe("roadmap-nogoal");
  // Группа сворачивается и раскрывается, по умолчанию раскрыта
  const fold = g1.getByRole("button", { name: /^Свернуть: задачи цели РТ-1/ });
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await fold.click();
  await expect(g1.getByTestId(`roadmap-task-${own}`)).toBeHidden();
  await g1.getByRole("button", { name: /^Развернуть: задачи цели РТ-1/ }).click();
  await expect(g1.getByTestId(`roadmap-task-${own}`)).toBeVisible();
  await shot(page, "both-board", { contrast: true });

  if (!phone()) {
    // Карта сроков в группировке «Цели и задачи»: строка цели и под ней полосы её задач, задачи без цели в конце
    await page.getByRole("radio", { name: "Карта сроков" }).click();
    await expect(page).not.toHaveURL(/view=board/);
    await expect(page).toHaveURL(/group=both/);
    const tl = page.getByTestId("roadmap-timeline");
    const g1 = tl.getByTestId("timeline-group-e77-g1");
    await expect(g1.getByTestId("timeline-goalbar-e77-g1")).toBeVisible();
    await expect(g1.getByTestId(`timeline-bar-${own}`)).toBeVisible();
    await expect(tl.getByTestId("timeline-nogoal").getByTestId(`timeline-bar-${free}`)).toBeVisible();
    await g1.getByRole("button", { name: /^Свернуть: задачи цели РТ-1/ }).click();
    await expect(g1.getByTestId(`timeline-bar-${own}`)).toBeHidden();
    await g1.getByRole("button", { name: /^Развернуть: задачи цели РТ-1/ }).click();
    await shot(page, "both-timeline", { contrast: true });
  }

  // Человек в фильтре: выбор с поиском, адрес хранит и группировку, и человека
  const picker = page.getByRole("combobox", { name: "Чьи задачи" });
  await picker.fill("Фатьянов");
  await page.getByRole("option", { name: /^Фатьянов/ }).click();
  await expect(page).toHaveURL(/person=fatyanov/);
  await expect(page).toHaveURL(/group=both/);
  // Под РТ-1 только задача Фатьянова, цели РТ-2 (задача Ревы) нет
  const scope = phone() ? page.getByTestId("roadmap-list") : page.getByTestId("roadmap-timeline");
  await expect(scope.getByTestId(phone() ? `roadmap-task-${other}` : `timeline-bar-${other}`)).toBeVisible();
  await expect(scope.getByTestId(phone() ? `roadmap-task-${own}` : `timeline-bar-${own}`)).toHaveCount(0);
  await expect(scope.getByTestId(phone() ? "roadmap-group-e77-g2" : "timeline-group-e77-g2")).toHaveCount(0);

  // Перезагрузка: выбор остаётся
  await page.reload();
  await expect(page.getByRole("radiogroup", { name: "Группировка" }).getByRole("radio", { name: "Цели и задачи" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("combobox", { name: "Чьи задачи" })).toHaveValue(/Фатьянов/);

  // Вся команда снова, по целям; нажатие на цель открывает её на экране «Цели»
  await page.getByRole("combobox", { name: "Чьи задачи" }).click();
  await page.getByRole("option", { name: "Вся команда" }).click();
  await expect(page).not.toHaveURL(/person=/);
  await page.getByRole("radiogroup", { name: "Группировка" }).getByRole("radio", { name: "По целям" }).click();
  await expect(page).toHaveURL(/group=goals/);
  if (phone()) await page.getByTestId("roadmap-goal-e77-g1").getByRole("link").click();
  else await page.getByTestId("timeline-goal-link-e77-g1").click();
  await expect(page).toHaveURL(new RegExp(`/goals\\?q=${q}#goal-e77-g1$`));
  await expect(page.locator("#goal-e77-g1")).toBeVisible();

  // «Назад» возвращает roadmap по целям
  await page.goBack();
  await expect(page).toHaveURL(/\/roadmap\?.*group=goals/);
  await expect(page.getByRole("radiogroup", { name: "Группировка" }).getByRole("radio", { name: "По целям" })).toHaveAttribute("aria-checked", "true");
});

/** Тянуть мышью: нажать в точке x, сдвинуть на dx шагами, отпустить */
async function dragBy(page: Page, x: number, y: number, dx: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

test("«Цели и задачи» на карте сроков: свою задачу под целью тянут с причиной, чужую нельзя, строку цели не тянут", async ({ page }) => {
  test.skip(phone(), "Карта сроков только на широком экране");
  test.setTimeout(120_000);
  const { own, other } = await seed();
  const state = async (n: number) => (await sql(`SELECT "startOn"::text AS start, due::text AS due FROM tasks WHERE number = $1`, [n]))[0]!;
  const beforeOther = await state(other);
  const beforeOwn = await state(own);

  // Рева: своя задача под целью РТ-1 двигается, задача Фатьянова под той же целью нет
  await enter(page, "Рева Тарас");
  await page.goto("/roadmap?group=both");
  const tl = page.getByTestId("roadmap-timeline");
  const g1 = tl.getByTestId("timeline-group-e77-g1");
  const foreign = g1.getByTestId(`timeline-bar-${other}`);
  await expect(foreign).toBeVisible();
  await expect(foreign.locator("[data-handle]")).toHaveCount(0);
  let box = (await foreign.boundingBox())!;
  await dragBy(page, box.x + box.width / 2, box.y + box.height / 2, 80);
  await expect(page.getByRole("dialog", { name: /Перенести срок задачи/ })).toHaveCount(0);
  expect(await state(other)).toEqual(beforeOther);
  await foreign.click();
  await expect(page).toHaveURL(new RegExp(`task=${other}`));
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(new RegExp(`task=${other}`));

  // Строка цели: полоса без ручек, она ссылка на цель, а не полоса задачи
  const goalBar = g1.getByTestId("timeline-goalbar-e77-g1");
  await expect(goalBar.locator("[data-handle]")).toHaveCount(0);
  await expect(goalBar).toHaveAttribute("href", /\/goals\?q=.*#goal-e77-g1$/);
  const goalText = await goalBar.textContent();

  // Своя задача: правый край вправо, окно причины, срок переносится; самый поздний срок цели не меняется (у Фатьянова позже)
  const mine = g1.getByTestId(`timeline-bar-${own}`);
  await expect(mine.locator("[data-handle='end']")).toHaveCount(1);
  box = (await mine.boundingBox())!;
  await dragBy(page, box.x + box.width - 2, box.y + box.height / 2, 40);
  const dialog = page.getByRole("dialog", { name: `Перенести срок задачи ${own}` });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Причина переноса").fill("Ждём партнёра");
  await dialog.getByRole("button", { name: "Перенести срок" }).click();
  await expect(page.getByText(`Срок задачи ${own} перенесён`).first()).toBeVisible();
  await expect.poll(async () => (await state(own)).due > beforeOwn.due).toBe(true);
  // Задача осталась под своей целью
  await expect(g1.getByTestId(`timeline-bar-${own}`)).toBeVisible();

  // Своя задача за самый поздний срок цели: полоса цели вытягивается вслед
  await sql(`UPDATE tasks SET due = ${MSK} + 60 WHERE number = $1`, [own]);
  await page.reload();
  await expect(page.getByTestId("timeline-goalbar-e77-g1")).not.toHaveText(goalText ?? "");
});
