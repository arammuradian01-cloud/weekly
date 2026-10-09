import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 14: структура департамента и команды. Владелец загружает структуру, руководитель сектора видит свою команду
// и не видит задач топ-команды, переключатель команд меняет список задач. Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

const STRUCTURE = [
  ["ФИО", "Должность", "Управление", "Отдел", "Сектор", "Руководитель", "Руководит", "Статус"],
  ["Рева Тарас Игоревич", "CPO", "Управление развития продуктов", "", "", "Мурадян Арам", "да", ""],
  ["Антонов Дмитрий", "PO OSAGO", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "Рева Тарас", "да", ""],
  ["Чемоданова Алиса", "Product Designer", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "", "", ""],
  ["Вакансия", "PO KASKO", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "", "", "вакансия"],
]
  .map((r) => r.join("\t"))
  .join("\n");

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
});

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-s-${name}.png`, fullPage: true });
}

async function loadStructure(page: Page) {
  await page.goto("/structure");
  await page.getByRole("button", { name: "Загрузить структуру" }).click();
  const drawer = page.getByRole("dialog", { name: "Загрузить структуру" });
  await drawer.getByLabel("Или вставьте ячейки из таблицы").fill(STRUCTURE);
  await drawer.getByRole("button", { name: "Проверить" }).click();
  await expect(drawer.getByText("Людей добавится 2, изменится 1")).toBeVisible();
  await expect(drawer.getByText("Антонов Дмитрий, PO OSAGO, Сектор автострахования")).toBeVisible();
  await shot(page, "import-preview");
  await drawer.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByText(/Структура загружена: новых людей 2/).first()).toBeVisible();
}

test("владелец загружает структуру, команды появляются сами, руководитель сектора видит только свою команду", async ({ page, browser }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await loadStructure(page);

  // Подразделения: сектор с руководителем и вакансией
  const main = page.getByRole("main");
  await expect(main.getByText("Управление развития продуктов", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Развернуть: Отдел развития продуктов" }).click();
  await page.getByRole("button", { name: "Развернуть: Сектор автострахования" }).click();
  await expect(page.getByText("Руководитель: Антонов Дмитрий, человек в ветке: 2")).toBeVisible();
  await expect(page.getByText("Вакансии: PO KASKO")).toBeVisible();
  await shot(page, "units");

  // Команды: сектор Антонова под командой Тараса, Тарас под топ-командой
  await page.getByRole("radio", { name: /Команды/ }).click();
  await expect(main.getByText("Сектор автострахования", { exact: true })).toBeVisible();
  await expect(main.getByText(/Руководитель: Антонов Дмитрий, участников 1/)).toBeVisible();
  await shot(page, "teams");

  // Владелец ставит задачу в команду сектора через переключатель команд
  const sector = (await sql("SELECT id FROM teams WHERE name = 'Сектор автострахования'"))[0]!.id as string;
  await page.goto("/tasks");
  const switcher = page.locator(test.info().project.name === "phone" ? "#team-switcher-m" : "#team-switcher");
  await switcher.selectOption(sector);
  await expect(page.getByText("В команде пока нет задач")).toBeVisible();
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "Новая задача" });
  await expect(dialog.getByLabel("Команда")).toHaveValue(sector);
  await dialog.getByLabel("Задача").fill("Макет формы расчёта");
  await dialog.getByLabel("Что нужно сделать").fill("Согласованный макет в Figma");
  await dialog.getByLabel("Ответственный").selectOption({ label: "Чемоданова Алиса" });
  await dialog.getByRole("button", { name: "Поставить задачу" }).click();
  await expect(page.getByText(/Задача \d+ создана/).first()).toBeVisible();
  const [created] = await sql("SELECT number, \"teamId\" FROM tasks WHERE title = 'Макет формы расчёта'");
  expect(created!.teamId).toBe(sector);

  // Руководитель сектора входит по личной ссылке: видит свою команду и задачу, задач топ-команды не видит
  const lead = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: test.info().project.name === "phone" })).newPage();
  const antonov = (await sql("SELECT slug FROM people WHERE \"fullName\" = 'Антонов Дмитрий'"))[0]!.slug as string;
  await enterByLink(lead, antonov);
  await lead.goto("/tasks");
  await expect(lead.getByRole("main").getByText("Макет формы расчёта").locator("visible=true").first()).toBeVisible();
  await lead.goto("/team");
  await expect(lead.getByRole("heading", { name: "Команда: Сектор автострахования" })).toBeVisible();
  await expect(lead.getByRole("main").getByText("Чемоданова Алиса").locator("visible=true").first()).toBeVisible();
  await shot(lead, "lead-team");
  const [topTask] = await sql("SELECT number FROM tasks WHERE \"teamId\" = 'top' ORDER BY number LIMIT 1");
  await lead.goto(`/tasks/${topTask!.number}`);
  await expect(lead.getByText(`Задачи ${topTask!.number} нет`)).toBeVisible();

  // Руководитель сам переносит срок задачи своей команды, без режима управления
  await lead.goto(`/tasks/${created!.number}`);
  await expect(lead.getByRole("button", { name: "Перенести срок" })).toBeVisible();
  await lead.close();
});

test("общий логин предлагает только людей топ-команды", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await loadStructure(page);
  const other = await page.context().browser()!.newContext();
  const p = await other.newPage();
  await p.goto("/login");
  await p.getByLabel("Логин").fill("team");
  await p.getByLabel("Пароль").fill("e2e-team-password-1");
  await p.getByRole("button", { name: "Войти" }).click();
  await expect(p).toHaveURL(/\/choose$/);
  await expect(p.getByRole("button", { name: /Рева Тарас/ })).toBeVisible();
  await expect(p.getByRole("button", { name: /Антонов Дмитрий/ })).toHaveCount(0);
  await other.close();
});

test("дерево подчинённых: схема с путём наверх, вакансии, поиск и список", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await loadStructure(page);
  await page.goto("/structure");
  // После загрузки структуры страница открывается на дереве подчинённых
  await expect(page.getByRole("radio", { name: "Подчинённые" })).toHaveAttribute("aria-checked", "true");
  const tree = page.getByTestId("people-tree");
  await expect(tree.getByTestId("person-focus")).toContainText("Мурадян Арам");
  const [{ slug: reva }] = await sql(`SELECT slug FROM people WHERE "fullName" LIKE 'Рева Тарас%'`);
  const [{ slug: antonov }] = await sql(`SELECT slug FROM people WHERE "fullName" = 'Антонов Дмитрий'`);
  await tree.getByTestId(`person-${reva}`).click();
  await expect(tree.getByTestId("person-focus")).toContainText("Рева Тарас");
  await expect(tree.getByRole("navigation", { name: "Путь до верха" })).toContainText("Мурадян Арам");
  await shot(page, "people-chart");
  await tree.getByTestId(`person-${antonov}`).click();
  const focus = tree.getByTestId("person-focus");
  await expect(focus).toContainText("Антонов Дмитрий");
  await expect(focus).toContainText("PO OSAGO, Сектор автострахования");
  await expect(focus).toContainText("Открытые вакансии в подразделении");
  await expect(focus).toContainText("PO KASKO");
  await expect(focus.getByRole("link", { name: "Задачи" })).toHaveAttribute("href", `/tasks?owner=${antonov}`);
  await expect(focus.getByRole("link", { name: "Цели" })).toHaveAttribute("href", `/goals?find=${encodeURIComponent("Антонов Дмитрий")}`);
  // На уровень выше и по пути
  await focus.getByRole("button", { name: /На уровень выше/ }).click();
  await expect(tree.getByTestId("person-focus")).toContainText("Рева Тарас");
  await tree.getByRole("navigation", { name: "Путь до верха" }).getByRole("button", { name: "Мурадян Арам" }).click();
  await expect(tree.getByTestId("person-focus")).toContainText("Мурадян Арам");
  // Поиск открывает человека
  await page.getByLabel("Найти человека").fill("Product Desi");
  await page.getByRole("list", { name: "Найденные люди" }).getByRole("button", { name: /Чемоданова Алиса/ }).click();
  await expect(tree.getByTestId("person-focus")).toContainText("Чемоданова Алиса");
  // Список всем деревом
  await page.getByRole("radiogroup", { name: "Вид дерева" }).getByRole("radio", { name: "Список" }).click();
  const list = page.getByRole("list", { name: "Дерево подчинённых" });
  await expect(list).toContainText("Рева Тарас");
  await list.getByRole("button", { name: /Развернуть: Рева Тарас/ }).click();
  await expect(list).toContainText("Антонов Дмитрий");
  await shot(page, "people-list");
  // Ссылка «Цели» с карточки открывает цели с поиском по человеку
  await page.goto(`/goals?find=${encodeURIComponent("Рева Тарас")}`);
  await expect(page.getByLabel("Поиск цели")).toHaveValue("Рева Тарас");
});
