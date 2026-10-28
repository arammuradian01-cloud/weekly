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
  await page.goto("/people/structure");
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

  // Команды: сектор Антонова под командой Тараса, Тарас под топ-командой. С этапа 64 здесь только просмотр
  await page.getByRole("radio", { name: /Команды/ }).click();
  await expect(page.getByTestId("manage-teams")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ритм weekly" })).toHaveCount(0);
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
  await lead.goto("/people");
  await expect(lead.getByRole("heading", { name: "Сектор автострахования", level: 2 })).toBeVisible();
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

test("общий логин предлагает всех людей структуры без личного пароля (этап 71)", async ({ page }) => {
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
  // Владелец вошёл своим логином и паролем выше: по общему логину его профиль больше не открыть
  await expect(p.getByRole("button", { name: /Мурадян Арам/ })).toHaveCount(0);
  await p.getByLabel("Поиск по ФИО, должности или подразделению").fill("антонов");
  await expect(p.getByRole("button", { name: /Антонов Дмитрий/ })).toBeVisible();
  await other.close();
});

test("дерево подчинённых: схема с путём наверх, вакансии, поиск и список", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await loadStructure(page);
  await page.goto("/people/structure");
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
  // Этап 39: weekly человека, видимость как у задач
  await expect(focus.getByRole("link", { name: "Weekly" })).toHaveAttribute("href", `/weekly?author=${antonov}`);
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
  // Список открыт до выбранного человека: ветка Ревы раскрыта, Чемоданова видна
  await expect(list).toContainText("Чемоданова Алиса");
  await list.getByRole("button", { name: /Свернуть: Рева Тарас/ }).click();
  await expect(list).not.toContainText("Антонов Дмитрий");
  await list.getByRole("button", { name: /Развернуть: Рева Тарас/ }).click();
  await expect(list).toContainText("Антонов Дмитрий");
  await shot(page, "people-list");

  // Имя в списке открывает человека на схеме
  await list.getByRole("button", { name: "Антонов Дмитрий", exact: true }).click();
  await expect(tree.getByTestId("person-focus")).toContainText("Антонов Дмитрий");
  // Этап 45: карточка человека одна на все вкладки. Из таблицы команды открывается панелью, «В структуре» ведёт
  // в дерево на этом человеке, панель закрывается сама
  await page.goto("/people");
  await page.getByTestId("team-summary").getByRole("button", { name: /^Рева Тарас/ }).click();
  const card = page.getByRole("dialog", { name: "Рева Тарас" });
  await expect(card.getByText("Руководитель", { exact: true })).toBeVisible();
  await expect(card.getByText("Мурадян Арам")).toBeVisible();
  await card.getByRole("link", { name: "В структуре" }).click();
  await expect(page).toHaveURL(new RegExp(`/people/structure\\?person=${reva}$`));
  await expect(page.getByRole("dialog", { name: "Рева Тарас" })).toHaveCount(0);
  await expect(page.getByTestId("person-focus")).toContainText("Рева Тарас");
  // Другие ветки свёрнуты, раскрываются по клику
  const otherRoots = page.getByTestId("other-roots");
  if (await otherRoots.count()) {
    await expect(otherRoots.getByRole("list", { name: "Другие ветки" })).toBeHidden();
    await otherRoots.locator("summary").click();
    await expect(otherRoots.getByRole("list", { name: "Другие ветки" })).toBeVisible();
  }

  // Ссылка «Цели» с карточки открывает цели с поиском по человеку
  await page.goto("/goals");
  await page.getByRole("button", { name: "Новая цель" }).click();
  const modal = page.getByRole("dialog", { name: /Новая цель/ });
  await modal.getByLabel("Команда").selectOption({ label: "Команда страхования и инвестиций" });
  await modal.getByLabel("Цель", { exact: true }).fill("Маржа департамента 150 млн");
  await modal.getByRole("button", { name: "Завести цель" }).click();
  await expect(page.getByText("Цель заведена").first()).toBeVisible();
  await page.goto(`/goals?find=${encodeURIComponent("Рева Тарас")}`);
  await expect(page.getByLabel("Поиск цели")).toHaveValue("Рева Тарас");

  // Общий логин без режима управления: дерево видно, вакансий нет, даже с профилем руководителя. Этап 71: владелец по
  // общему логину не входит, поэтому профиль руководителя ветки здесь у Ревы
  const other = await page.context().browser()!.newContext({ viewport: page.viewportSize()!, isMobile: test.info().project.name === "phone" });
  const shared = await other.newPage();
  await enter(shared, "Рева Тарас");
  await shared.goto("/people/structure");
  const sharedTree = shared.getByTestId("people-tree");
  // Дерево открывается на собственном профиле Ревы: повторно выбирать его не нужно.
  await expect(sharedTree.getByTestId("person-focus")).toContainText("Рева Тарас");
  await sharedTree.getByTestId(`person-${antonov}`).click();
  await expect(sharedTree.getByTestId("person-focus")).toContainText("Антонов Дмитрий");
  await expect(sharedTree.getByTestId("person-focus")).not.toContainText("Открытые вакансии");
  await other.close();
});

// Этап 53: файл всей компании с колонкой «Департамент»
const COMPANY = [
  ["ФИО", "Должность", "Департамент", "Управление", "Отдел", "Руководитель", "Руководит", "Статус"],
  ["Крайник Александр", "CEO", "", "", "", "", "да", ""],
  ["Мурадян Арам", "Директор департамента", "Департамент страхования и инвестиций", "", "", "", "да", ""],
  ["Рева Тарас Игоревич", "CPO", "Департамент страхования и инвестиций", "Управление продуктового развития (insurance)", "", "", "да", ""],
  ["Токов Никита Андреевич", "Analytics Lead", "Департамент страхования и инвестиций", "Управление продуктового развития (insurance)", "Отдел аналитики (insurance)", "", "", ""],
  ["Харченко Артём", "CFO", "Финансовый департамент", "", "", "", "да", ""],
  ["Кацемба Наталья Сергеевна", "Chief Accountant", "Финансовый департамент", "Управление финансового учёта и контроля", "", "", "да", ""],
  ["Погосова Сабина Левоновна", "Finance coordinator", "Финансовый департамент", "Управление финансового учёта и контроля", "Отдел финансового сопровождения бизнеса", "", "", ""],
  ["", "CMO", "Департамент маркетинга", "", "", "", "", "вакансия"],
]
  .map((r) => r.join("\t"))
  .join("\n");

test("этап 53: структура всей компании, генеральный во главе, руководитель добавляет человека из другого департамента поиском", async ({ page, browser }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/people/structure");
  await page.getByRole("button", { name: "Загрузить структуру" }).click();
  const drawer = page.getByRole("dialog", { name: "Загрузить структуру" });
  await drawer.getByLabel("Или вставьте ячейки из таблицы").fill(COMPANY);
  await drawer.getByRole("button", { name: "Проверить" }).click();
  await expect(drawer.getByText(/Людей добавится 5/)).toBeVisible();
  await drawer.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByText(/Структура загружена/).first()).toBeVisible();

  // Подразделения: компания наверху, генеральный её руководитель, департаменты под ней
  const main = page.getByRole("main");
  await page.getByRole("radio", { name: "Подразделения" }).click();
  await expect(main.getByText("Сравни", { exact: true })).toBeVisible();
  await expect(main.getByText("Руководитель: Крайник Александр", { exact: false }).first()).toBeVisible();
  await expect(main.getByText("Финансовый департамент", { exact: true })).toBeVisible();
  await shot(page, "company-units");
  await page.getByRole("radio", { name: /Команды/ }).click();
  await expect(main.getByText("Команда генерального директора", { exact: true })).toBeVisible();
  await shot(page, "company-teams");

  // Рева собирает свою команду на экране «Weekly-команды» (этап 64): находит человека из финансового департамента поиском
  const lead = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: test.info().project.name === "phone" })).newPage();
  await enterByLink(lead, "reva");
  await lead.goto("/people/structure");
  await lead.getByTestId("manage-teams").click();
  await expect(lead).toHaveURL(/\/people\/teams$/);
  await lead.getByTestId("teams-list").getByRole("link", { name: /^Управление продуктового развития \(insurance\)/ }).click();
  const team = (await sql("SELECT id FROM teams WHERE name = 'Управление продуктового развития (insurance)'"))[0]!.id as string;
  const card = lead.getByTestId("team-card");
  await card.getByRole("button", { name: "Добавить участников" }).click();
  const add = lead.getByRole("dialog", { name: "Добавить участников: Управление продуктового развития (insurance)" });
  await add.getByLabel("Найти человека").fill("погос");
  await expect(add.getByRole("list", { name: "Найденные люди" }).getByRole("listitem").filter({ hasText: "Погосова Сабина" })).toContainText("другая ветка");
  await add.getByRole("checkbox", { name: /Погосова Сабина/ }).check();
  await expect(add.getByTestId("team-add-external")).toContainText("войдут в команду, когда согласится их руководитель");
  await shot(lead, "company-add-external");
  await add.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(lead.getByText("Команда «Управление продуктового развития (insurance)»: добавлено 0, ждут согласия руководителя 1").first()).toBeVisible();
  await expect(card.getByTestId("team-waiting")).toContainText("согласует Кацемба Наталья");
  const [none] = await sql(`SELECT count(*)::int AS n FROM team_members WHERE "teamId" = '${team}'`);
  expect(none!.n).toBe(1);

  // Руководитель Погосовой видит запрос у себя и соглашается
  const boss = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: test.info().project.name === "phone" })).newPage();
  const katsemba = (await sql(`SELECT slug FROM people WHERE "fullName" LIKE 'Кацемба%'`))[0]!.slug as string;
  await enterByLink(boss, katsemba);
  await boss.goto("/me");
  await boss.getByRole("link", { name: "Запрос в команду" }).first().click();
  // Этап 64: запросы решают на экране «Weekly-команды»
  await expect(boss).toHaveURL(/\/people\/teams#join-requests$/);
  await expect(boss.getByTestId("join-requests")).toContainText("Погосова Сабина");
  await shot(boss, "company-join-request");
  await boss.getByRole("button", { name: "Согласовать" }).click();
  // После согласия запрос уходит из списка
  await expect(boss.getByTestId("join-requests")).toHaveCount(0);
  const [member] = await sql(`SELECT external FROM team_members m JOIN people p ON p.id = m."personId" WHERE m."teamId" = '${team}' AND p."fullName" LIKE 'Погосова%'`);
  expect(member!.external).toBe(true);
  await boss.close();
  await lead.close();
});
