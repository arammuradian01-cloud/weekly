import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 64: один экран «Люди», «Weekly-команды». Владелец создаёт команду и добавляет людей поиском из разных
// подразделений: своя ветка входит сразу, человек из другой ветки ждёт согласия своего руководителя. Переименование,
// «Убрать», отмена запроса, руководитель назначается в режиме управления, руководитель видит свои команды, согласующий
// решает на этом же экране, общий логин только смотрит. Ноутбук 1440 и телефон 360 без горизонтальной прокрутки

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

const INS = "Департамент страхования и инвестиций";
const COMPANY = [
  ["ФИО", "Должность", "Департамент", "Управление", "Руководит"],
  ["Крайник Александр", "CEO", "", "", "да"],
  ["Мурадян Арам", "Директор департамента", INS, "", "да"],
  ["Рева Тарас Игоревич", "CPO", INS, "Управление продуктового развития (insurance)", "да"],
  ["Токов Никита Андреевич", "Analytics Lead", INS, "Управление продуктового развития (insurance)", ""],
  ["Ершов Пётр", "Директор департамента", "Департамент Money", "", "да"],
  ["Лисина Анна", "Head of Credit", "Департамент Money", "Управление кредитных продуктов", "да"],
  ["Котов Игорь", "Product analyst", "Департамент Money", "Управление кредитных продуктов", ""],
  ["Белова Ольга", "Директор департамента", "Департамент партнёрств", "", "да"],
  ["Седов Максим", "Partner manager", "Департамент партнёрств", "Управление партнёрских продаж", ""],
]
  .map((r) => r.join("\t"))
  .join("\n");

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
});

const isPhone = () => test.info().project.name === "phone";

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-wt-${name}.png`, fullPage: true });
}

async function loadCompany(page: Page) {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/people/structure");
  await page.getByRole("button", { name: "Загрузить структуру" }).click();
  const drawer = page.getByRole("dialog", { name: "Загрузить структуру" });
  await drawer.getByLabel("Или вставьте ячейки из таблицы").fill(COMPANY);
  await drawer.getByRole("button", { name: "Проверить" }).click();
  await expect(drawer.getByTestId("structure-root")).toContainText("Структура всей компании");
  await drawer.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByText(/Структура загружена/).first()).toBeVisible();
}

async function personal(browser: Browser, page: Page, fullName: string) {
  const p = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: isPhone(), hasTouch: isPhone() })).newPage();
  const [row] = await sql('SELECT slug FROM people WHERE "fullName" LIKE $1', [`${fullName}%`]);
  await enterByLink(p, row!.slug as string);
  return p;
}

const teamId = async (name: string) => (await sql("SELECT id FROM teams WHERE name = $1 AND active", [name]))[0]!.id as string;

/** Открыть команду из списка: на ноутбуке карточка справа, на телефоне отдельный экран */
async function openTeam(page: Page, name: string) {
  await page.getByTestId("teams-list").getByRole("link", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) }).click();
  const card = page.getByTestId("team-card");
  await expect(card.getByRole("heading", { name, level: 2 })).toBeVisible();
  return card;
}

test("владелец собирает команду поиском из разных подразделений: своя ветка сразу, другая ждёт согласия; переименование, убрать, отмена", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await loadCompany(page);
  // В «Структуре» команды только для просмотра, управление по ссылке
  await page.getByRole("radio", { name: /Команды/ }).click();
  await expect(page.getByRole("button", { name: "Новая команда" })).toHaveCount(0);
  await page.getByTestId("manage-teams").click();
  await expect(page).toHaveURL(/\/people\/teams$/);
  // Режим управления: все команды компании, поиск по названию и людям, пересборка по структуре
  await expect(page.getByRole("button", { name: "Создать команды по структуре" })).toBeVisible();
  const all = page.getByTestId("teams-list");
  await expect(all).toContainText("Команда генерального директора");
  await expect(all).toContainText("Департамент Money");
  await page.getByLabel("Найти команду или человека").fill("котов");
  await expect(all).toContainText("Управление кредитных продуктов");
  await expect(all).not.toContainText("Департамент партнёрств");
  await shot(page, "owner-all");
  await page.getByLabel("Найти команду или человека").fill("");

  // Владелец лично, без режима управления: как руководитель, люди других веток ждут согласия
  const aram = await personal(browser, page, "Мурадян");
  await aram.goto("/people");
  await aram.getByTestId("people-tab-teams").click();
  await expect(aram).toHaveURL(/\/people\/teams$/);
  await expect(aram.getByRole("heading", { name: "Weekly-команды", level: 2 })).toBeVisible();
  await shot(aram, "start");

  await aram.getByTestId("team-create").click();
  const create = aram.getByRole("dialog", { name: "Новая weekly-команда" });
  await create.getByRole("textbox", { name: "Название команды" }).fill("Кросс-продажи");
  const search = create.getByLabel("Участники, можно добавить и позже");
  await search.fill("токов");
  await create.getByRole("checkbox", { name: /Токов Никита/ }).check();
  await search.fill("котов");
  const found = create.getByRole("list", { name: "Найденные люди" });
  await expect(found.getByRole("listitem").filter({ hasText: "Котов Игорь" })).toContainText("другая ветка");
  await create.getByRole("checkbox", { name: /Котов Игорь/ }).check();
  await expect(create.getByText("Выбрано: 2")).toBeVisible();
  await expect(create).toContainText("Из других веток: 1 человек");
  await shot(aram, "create");
  await create.getByRole("button", { name: "Создать команду" }).click();
  await expect(aram.getByText("Команда «Кросс-продажи»: добавлено 1, ждут согласия руководителя 1").first()).toBeVisible();

  // Карточка новой команды открылась сама: Токов в команде, Котов ждёт согласия Лисиной
  const id = await teamId("Кросс-продажи");
  const [row] = await sql('SELECT t.kind, t.project, l.slug AS leader FROM teams t JOIN people l ON l.id = t."leaderId" WHERE t.id = $1', [id]);
  expect(row).toMatchObject({ kind: "CUSTOM", project: true, leader: "muradyan" });
  const card = aram.getByTestId("team-card");
  await expect(card.getByRole("heading", { name: "Кросс-продажи", level: 2 })).toBeVisible();
  await expect(card.getByTestId("team-members")).toContainText("Токов Никита Андреевич");
  await expect(card.getByTestId("team-members")).toContainText("Мурадян Арам");
  const waiting = card.getByTestId("team-waiting");
  await expect(waiting).toContainText("Котов Игорь");
  await expect(waiting).toContainText("согласует Лисина Анна");
  // Карточку можно открыть ссылкой: команда в адресе
  await expect(aram).toHaveURL(new RegExp(`/people/teams\\?team=${id}$`));

  // Ещё люди поиском, несколько сразу: Седов и Ершов из других веток, Токов уже в команде
  await card.getByRole("button", { name: "Добавить участников" }).click();
  const add = aram.getByRole("dialog", { name: "Добавить участников: Кросс-продажи" });
  const find = add.getByLabel("Найти человека");
  await find.fill("токов");
  await expect(add.getByRole("checkbox", { name: /Токов Никита/ })).toBeDisabled();
  await find.fill("седов");
  await add.getByRole("checkbox", { name: /Седов Максим/ }).check();
  await find.fill("ершов");
  await add.getByRole("checkbox", { name: /Ершов Пётр/ }).check();
  await expect(add.getByTestId("team-add-external")).toContainText("Из других веток: 2 человека");
  await shot(aram, "add-people");
  await add.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(aram.getByText("Команда «Кросс-продажи»: добавлено 0, ждут согласия руководителя 2").first()).toBeVisible();
  await expect(waiting).toContainText("согласует Белова Ольга");
  await expect(waiting).toContainText("согласует Крайник Александр");
  const approvers = await sql(
    `SELECT p."fullName" AS who, a."fullName" AS approver FROM team_join_requests r JOIN people p ON p.id = r."personId" JOIN people a ON a.id = r."approverId" WHERE r."teamId" = $1 AND r.status = 'PENDING' ORDER BY p."fullName"`,
    [id],
  );
  expect(approvers.map((r) => `${r.who}: ${r.approver}`)).toEqual(["Ершов Пётр: Крайник Александр", "Котов Игорь: Лисина Анна", "Седов Максим: Белова Ольга"]);

  // Переименовать, убрать участника, отменить запрос
  await card.getByRole("button", { name: "Переименовать" }).click();
  const rename = aram.getByRole("dialog", { name: "Название команды" });
  await rename.getByRole("textbox", { name: "Название команды" }).fill("Кросс-продажи и кредиты");
  await rename.getByRole("button", { name: "Сохранить" }).click();
  await expect(aram.getByText("Команда переименована").first()).toBeVisible();
  await expect(card.getByRole("heading", { name: "Кросс-продажи и кредиты", level: 2 })).toBeVisible();
  await card.getByRole("button", { name: "Убрать из команды: Токов Никита Андреевич" }).click();
  await expect(aram.getByText("Токов Никита Андреевич убран из команды").first()).toBeVisible();
  await expect(card.getByTestId("team-members")).not.toContainText("Токов");
  await card.getByRole("button", { name: "Отменить запрос: Седов Максим" }).click();
  await expect(aram.getByText("Запрос отменён: Седов Максим").first()).toBeVisible();
  await expect(waiting).not.toContainText("Седов");
  await shot(aram, "card");
  const log = await sql(`SELECT field FROM audit_log WHERE entity = 'team' AND "entityId" = $1 ORDER BY at`, [id]);
  expect(log.map((r) => r.field)).toEqual(expect.arrayContaining(["Weekly-проект создан", "Название проекта", "Участник убран: Кросс-продажи и кредиты", "Запрос в команду отменён: Кросс-продажи и кредиты"]));

  // На телефоне карточка отдельным экраном: «К списку команд» возвращает список
  if (isPhone()) {
    await expect(aram.getByTestId("teams-list")).toBeHidden();
    await card.getByRole("button", { name: "К списку команд" }).click();
    await expect(aram.getByTestId("teams-list")).toBeVisible();
    await expect(aram.getByTestId("team-card")).toBeHidden();
  }

  // Режим управления: владелец назначает руководителем Реву
  await page.reload();
  const owned = await openTeam(page, "Кросс-продажи и кредиты");
  await owned.getByRole("button", { name: "Назначить руководителя" }).click();
  const lead = page.getByRole("dialog", { name: "Руководитель: Кросс-продажи и кредиты" });
  await lead.getByRole("combobox", { name: "Руководитель" }).fill("рева");
  await lead.getByRole("option", { name: /Рева Тарас/ }).click();
  await lead.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Команда сохранена").first()).toBeVisible();
  const [after] = await sql('SELECT l.slug AS leader FROM teams t JOIN people l ON l.id = t."leaderId" WHERE t.id = $1', [id]);
  expect(after!.leader).toBe("reva");
  await aram.close();
});

test("руководитель видит свои команды, согласующий решает на этом же экране, общий логин только смотрит", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await loadCompany(page);
  const reva = await personal(browser, page, "Рева");
  // Переключатель команды в шапке: внизу «Управлять командами»
  await reva.goto("/tasks");
  await reva.locator(isPhone() ? "#team-switcher-m" : "#team-switcher").selectOption("__manage");
  await expect(reva).toHaveURL(/\/people\/teams$/);
  const list = reva.getByTestId("teams-list");
  await expect(list).toContainText("Управление продуктового развития (insurance)");
  await expect(list).toContainText("Руководитель: вы");
  await expect(list).toContainText("Топ-команда");
  await expect(list).not.toContainText("Департамент Money");
  await shot(reva, "leader-list");

  // Своя команда по структуре: добавить человека из другой ветки, он ждёт согласия руководителя
  const card = await openTeam(reva, "Управление продуктового развития (insurance)");
  await expect(card.getByTestId("team-members")).toContainText("Токов Никита Андреевич");
  await card.getByRole("button", { name: "Добавить участников" }).click();
  const add = reva.getByRole("dialog", { name: "Добавить участников: Управление продуктового развития (insurance)" });
  await add.getByLabel("Найти человека").fill("котов");
  await add.getByRole("checkbox", { name: /Котов Игорь/ }).check();
  await add.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(reva.getByText(/добавлено 0, ждут согласия руководителя 1/).first()).toBeVisible();
  await expect(card.getByTestId("team-waiting")).toContainText("согласует Лисина Анна");
  // Команда по структуре: переименовать и закрыть её руководитель не может, это делает владелец
  await expect(card.getByRole("button", { name: "Переименовать" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Закрыть команду" })).toHaveCount(0);
  await shot(reva, "leader-card");
  // Топ-команда: Рева участник, только просмотр
  if (isPhone()) await card.getByRole("button", { name: "К списку команд" }).click();
  const top = await openTeam(reva, "Топ-команда");
  await expect(top.getByTestId("team-card-readonly")).toBeVisible();
  await expect(top.getByRole("button", { name: "Добавить участников" })).toHaveCount(0);
  // Старый адрес «Weekly-проектов» ведёт сюда
  await reva.goto("/people/projects");
  await expect(reva).toHaveURL(/\/people\/teams$/);
  await reva.close();

  // Руководитель Котова видит запрос в «Мне» и соглашается на экране команд
  const lisina = await personal(browser, page, "Лисина");
  await lisina.goto("/me");
  await lisina.getByRole("link", { name: "Запрос в команду" }).first().click();
  await expect(lisina).toHaveURL(/\/people\/teams#join-requests$/);
  const requests = lisina.getByTestId("join-requests");
  await expect(requests).toContainText("Котов Игорь в команду «Управление продуктового развития (insurance)»");
  await shot(lisina, "join-request");
  await requests.getByRole("button", { name: "Согласовать" }).click();
  await expect(lisina.getByTestId("join-requests")).toHaveCount(0);
  const team = await teamId("Управление продуктового развития (insurance)");
  const [member] = await sql(`SELECT external FROM team_members m JOIN people p ON p.id = m."personId" WHERE m."teamId" = $1 AND p."fullName" = 'Котов Игорь'`, [team]);
  expect(member!.external).toBe(true);
  await lisina.close();

  // Общий логин без режима управления: только топ-команда, без кнопок
  const shared = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: isPhone(), hasTouch: isPhone() })).newPage();
  await enter(shared, "Рева Тарас");
  await shared.goto("/people/teams");
  await expect(shared.getByText("Под общим входом команды только для просмотра", { exact: false })).toBeVisible();
  await expect(shared.getByTestId("team-create")).toHaveCount(0);
  await expect(shared.getByTestId("teams-list").getByRole("link")).toHaveCount(1);
  const sharedTop = await openTeam(shared, "Топ-команда");
  await expect(sharedTop.getByTestId("team-card-readonly")).toBeVisible();
  await expect(sharedTop.getByRole("button", { name: /Убрать из команды/ })).toHaveCount(0);
  await shot(shared, "shared");
  await shared.close();
});
