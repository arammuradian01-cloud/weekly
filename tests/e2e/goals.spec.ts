import { expect, test, type Browser, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 17: сквозные цели. Владелец заводит цель департамента, руководитель сектора заводит цель ниже,
// привязывает к ней задачу из карточки и видит прогресс в дереве целей. Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

const STRUCTURE = [
  ["ФИО", "Должность", "Управление", "Отдел", "Сектор", "Руководитель", "Руководит"],
  ["Рева Тарас Игоревич", "CPO", "Управление развития продуктов", "", "", "Мурадян Арам", "да"],
  ["Антонов Дмитрий", "PO OSAGO", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "Рева Тарас", "да"],
  ["Чемоданова Алиса", "Product Designer", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "", ""],
]
  .map((r) => r.join("\t"))
  .join("\n");

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
  const dir = mkdtempSync(join(tmpdir(), "structure-"));
  const file = join(dir, "structure.tsv");
  writeFileSync(file, STRUCTURE);
  execSync(`npx tsx scripts/load-structure.ts ${file} --yes`, { env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL }, stdio: "ignore" });
});

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-g-${name}.png`, fullPage: true });
}

async function person(browser: Browser, page: Page, fullName: string) {
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: test.info().project.name === "phone" });
  const p = await ctx.newPage();
  const [row] = await sql('SELECT slug FROM people WHERE "fullName" LIKE $1', [`${fullName}%`]);
  await enterByLink(p, row!.slug as string);
  return p;
}

test("цель департамента, цель сектора ниже и задача на неё", async ({ page, browser }) => {
  // Владелец в режиме управления заводит цель департамента
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/goals");
  await page.getByRole("button", { name: "Новая цель" }).click();
  let modal = page.getByRole("dialog", { name: /Новая цель/ });
  await modal.getByLabel("Команда").selectOption({ label: "Команда страхования и инвестиций" });
  await modal.getByLabel("Цель", { exact: true }).fill("Маржа департамента 150 млн");
  await modal.getByLabel("Номер").fill("D1");
  await modal.getByLabel("База").fill("120");
  await modal.getByLabel("Целевое значение").fill("150");
  await modal.getByRole("button", { name: "Завести цель" }).click();
  await expect(page.getByText("Цель заведена").first()).toBeVisible();
  await page.getByRole("radiogroup", { name: "Вид" }).getByRole("radio", { name: "Таблица" }).click();
  await expect(page.getByRole("main").getByText("Маржа департамента 150 млн")).toBeVisible();

  // Руководитель сектора видит цель департамента и заводит цель ниже
  const antonov = await person(browser, page, "Антонов");
  await antonov.goto("/goals");
  // Этап 68: по умолчанию карточки, сценарий работает с таблицей
  await antonov.getByRole("radiogroup", { name: "Вид" }).getByRole("radio", { name: "Таблица" }).click();
  await expect(antonov.getByRole("main").getByText("Маржа департамента 150 млн")).toBeVisible();
  await antonov.getByRole("button", { name: "Развернуть: Маржа департамента 150 млн" }).click();
  await antonov.getByRole("button", { name: "Цель ниже" }).click();
  modal = antonov.getByRole("dialog", { name: /Новая цель/ });
  await expect(modal.getByLabel("Команда")).toHaveValue((await sql("SELECT id FROM teams WHERE name = 'Сектор автострахования'"))[0]!.id as string);
  await modal.getByLabel("Цель", { exact: true }).fill("Новая форма расчёта на всём трафике");
  await modal.getByRole("button", { name: "Завести цель" }).click();
  await expect(antonov.getByText("Цель заведена").first()).toBeVisible();

  // Задача сектора работает на цель: выбор в карточке
  await antonov.goto("/tasks");
  await antonov.keyboard.press("n");
  const dialog = antonov.getByRole("dialog", { name: "Новая задача" });
  await dialog.getByLabel("Задача").fill("Выкатить форму на весь трафик");
  await dialog.getByLabel("Что нужно сделать").fill("Форма на 100% трафика");
  // Этап 55: цель подтянулась по тексту задачи, её можно сменить или убрать
  const goalBox = dialog.getByRole("combobox", { name: "Цель" });
  await expect(goalBox).toHaveValue("Новая форма расчёта на всём трафике");
  await expect(dialog.getByText("Подобрана по тексту задачи")).toBeVisible();
  // Escape в открытом списке целей закрывает список, а не форму с набранным текстом
  await goalBox.click();
  await expect(dialog.getByRole("listbox", { name: "Цель" })).toBeVisible();
  await antonov.keyboard.press("Escape");
  await expect(dialog.getByRole("listbox", { name: "Цель" })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Задача")).toHaveValue("Выкатить форму на весь трафик");
  await dialog.getByLabel("Ответственный").selectOption({ label: "Чемоданова Алиса" });
  await expect(goalBox).toHaveValue("Новая форма расчёта на всём трафике");
  await shot(antonov, "new-task-goal");
  await dialog.getByRole("button", { name: "Поставить задачу" }).click();
  await expect(antonov.getByText(/Задача \d+ создана/).first()).toBeVisible();
  const [goal] = await sql("SELECT id FROM goals WHERE title = 'Новая форма расчёта на всём трафике'");
  const [task] = await sql(`SELECT number, "goalId" FROM tasks WHERE title = 'Выкатить форму на весь трафик'`);
  expect(task!.goalId).toBe(goal!.id);

  // В карточке цель меняют поиском: отвязали и выбрали снова, подходящая по тексту вверху списка
  await antonov.goto(`/tasks/${task!.number}`);
  await antonov.getByRole("button", { name: "Сменить цель" }).click();
  const goalList = antonov.getByRole("listbox", { name: "Цель команды, команды выше или личная цель" });
  await expect(goalList.getByRole("option").first()).toContainText("Новая форма расчёта на всём трафике");
  await expect(goalList.getByRole("option").first()).toContainText("по тексту");
  await antonov.getByRole("button", { name: "Отвязать от цели" }).click();
  await expect(antonov.getByText("Задача отвязана от цели").first()).toBeVisible();
  await antonov.getByRole("button", { name: "Выбрать цель" }).click();
  await antonov.getByRole("combobox", { name: "Цель команды, команды выше или личная цель" }).fill("форма расч");
  await goalList.getByRole("option", { name: /Новая форма расчёта на всём трафике/ }).click();
  await expect(antonov.getByText(/Задача работает на цель/).first()).toBeVisible();

  // Дерево целей: прогресс у цели сектора и у цели департамента
  await antonov.goto("/goals");
  // Этап 68: по умолчанию карточки, сценарий работает с таблицей
  await antonov.getByRole("radiogroup", { name: "Вид" }).getByRole("radio", { name: "Таблица" }).click();
  await expect(antonov.getByText("закрыто 0 из 1").first()).toBeVisible();
  await antonov.getByRole("button", { name: "Развернуть: Новая форма расчёта на всём трафике" }).click();
  await expect(antonov.getByRole("main").getByText("Выкатить форму на весь трафик")).toBeVisible();
  await shot(antonov, "tree");

  // Этап 65: вкладка «Связать задачи с целями». Цель сектора с задачей, цель департамента выше; задача в «Моих задачах»
  await antonov.getByTestId("goals-tab-link").click();
  await expect(antonov).toHaveURL(/\/goals\?mode=link/);
  const card = antonov.getByTestId(`link-goal-${goal!.id}`);
  // Цифры цели тем же правилом и той же подписью, что на вкладке «Цели квартала»
  await expect(card).toContainText("закрыто 0 из 1");
  await card.getByRole("button", { name: /^Задачи 1, цель «Новая форма расчёта/ }).click();
  await expect(card.getByTestId(`link-goal-task-${task!.number}`)).toContainText("Выкатить форму на весь трафик");
  await expect(antonov.getByRole("heading", { name: /Цели выше/ }).first()).toBeVisible();
  await antonov.getByRole("radiogroup", { name: "Показать" }).getByRole("radio", { name: /Все/ }).click();
  await expect(antonov.getByTestId(`link-task-${task!.number}`)).toContainText("Новая форма расчёта на всём трафике");
  await shot(antonov, "link");
  await antonov.close();
});

test("факт и целевое значение в таблице целей: прогресс, история, фильтры, группы и дерево", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/goals");
  await page.getByRole("button", { name: "Новая цель" }).click();
  const modal = page.getByRole("dialog", { name: /Новая цель/ });
  await modal.getByLabel("Команда").selectOption({ label: "Команда страхования и инвестиций" });
  await modal.getByLabel("Цель", { exact: true }).fill("Маржа департамента 150 млн");
  await modal.getByLabel("Номер").fill("D1");
  await modal.getByLabel("Метрика").fill("Промо-маржа за квартал, млн");
  await modal.getByLabel("База").fill("120");
  await modal.getByLabel("Целевое значение").fill("150");
  await modal.getByRole("button", { name: "Завести цель" }).click();
  await expect(page.getByText("Цель заведена").first()).toBeVisible();
  await page.getByRole("radiogroup", { name: "Вид" }).getByRole("radio", { name: "Таблица" }).click();

  // Числовая цель без факта: в счётчике «Без свежего факта» и в строке «не вписан»
  const row = page.getByTestId("goal-row-D1");
  await expect(row).toContainText("не вписан");
  // Этап 46: цифры строкой, ноль не показывается
  await expect(page.getByTestId("goals-quarter-bar").getByRole("button", { name: /Без свежего факта\s*1/ })).toBeVisible();
  await shot(page, "table-empty-fact");

  // Факт в строке: прогресс виден до сохранения
  await page.getByTestId("goal-fact-D1").click();
  const editor = page.getByTestId("goal-fact-editor");
  await editor.getByLabel("Факт", { exact: true }).fill("141");
  await editor.getByLabel("Комментарий к факту").fill("По LRF за сентябрь");
  await expect(editor).toContainText("70%");
  await shot(page, "fact-editor");
  await editor.getByTestId("goal-fact-save").click();
  await expect(page.getByText("Факт вписан").first()).toBeVisible();
  await expect(row).toContainText("141");
  await expect(row).toContainText("70%");
  await expect(page.getByTestId("goals-quarter-bar").getByRole("button", { name: /Без свежего факта/ })).toHaveCount(0);
  // Этап 46: под полосой прогресса подпись «факт из целевого»
  await expect(row).toContainText("141 из 150");

  // Текст в числовой цели не проходит
  await page.getByTestId("goal-fact-D1").click();
  await editor.getByLabel("Факт", { exact: true }).fill("почти");
  await editor.getByTestId("goal-fact-save").click();
  await expect(editor.getByText(/впишите факт числом/)).toBeVisible();
  // Целевое значение меняется там же: прогресс пересчитан
  await editor.getByLabel("Факт", { exact: true }).fill("141");
  await editor.getByLabel("Целевое значение").fill("160");
  await expect(editor).toContainText("53%");
  await editor.getByTestId("goal-fact-save").click();
  await expect(page.getByText("Целевое значение сохранено").first()).toBeVisible();
  await expect(row).toContainText("141 из 160");
  await expect(row).toContainText("53%");

  // Раскрытая строка: метрика, история факта, действия
  await page.getByRole("button", { name: "Развернуть: Маржа департамента 150 млн" }).click();
  const details = page.getByTestId("goal-details");
  // Метрика на ноутбуке колонкой таблицы, в раскрытии только на телефоне (этап 46: без повторов)
  if (test.info().project.name === "phone") await expect(details.getByText("Промо-маржа за квартал, млн")).toBeVisible();
  else await expect(row.getByText("Промо-маржа за квартал, млн")).toBeVisible();
  await expect(page.getByTestId("goal-facts")).toContainText("По LRF за сентябрь");
  await expect(details.getByRole("button", { name: "Риск и итог" })).toBeVisible();
  await shot(page, "table-open");

  // Фильтр и группы
  await page.getByRole("radiogroup", { name: "Показать" }).getByRole("radio", { name: /Без свежего факта/ }).click();
  await expect(page.getByText("Под условия ничего не подходит")).toBeVisible();
  await page.getByRole("radiogroup", { name: "Показать" }).getByRole("radio", { name: "Все" }).click();
  await page.getByRole("radiogroup", { name: "Группы" }).getByRole("radio", { name: "По людям" }).click();
  await expect(page.getByTestId("goals-table")).toContainText(/целей 1/);
  await page.getByLabel("Поиск цели").fill("нет такой");
  await expect(page.getByText("Под условия ничего не подходит")).toBeVisible();
  await page.getByLabel("Поиск цели").fill("D1");
  await expect(row).toBeVisible();

  // Дерево целей с фактом и прогрессом
  await page.getByRole("radiogroup", { name: "Вид" }).getByRole("radio", { name: "Дерево" }).click();
  const tree = page.getByRole("list", { name: "Дерево целей" });
  await expect(tree).toContainText("факт 141");
  await expect(tree).toContainText("53%");
  await shot(page, "tree-fact");
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM goal_facts`);
  expect(n).toBe(1);
});
