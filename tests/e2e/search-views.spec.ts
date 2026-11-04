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
  await page.getByRole("button", { name: "Добавить пункт" }).click();
  await page.getByLabel("Новый пункт").fill("Собрать цифры");
  await page.getByRole("button", { name: "Добавить пункт" }).click();
  await expect(page.getByText("Пункт добавлен").first()).toBeVisible();
  await page.getByLabel("Новый пункт").fill("Согласовать с СК");
  await page.getByRole("button", { name: "Добавить пункт" }).click();
  // Второй пункт сохранён: иначе ответ на его добавление перерисует список и снимет отметку (гонка на медленной машине)
  await expect(page.getByRole("checkbox", { name: "Согласовать с СК" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Чек-лист 0 из 2/ })).toBeVisible();
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

test("список задач рисует первые сто с «Показать ещё», а счётчики и выбор считают все отобранные (этап 74)", async ({ page, isMobile }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  const [reva] = await sql(`SELECT id FROM people WHERE slug = 'reva'`);
  const [dir] = await sql(`SELECT id FROM dictionary_items WHERE kind = 'DIRECTION' AND code = 'osago'`);
  // Сто двадцать открытых задач одним запросом, как в owner-as.spec.ts для длинного списка людей: предел на разметку
  // виден только на данных, которых больше предела
  await sql(
    `INSERT INTO tasks (id, number, title, outcome, "directionId", due, "whereUpdatedAt", "teamId", "ownerId", "updatedAt")
     SELECT 'e2e74-' || i, 9200 + i, 'Длинный список задача ' || lpad(i::text, 3, '0'), 'Результат', $1,
            (now() AT TIME ZONE 'Europe/Moscow')::date + 30, (now() AT TIME ZONE 'Europe/Moscow')::date, 'top', $2, now()
     FROM generate_series(1, 120) AS i`,
    [dir!.id, reva!.id],
  );
  await page.goto("/tasks?q=%D0%94%D0%BB%D0%B8%D0%BD%D0%BD%D1%8B%D0%B9%20%D1%81%D0%BF%D0%B8%D1%81%D0%BE%D0%BA&group=none");

  // Экран говорит, сколько отобрано всего, и сколько из них показано
  await expect(page.getByText("Отобрано 120 по фильтрам")).toBeVisible();
  await expect(page.getByText("Показано 100 из 120")).toBeVisible();
  const rows = page.getByRole("row").filter({ hasText: /Длинный список задача/ });
  const cards = page.getByRole("button").filter({ hasText: /Длинный список задача/ });
  const drawn = async () => (isMobile ? cards.count() : rows.count());
  expect(await drawn()).toBe(100);
  await shot(page, "tasks-limit");

  // «Показать ещё» дорисовывает остальные и сама пропадает
  const more = page.getByTestId("tasks-more");
  await expect(more).toContainText("Показать ещё 20");
  await more.click();
  await expect(more).toHaveCount(0);
  await expect.poll(drawn).toBe(120);

  // Предел только на разметку, а не на отбор: после перезагрузки экран снова говорит и сколько отобрано, и сколько
  // из них нарисовано, и первое число совпадает с тем, что в базе
  await page.reload();
  await expect(page.getByText("Показано 100 из 120")).toBeVisible();
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM tasks WHERE title LIKE 'Длинный список задача%'`);
  expect(n).toBe(120);
  // Отбор по ответственному через поле с поиском (этап 74): ищем по фамилии, а не листаем системный список
  const owner = page.getByRole("combobox", { name: "Ответственный" });
  await owner.fill("рева");
  await page.getByRole("option", { name: /^Рева Тарас/ }).click();
  await expect(page).toHaveURL(/owner=reva/);
  await expect(page.getByText("Отобрано 120 по фильтрам")).toBeVisible();
  await expect(page.getByText("Показано 100 из 120")).toBeVisible();
  // Печать поверх выбранного фильтр не сбрасывает: пустое значение поля приходит, пока человек ищет нового человека
  await owner.fill("мура");
  await expect(page).toHaveURL(/owner=reva/);
  await expect(page.getByText("Отобрано 120 по фильтрам")).toBeVisible();
  // Уход из поля без выбора оставляет прежний фильтр, а «Все ответственные» его снимает
  await owner.press("Escape");
  await expect(page).toHaveURL(/owner=reva/);
  await owner.fill("все ответственные");
  await page.getByRole("option", { name: /^Все ответственные/ }).click();
  await expect(page).not.toHaveURL(/owner=/);

  // Выбор галочками не теряется, когда предел подрастает: отмечаем задачу, дорисовываем остальные, отметка на месте.
  // Проверяем на обеих ширинах: на телефоне плашка выбора висит выше, и запас под неё другой
  const bar = page.getByRole("region", { name: "Выбранные задачи" });
  const first = isMobile
    ? page.getByRole("listitem").filter({ hasText: "Длинный список задача 001" }).getByRole("checkbox")
    : page.getByRole("row").filter({ hasText: "Длинный список задача 001" }).getByRole("checkbox");
  await first.check();
  await expect(bar).toContainText("Выбрано: 1");
  await page.getByTestId("tasks-more").click();
  await expect.poll(drawn).toBe(120);
  await expect(bar).toContainText("Выбрано: 1");

  // Группировка по умолчанию (по ответственному): шапка группы печатает полный размер группы, а не нарисованное,
  // и «Выбрать все» отмечает всю группу. Иначе человек просит «все задачи Ревы», получает сто и об этом не узнаёт
  await page.goto("/tasks?q=%D0%94%D0%BB%D0%B8%D0%BD%D0%BD%D1%8B%D0%B9%20%D1%81%D0%BF%D0%B8%D1%81%D0%BE%D0%BA");
  await expect(page.getByText("Показано 100 из 120")).toBeVisible();
  const group = isMobile ? page.getByRole("heading", { name: /Рева Тарас/ }) : page.getByRole("columnheader", { name: /Рева Тарас/ });
  await expect(group).toContainText("120");
  if (!isMobile) {
    await page.getByRole("checkbox", { name: "Выбрать все: Рева Тарас" }).check();
    await expect(bar).toContainText("Выбрано: 120");
    // И плашка не молчит о том, что отмечено не только нарисованное
    await expect(bar).toContainText("из них 20 не на экране");
  }
});
