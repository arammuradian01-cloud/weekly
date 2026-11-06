import { expect, test } from "@playwright/test";
import { enter, enterByLink, resetDatabase, sql } from "./helpers";
import { pickTeam } from "./team-picker";

test.beforeEach(async () => {
  await resetDatabase();
  await sql(`DELETE FROM team_weekly_templates WHERE "teamId" = 'top'`);
});
test.afterEach(async () => { await sql(`DELETE FROM team_weekly_templates WHERE "teamId" = 'top'`); });

test("возврат к прежней главной фразе во время запроса сохраняется без ухода из поля", async ({ page }) => {
  await enter(page, "Афанасьев Павел");
  await page.goto("/weekly/submit");
  const field = page.getByLabel("Главное одной фразой");
  const original = "Исходная главная фраза A";
  const temporary = "Временная главная фраза B";
  await field.fill(original);
  await expect(page.getByText(/Черновик сохранён в \d{2}:\d{2}/)).toBeVisible({ timeout: 8000 });
  let intercepted = false;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/weekly/submit", async (route) => {
    const request = route.request();
    if (!intercepted && request.method() === "POST" && request.headers()["next-action"] && request.postData()?.includes(temporary)) {
      intercepted = true;
      await pending;
    }
    await route.continue();
  });
  try {
    await field.fill(temporary);
    await expect.poll(() => intercepted, { timeout: 8000 }).toBe(true);
    await field.fill(original);
    const response = page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().postData()?.includes(temporary));
    release();
    await response;
    // Начинаем проверку после ответа B, иначе прочитали бы прежнее A до первого запроса.
    await expect.poll(async () => (await sql(`SELECT r.headline FROM weekly_reports r JOIN people p ON p.id = r."authorId" WHERE p.slug = 'afanasyev' ORDER BY r."updatedAt" DESC LIMIT 1`))[0]?.headline).toBe(original);
    await expect(field).toBeFocused();
    await page.reload();
    await expect(field).toHaveValue(original);
  } finally { release(); }
});

test("сдача ждёт последнюю главную фразу после задержанного автосохранения", async ({ page }) => {
  await enter(page, "Афанасьев Павел");
  await page.goto("/weekly/submit");
  await page.getByRole("button", { name: "Добавить запись: Продукты", exact: true }).click();
  await page.getByLabel("Что произошло").fill("Запись для проверки главной фразы");
  await page.getByRole("button", { name: "Сохранить запись", exact: true }).click();
  await expect(page.getByLabel("Что произошло")).toHaveCount(0);
  let intercepted = false;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/weekly/submit", async (route) => {
    const request = route.request();
    if (!intercepted && request.method() === "POST" && request.headers()["next-action"] && request.postData()?.includes("Первый вариант главной фразы")) {
      intercepted = true;
      await pending;
    }
    await route.continue();
  });
  try {
    await page.getByLabel("Главное одной фразой").fill("Первый вариант главной фразы");
    await expect.poll(() => intercepted, { timeout: 8000 }).toBe(true);
    await page.getByLabel("Главное одной фразой").fill("Последний вариант перед сдачей");
    await page.getByRole("button", { name: "Сдать weekly", exact: true }).click();
    await expect(page.getByLabel("Главное одной фразой")).not.toBeEditable();
    release();
    await expect(page.getByText(/Weekly сдан|Сдан с опозданием/).first()).toBeVisible();
    const rows = await sql(`SELECT r.headline, r.state FROM weekly_reports r JOIN weekly_entries e ON e."weekId" = r."weekId" AND e."authorId" = r."authorId" WHERE e.what = 'Запись для проверки главной фразы'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.headline).toBe("Последний вариант перед сдачей");
    expect(["SUBMITTED", "LATE"]).toContain(rows[0]!.state);
  } finally { release(); }
});

test("старые записи сохраняют классификацию; смена продукта при медленном ответе не теряет новый текст", async ({ page }) => {
  test.setTimeout(60000);
  await enter(page, "Афанасьев Павел");
  await page.goto("/weekly/submit");
  const titles = ["Историческая запись без раздела", "Историческая запись удалённого блока"];
  for (const [index, title] of titles.entries()) {
    await page.getByRole("button", { name: "Добавить запись: Продукты", exact: true }).click();
    await page.getByLabel("Продукт", { exact: true }).selectOption("osago");
    await page.getByLabel("Что произошло").fill(title);
    await page.getByRole("button", { name: "Сохранить запись", exact: true }).click();
    await expect(page.getByLabel("Что произошло")).toHaveCount(0);
    await sql(`UPDATE weekly_entries SET section = $1, "blockId" = (SELECT id FROM dictionary_items WHERE kind = 'WEEKLY_BLOCK' AND code = 'key-changes'), "typeId" = (SELECT id FROM dictionary_items WHERE kind = 'ENTRY_TYPE' AND code = 'event') WHERE what = $2`, [index ? "c:past0001" : null, title]);
  }
  await page.reload();
  await page.getByRole("button", { name: `Изменить запись «${titles[0]}»` }).click();
  let intercepted = false;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/weekly/submit", async (route) => {
    const request = route.request();
    if (!intercepted && request.method() === "POST" && request.headers()["next-action"] && request.postData()?.includes(titles[0]!)) {
      intercepted = true;
      await pending;
    }
    await route.continue();
  });
  try {
    await page.getByLabel("Продукт", { exact: true }).selectOption("partners");
    await expect.poll(() => intercepted, { timeout: 8000 }).toBe(true);
    await page.getByLabel("Цифра или факт").fill("Поздняя правка после смены продукта");
    release();
    await expect(page.getByText("Черновик записи сохранён")).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel("Цифра или факт")).toHaveValue("Поздняя правка после смены продукта");
    await page.getByRole("button", { name: "Сохранить запись", exact: true }).click();
    await expect(page.getByLabel("Что произошло")).toHaveCount(0);
  } finally { release(); }
  await page.getByRole("button", { name: `Изменить запись «${titles[1]}»` }).click();
  await page.getByLabel("Что произошло").fill(`${titles[1]} уточнено`);
  await page.getByRole("button", { name: "Сохранить запись", exact: true }).click();
  await expect(page.getByLabel("Что произошло")).toHaveCount(0);
  const rows = await sql(`SELECT e.what, e.section, e.fact, d.code AS direction, b.code AS block, t.code AS type FROM weekly_entries e JOIN dictionary_items d ON d.id = e."directionId" JOIN dictionary_items b ON b.id = e."blockId" JOIN dictionary_items t ON t.id = e."typeId" WHERE e.what = ANY($1) ORDER BY e.what`, [[titles[0], `${titles[1]} уточнено`]]);
  expect(rows).toHaveLength(2);
  expect(rows.find((r) => r.what === titles[0])).toMatchObject({ section: null, block: "key-changes", type: "event", direction: "partners", fact: "Поздняя правка после смены продукта" });
  expect(rows.find((r) => r.what !== titles[0])).toMatchObject({ section: "c:past0001", block: "key-changes", type: "event" });
});

test("участник пишет в старом шаблоне только с цифрами при скрытых значениях классификации", async ({ page }) => {
  await sql(`INSERT INTO team_weekly_templates ("teamId", blocks, "updatedById", "updatedAt") VALUES ('top', '[{"key":"wow","title":"Неделя к неделе"},{"key":"month","title":"Месяц"}]'::jsonb, (SELECT id FROM people WHERE slug = 'muradyan'), now()) ON CONFLICT ("teamId") DO UPDATE SET blocks = excluded.blocks`);
  await sql("UPDATE dictionary_items SET active = false WHERE (kind = 'WEEKLY_BLOCK' AND code = 'product') OR (kind = 'ENTRY_TYPE' AND code = 'result')");
  await enter(page, "Афанасьев Павел");
  await page.goto("/weekly/submit");
  await page.getByRole("button", { name: "Добавить запись: Продукты", exact: true }).click();
  await page.getByLabel("Что произошло").fill("Тест совместимости старого шаблона");
  await expect(page.getByText("Черновик записи сохранён")).toBeVisible({ timeout: 8000 });
  await page.getByLabel("Цифра или факт").fill("Второе сохранение после серверного выбора");
  await page.getByRole("button", { name: "Сохранить запись", exact: true }).click();
  await expect(page.getByLabel("Что произошло")).toHaveCount(0);
  const rows = await sql(`SELECT e.section, e.fact, b.code AS block, b.active AS "blockActive", t.code AS type, t.active AS "typeActive" FROM weekly_entries e JOIN dictionary_items b ON b.id = e."blockId" JOIN dictionary_items t ON t.id = e."typeId" WHERE e.what = 'Тест совместимости старого шаблона'`);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ section: "products", fact: "Второе сохранение после серверного выбора", blockActive: true, typeActive: true });
  expect(rows[0]!.block).not.toBe("product");
  expect(rows[0]!.type).not.toBe("result");
  expect((await sql(`SELECT jsonb_array_length(blocks) AS n FROM team_weekly_templates WHERE "teamId" = 'top'`))[0]!.n).toBe(2);
});

test("сдача по блокам: одна форма, явное сохранение, подробности и история без потери полей", async ({ page }) => {
  await enter(page, "Афанасьев Павел");
  await page.goto("/weekly/submit");
  const blocks = page.getByTestId("weekly-entry-blocks");
  await expect(blocks.locator(":scope > section")).toHaveCount(8);
  await expect(page.getByRole("navigation", { name: "Шаги сдачи" })).toHaveCount(0);
  await page.getByLabel("Главное одной фразой").fill("Тест: согласовали следующий запуск");
  await page.getByRole("button", { name: "Добавить запись: Риски", exact: true }).click();
  await expect(page.getByRole("button", { name: "Добавить запись: Продукты", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Сдать weekly", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Тип", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Блок отчёта")).toHaveCount(0);
  await expect(page.getByLabel("Цифра или факт")).toBeVisible();
  await expect(page.getByLabel("Что делаем дальше")).toBeVisible();
  await expect(page.getByLabel("Влияние на бизнес")).toBeHidden();
  await page.getByLabel("Что произошло").fill("Тест: задерживается подготовка запуска");
  await page.getByLabel("Цифра или факт").fill("Осталось два согласования");
  await page.getByLabel("Что делаем дальше").fill("Завершить согласования");
  await page.getByLabel("Что произошло").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/${test.info().project.name}-weekly-editor.png` });
  await page.getByText("Добавить детали", { exact: true }).click();
  await page.getByLabel("Подробнее", { exact: true }).fill("Тестовое подробное описание без сокращения");
  await page.getByLabel("Влияние на бизнес").fill("Срок запуска сдвигается");
  await page.getByLabel("Нужна помощь", { exact: true }).check();
  await page.getByLabel("Какая помощь и от кого").fill("Проверить готовность материалов");
  await page.getByLabel("Ссылка на артефакт", { exact: true }).fill("https://example.com/weekly-test");
  await page.getByRole("button", { name: "Сохранить запись", exact: true }).click();
  await expect(page.getByLabel("Что произошло")).toHaveCount(0);
  const row = page.getByTestId("weekly-block-risks");
  await expect(row.getByRole("heading", { name: "Тест: задерживается подготовка запуска", exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Изменить запись «Тест: задерживается подготовка запуска»" }).click();
  await expect(page.getByLabel("Подробнее", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Подробнее", { exact: true })).toHaveValue("Тестовое подробное описание без сокращения");
  await expect(page.getByLabel("Влияние на бизнес")).toHaveValue("Срок запуска сдвигается");
  await expect(page.getByLabel("Какая помощь и от кого")).toHaveValue("Проверить готовность материалов");
  await expect(page.getByLabel("Ссылка на артефакт", { exact: true })).toHaveValue("https://example.com/weekly-test");
  // Новые правки после автосохранения нельзя потерять переходом в соседнюю форму или сдачей.
  await page.getByLabel("Что делаем дальше").fill("Завершить согласования завтра");
  await expect(page.getByRole("button", { name: "Сдать weekly", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Сохранить запись", exact: true }).click();
  await expect(page.getByLabel("Что произошло")).toHaveCount(0);
  if (test.info().project.name === "phone") {
    const toast = page.locator(".sv-toast");
    await expect(toast).toBeVisible();
    const toastBox = await toast.boundingBox();
    const barBox = await page.getByTestId("weekly-submit-bar").boundingBox();
    expect(toastBox).not.toBeNull();
    expect(barBox).not.toBeNull();
    expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(barBox!.y);
  }
  await page.reload();
  await expect(row.getByText("Завершить согласования завтра", { exact: false })).toBeVisible();
  const records = await sql(`SELECT e.section, b.code AS block, t.code AS type, e.next, e.details, e.help FROM weekly_entries e JOIN dictionary_items b ON b.id = e."blockId" JOIN dictionary_items t ON t.id = e."typeId" WHERE e.what = $1`, ["Тест: задерживается подготовка запуска"]);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ section: "risks", block: "risks", type: "risk", next: "Завершить согласования завтра", details: "Тестовое подробное описание без сокращения", help: "Проверить готовность материалов" });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: `test-results/${test.info().project.name}-weekly-composer.png`, fullPage: true });
  await page.screenshot({ path: `test-results/${test.info().project.name}-weekly-composer-viewport.png` });
  await page.getByRole("button", { name: "Сдать weekly", exact: true }).click();
  await expect(page.getByText(/Weekly сдан|Сдан с опозданием/).first()).toBeVisible();
});

test("правки во время автосохранения доходят до сервера без дубля записи", async ({ page }) => {
  await enter(page, "Афанасьев Павел");
  await page.goto("/weekly/submit");
  await page.getByRole("button", { name: "Добавить запись: Продукты", exact: true }).click();
  const title = "Тест: правки при медленном сохранении";
  let intercepted = false;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/weekly/submit", async (route) => {
    const request = route.request();
    if (!intercepted && request.method() === "POST" && request.headers()["next-action"] && request.postData()?.includes(title)) {
      intercepted = true;
      await pending;
    }
    await route.continue();
  });
  try {
    await page.getByLabel("Что произошло").fill(title);
    await expect.poll(() => intercepted, { timeout: 8000 }).toBe(true);
    await page.getByLabel("Цифра или факт").fill("Правка после начала запроса");
    release();
    await expect(page.getByText("Черновик записи сохранён")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Сохранить запись", exact: true }).click();
    await expect(page.getByLabel("Что произошло")).toHaveCount(0);
    expect(await sql("SELECT fact FROM weekly_entries WHERE what = $1", [title])).toEqual([{ fact: "Правка после начала запроса" }]);
  } finally { release(); }
});

test("руководитель настраивает свою команду на сдаче; свой блок совпадает у автора и в ленте", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await sql(`INSERT INTO teams (id, name, kind, "leaderId", "specialistsWeekly", "updatedAt") VALUES ('e2e-composer', 'Тестовая команда редактора', 'CUSTOM', (SELECT id FROM people WHERE slug = 'reva'), true, now())`);
  await sql(`INSERT INTO team_members ("teamId", "personId") SELECT 'e2e-composer', id FROM people WHERE slug = 'cheychenets'`);
  await enterByLink(page, "reva");
  await page.goto("/weekly/submit");
  await page.getByText("Настроить блоки команды «Тестовая команда редактора»", { exact: true }).click();
  const template = page.getByTestId("team-template");
  await expect(template.getByTestId("team-template-block")).toHaveCount(8);
  await template.getByLabel("Свой блок").fill("Эксперименты команды");
  await template.getByRole("button", { name: "Добавить свой", exact: true }).click();
  await template.getByRole("button", { name: "Сохранить блоки", exact: true }).click();
  await expect(page.getByText("Блоки weekly команды сохранены").first()).toBeVisible();

  const context = await browser.newContext({ viewport: page.viewportSize()!, isMobile: test.info().project.name === "phone" });
  try {
    const member = await context.newPage();
    await enterByLink(member, "cheychenets");
    await member.goto("/weekly/submit");
    await member.getByRole("button", { name: "Добавить запись: Эксперименты команды", exact: true }).click();
    await member.getByLabel("Что произошло").fill("Тест: завершили эксперимент команды");
    await member.getByRole("button", { name: "Сохранить запись", exact: true }).click();
    await member.goto("/weekly");
    await pickTeam(member, test.info().project.name === "phone", "e2e-composer");
    await member.getByRole("radio", { name: "По блокам", exact: true }).click();
    await expect(member.getByRole("heading", { name: /^Эксперименты команды/ })).toBeVisible();
    await expect(member.getByRole("heading", { name: "Тест: завершили эксперимент команды", exact: true })).toBeVisible();
  } finally { await context.close(); }
});
