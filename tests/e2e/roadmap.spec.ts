import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

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
  // Этап 77: выбор человека с поиском
  await page.getByRole("combobox", { name: "Чьи задачи" }).fill(String(owner!.fullName).split(" ")[0]!);
  await page.getByRole("option", { name: new RegExp(`^${owner!.fullName}`) }).click();
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

/** Сегодня по Москве в базе: даты тестов этапа 68 считаются по Москве, а не по часовому поясу сервера базы */
const MSK = "(now() AT TIME ZONE 'Europe/Moscow')::date";

/** Тянуть мышью: нажать в точке x, сдвинуть на dx шагами, отпустить */
async function dragBy(page: Page, x: number, y: number, dx: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

test("карта сроков: начало с клавиатуры, срок за край с причиной, сдвиг целиком одной правкой с отменой, нажатие открывает задачу", async ({ page }) => {
  test.skip(test.info().project.name === "phone", "Карта сроков только на широком экране");
  test.setTimeout(90_000);
  const [row] = await sql(`SELECT number FROM tasks WHERE "teamId" = 'top' AND status = 'IN_PROGRESS' AND "archivedAt" IS NULL AND "ownerId" IS NOT NULL ORDER BY number LIMIT 1`);
  const n = row!.number as number;
  await sql(`UPDATE tasks SET priority = 'CRITICAL', due = ${MSK} + 14, "startOn" = NULL WHERE number = $1`, [n]);
  const state = async () => (await sql(`SELECT "startOn"::text AS start, due::text AS due, (SELECT count(*)::int FROM task_transfers tt WHERE tt."taskId" = t.id) AS transfers FROM tasks t WHERE number = $1`, [n]))[0]!;

  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/roadmap");
  const bar = page.getByTestId(`timeline-bar-${n}`);
  await expect(bar).toBeVisible();
  await expect(page.getByTestId("roadmap-summary")).toContainText("На карте");
  // Подсказка про мышь и клавиатуру видна, а не только диктору
  await expect(page.getByTestId("timeline-hint")).toContainText("С клавиатуры: стрелки двигают полосу");
  await shot(page, "timeline");

  // Клавиатура: Alt+стрелка вправо три раза двигает начало, Enter сохраняет без причины
  await bar.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByText(`Начало задачи ${n}:`).first()).toBeVisible();
  const started = await state();
  expect(started.start).not.toBeNull();

  // Нажатие с дрожанием руки (3 px) открывает задачу и ничего не сохраняет
  let box = (await bar.boundingBox())!;
  await dragBy(page, box.x + box.width / 2, box.y + box.height / 2, 3);
  await expect(page).toHaveURL(new RegExp(`task=${n}`));
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(new RegExp(`task=${n}`));
  expect(await state()).toEqual(started);

  // Мышь: правый край на несколько дней вправо, окно с причиной, срок переносится, перенос записан
  box = (await bar.boundingBox())!;
  await dragBy(page, box.x + box.width - 2, box.y + box.height / 2, 60);
  const dialog = page.getByRole("dialog", { name: `Перенести срок задачи ${n}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Перенести срок" })).toBeDisabled();
  await dialog.getByLabel("Причина переноса").fill("Ждём данные партнёра");
  await dialog.getByRole("button", { name: "Перенести срок" }).click();
  await expect(page.getByText(`Срок задачи ${n} перенесён`).first()).toBeVisible();
  const [later] = await sql(`SELECT (due > ${MSK} + 14) AS later FROM tasks WHERE number = $1`, [n]);
  expect(later!.later).toBe(true);
  const moved = await state();
  expect(moved.transfers).toBe(started.transfers + 1);
  expect(moved.start).toBe(started.start);

  // Сдвиг целиком: одна правка moveTaskSpan, в журнале срок и начало, одна отмена возвращает оба поля
  const [{ mark }] = await sql(`SELECT coalesce(max(id), 0)::text AS mark FROM audit_log`);
  box = (await bar.boundingBox())!;
  await dragBy(page, box.x + box.width / 2, box.y + box.height / 2, 80);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Начало");
  await dialog.getByLabel("Причина переноса").fill("Партнёр сдвинул запуск");
  await dialog.getByRole("button", { name: "Перенести срок" }).click();
  // Всплывающее сообщение, а не скрытая строка для диктора: сообщение приходит после ответа сервера
  await expect(page.getByRole("status").filter({ hasText: new RegExp(`Задача ${n}: с .+ по .+`) })).toBeVisible();
  const shifted = await state();
  expect(shifted.start! > moved.start!).toBe(true);
  expect(shifted.due > moved.due).toBe(true);
  expect(shifted.transfers).toBe(moved.transfers + 1);
  const fields = await sql(`SELECT field FROM audit_log WHERE id > $1::bigint AND entity = 'task' AND "entityId" = $2 ORDER BY id`, [mark, String(n)]);
  expect(fields.map((f) => f.field)).toEqual(["Срок", "Начало"]);
  await page.getByRole("button", { name: "Отменить" }).first().click();
  await expect.poll(async () => await state()).toEqual(moved);

  // Нажатие без перетаскивания открывает задачу
  await bar.click();
  await expect(page).toHaveURL(new RegExp(`task=${n}`));
});

test("карта сроков: без прав на срок и в «Смотреть как» полосы не двигаются, нажатие открывает задачу", async ({ page }) => {
  test.skip(test.info().project.name === "phone", "Карта сроков только на широком экране");
  test.setTimeout(90_000);
  // Задача Фатьянова: у Ревы нет прав на её срок; своя задача Ревы: права есть, но в «Смотреть как» полоса не двигается
  const [other] = await sql(`SELECT t.number FROM tasks t JOIN people p ON p.id = t."ownerId" WHERE p.slug = 'fatyanov' AND t.status = 'IN_PROGRESS' AND t."archivedAt" IS NULL AND t."teamId" = 'top' ORDER BY t.number LIMIT 1`);
  const [own] = await sql(`SELECT t.number FROM tasks t JOIN people p ON p.id = t."ownerId" WHERE p.slug = 'reva' AND t.status = 'IN_PROGRESS' AND t."archivedAt" IS NULL AND t."teamId" = 'top' ORDER BY t.number LIMIT 1`);
  const a = other!.number as number;
  const b = own!.number as number;
  await sql(`UPDATE tasks SET due = ${MSK} + 20, "startOn" = ${MSK} + 5 WHERE number = ANY($1)`, [[a, b]]);
  const snapshot = async () => sql(`SELECT number, "startOn"::text AS start, due::text AS due FROM tasks WHERE number = ANY($1) ORDER BY number`, [[a, b]]);
  const before = await snapshot();

  const tryDrag = async (p: Page, number: number) => {
    const bar = p.getByTestId(`timeline-bar-${number}`);
    await expect(bar).toBeVisible();
    // Без прав нет подсказки про клавиатуру у полосы и нет ручек краёв
    await expect(bar).not.toHaveAttribute("aria-describedby", "timeline-keys");
    await expect(bar.locator("[data-handle]")).toHaveCount(0);
    const box = (await bar.boundingBox())!;
    await dragBy(p, box.x + box.width / 2, box.y + box.height / 2, 80);
    await expect(p.getByRole("dialog", { name: /Перенести срок задачи/ })).toHaveCount(0);
    // Полоса осталась на месте: предпросмотра сдвига нет
    expect((await bar.boundingBox())!.x).toBeCloseTo(box.x, 0);
    // Нажатие открывает задачу
    await bar.click();
    await expect(p).toHaveURL(new RegExp(`task=${number}`));
    await p.keyboard.press("Escape");
  };

  await enter(page, "Рева Тарас");
  await page.goto("/roadmap");
  await tryDrag(page, a);
  expect(await snapshot()).toEqual(before);

  // «Смотреть как» Реву: владелец при личном входе в режиме управления
  const owner = await page.context().browser()!.newContext({ viewport: page.viewportSize()! });
  const op = await owner.newPage();
  await enterByLink(op, "muradyan");
  await enterManagement(op, "owner");
  await op.getByRole("button", { name: /^Профиль:/ }).filter({ visible: true }).first().click();
  await op.getByRole("menuitem", { name: "Смотреть как…" }).click();
  const dialog = op.getByRole("dialog", { name: "Смотреть как" });
  await dialog.getByLabel("Поиск по ФИО, должности или подразделению").fill("рева");
  await dialog.getByRole("button", { name: /Рева Тарас/ }).click();
  await expect(op.getByTestId("view-as-banner")).toBeVisible();
  await op.goto("/roadmap");
  await tryDrag(op, b);
  expect(await snapshot()).toEqual(before);
  await owner.close();
});

test("карта сроков: обрезанный край встаёт на дату под указателем, обрубки за окном, короткая полоса за середину, Enter во время сохранения", async ({ page }) => {
  test.skip(test.info().project.name === "phone", "Карта сроков только на широком экране");
  test.setTimeout(120_000);
  const open = await sql(`SELECT number FROM tasks WHERE "teamId" = 'top' AND status = 'IN_PROGRESS' AND "archivedAt" IS NULL AND "ownerId" IS NOT NULL ORDER BY number LIMIT 4`);
  const [cut, after, before, short] = open.map((r) => r.number as number);
  const month = `date_trunc('month', ${MSK}::timestamp)`;
  // Началась до окна карты, срок в окне; целиком после окна; срок до окна (просрочена); короткая полоса в два дня
  await sql(`UPDATE tasks SET "startOn" = (${month} - interval '20 days')::date, due = ${MSK} + 30 WHERE number = $1`, [cut]);
  await sql(`UPDATE tasks SET "startOn" = ${MSK} + 150, due = ${MSK} + 160 WHERE number = $1`, [after]);
  await sql(`UPDATE tasks SET "startOn" = NULL, due = (${month} - interval '10 days')::date WHERE number = $1`, [before]);
  await sql(`UPDATE tasks SET "startOn" = ${MSK} + 10, due = ${MSK} + 11 WHERE number = $1`, [short]);
  const state = async (n: number) => (await sql(`SELECT "startOn"::text AS start, due::text AS due FROM tasks WHERE number = $1`, [n]))[0]!;

  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/roadmap");
  const bar = (n: number) => page.getByTestId(`timeline-bar-${n}`);
  await expect(bar(cut)).toBeVisible();

  // Обрубки за окном: у правого и левого края трека, с датой, ничего не обрезано, ручек нет
  for (const [n, side, text] of [
    [after, "after", "срок"],
    [before, "before", "просрочено с"],
  ] as const) {
    const b = bar(n);
    await expect(b).toHaveAttribute("data-outside", side);
    await expect(b).toContainText(text);
    await expect(b.locator("[data-handle]")).toHaveCount(0);
    const box = (await b.boundingBox())!;
    const track = (await b.locator("xpath=..").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(track.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(track.x + track.width + 1);
    expect(await b.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }

  // Обрезанный левый край: ручка есть; тянем её на 10-е число второго месяца карты, начало встаёт на эту дату
  await expect(bar(cut)).toHaveAttribute("data-cut", "start");
  // Мышь работает в пределах экрана: строка задачи прокручивается в вид до замеров
  await bar(cut).scrollIntoViewIfNeeded();
  const handle = bar(cut).locator("[data-handle='start']");
  const h = (await handle.boundingBox())!;
  const second = (await page.getByTestId("roadmap-timeline").locator("div.sticky span").nth(1).boundingBox())!;
  const [{ want, days }] = await sql(`SELECT (${month} + interval '1 month' + interval '9 days')::date::text AS want, extract(day from ${month} + interval '2 month' - interval '1 day')::int AS days`);
  await dragBy(page, h.x + h.width * 0.75, h.y + h.height / 2, second.x + second.width * (9.5 / (days as number)) - (h.x + h.width * 0.75));
  await expect(page.getByText(`Начало задачи ${cut}:`).first()).toBeVisible();
  await expect.poll(async () => (await state(cut)).start).toBe(want);
  await expect(bar(cut)).not.toHaveAttribute("data-cut", "start");

  // Короткая полоса: ручки снаружи, за середину сдвигается вся (окно причины про срок и начало), «Отмена» ничего не меняет
  const shortBefore = await state(short);
  await bar(short).scrollIntoViewIfNeeded();
  const sb = (await bar(short).boundingBox())!;
  await dragBy(page, sb.x + sb.width / 2, sb.y + sb.height / 2, 40);
  const dialog = page.getByRole("dialog", { name: `Перенести срок задачи ${short}` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Начало");
  await dialog.getByRole("button", { name: "Отмена" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await state(short)).toEqual(shortBefore);

  // Enter во время сохранения: ответ сервера задержан, три Enter подряд отправляют одну правку
  let posts = 0;
  await page.route(/\/roadmap(\?.*)?$/, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
      posts += 1;
      await new Promise((r) => setTimeout(r, 1500));
    }
    await route.continue();
  });
  await bar(short).focus();
  await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.getByText(`Начало задачи ${short}:`).first()).toBeVisible();
  await page.unroute(/\/roadmap(\?.*)?$/);
  expect(posts).toBe(1);
  expect((await state(short)).start).not.toBe(shortBefore.start);
});
