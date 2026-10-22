import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";
import { E2E_PASSWORDS } from "./global-setup";

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

const slugOf = async (name: string) => (await sql('SELECT slug FROM people WHERE "fullName" LIKE $1', [`${name}%`]))[0]!.slug as string;
const teamId = async (name: string) => (await sql("SELECT id FROM teams WHERE name = $1 AND active", [name]))[0]!.id as string;

/** Открыть команду из списка: на ноутбуке карточка справа, на телефоне отдельный экран */
async function openTeam(page: Page, name: string) {
  const row = page.getByTestId("teams-list").getByRole("link", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) });
  await row.click();
  const card = page.getByTestId("team-card");
  await expect(card.getByRole("heading", { name, level: 2 })).toBeVisible();
  // На телефоне карточка заменяет список: фокус на её заголовок. На ноутбуке фокус остаётся в списке, строка выбрана
  if (isPhone()) await expect(card.getByRole("heading", { name, level: 2 })).toBeFocused();
  else {
    await expect(row).toBeFocused();
    await expect(row).toHaveAttribute("aria-current", "true");
  }
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
  // Без режима управления владелец видит только свои команды, и экран говорит почему
  await expect(aram.getByTestId("manage-hint").first()).toContainText("Включите режим управления, чтобы видеть все команды и назначать руководителей");
  // После включения режима управления страница возвращает сюда же
  await expect(aram.getByTestId("manage-hint").first().getByRole("link", { name: "Включить режим управления" })).toHaveAttribute("href", /^\/manage\?next=%2Fpeople%2Fteams/);
  // На телефоне без выбранной команды в списке ничего не подсвечено
  if (isPhone()) await expect(aram.getByTestId("teams-list").locator('[aria-current="true"]')).toHaveCount(0);
  if (!isPhone()) {
    // Своя топ-команда: не «только просмотр», а где менять состав
    await expect(aram.getByTestId("team-card")).toContainText("Состав этой команды меняют в режиме управления");
    await expect(aram.getByTestId("team-card")).not.toContainText("Только просмотр");
  }
  await shot(aram, "start");

  await aram.getByTestId("team-create").click();
  const create = aram.getByRole("dialog", { name: "Новая weekly-команда" });
  await expect(create).toContainText("Другого руководителя назначите в карточке команды, включив режим управления");
  await expect(create.getByRole("combobox", { name: "Руководитель" })).toHaveCount(0);
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
  await expect(card).toContainText("в команде 2 человека, с руководителем");
  await expect(card.getByTestId("manage-hint")).toContainText("Назначить другого руководителя можно в режиме управления");
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

  // На телефоне карточка отдельным экраном: «К списку команд» это шаг назад, фокус возвращается на строку команды
  if (isPhone()) {
    await expect(aram.getByTestId("teams-list")).toBeHidden();
    await card.getByRole("button", { name: "К списку команд" }).click();
    await expect(aram).toHaveURL(/\/people\/teams$/);
    await expect(aram.getByTestId("teams-list")).toBeVisible();
    await expect(aram.getByTestId("team-card")).toBeHidden();
    await expect(aram.getByTestId(`team-row-${id}`)).toBeFocused();
    // Системная «Назад» ведёт себя так же: открыть карточку из списка и вернуться
    await openTeam(aram, "Кросс-продажи и кредиты");
    await aram.goBack();
    await expect(aram).toHaveURL(/\/people\/teams$/);
    await expect(aram.getByTestId("teams-list")).toBeVisible();
  }

  // Подсказка в карточке ведёт на включение режима управления и обратно в эту же карточку, где теперь можно назначить руководителя
  const mine = await openTeam(aram, "Кросс-продажи и кредиты");
  const manageLink = mine.getByTestId("manage-hint").getByRole("link", { name: "Включить режим управления" });
  await expect(manageLink).toHaveAttribute("href", `/manage?next=${encodeURIComponent(`/people/teams?team=${id}`)}`);
  await manageLink.click();
  await expect(aram).toHaveURL(/\/manage\?next=/);
  await aram.getByLabel(/Пароль/).fill(E2E_PASSWORDS.owner);
  await aram.getByRole("button", { name: "Включить на 12 часов" }).click();
  await expect(aram).toHaveURL(new RegExp(`/people/teams\\?team=${id}$`));
  await expect(aram.getByTestId("team-card").getByRole("button", { name: "Назначить руководителя" })).toBeVisible();
  await expect(aram.getByTestId("manage-hint")).toHaveCount(0);

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

  // Команда выше: поиск по названию или руководителю вместо списка на десятки команд (этап 70). Саму команду не предлагает
  await owned.getByRole("button", { name: "Назначить руководителя" }).click();
  const up = page.getByRole("dialog", { name: "Руководитель: Кросс-продажи и кредиты" });
  const parentField = up.getByRole("combobox", { name: "Команда выше" });
  const parentList = up.getByRole("listbox", { name: "Команда выше" });
  await parentField.fill("департамент");
  await expect(parentList.getByRole("option", { name: /^Департамент Money/ })).toBeVisible();
  await parentField.fill("кросс-продажи");
  await expect(up.getByText("Такой команды нет: проверьте написание").first()).toBeVisible();
  await expect(parentList.getByRole("option")).toHaveCount(0);
  await parentField.fill("белова");
  const partners = parentList.getByRole("option", { name: /^Департамент партнёрств/ });
  await expect(partners).toContainText("Руководитель: Белова Ольга");
  await partners.click();
  await expect(parentField).toHaveValue("Департамент партнёрств");
  await up.getByRole("button", { name: "Сохранить" }).click();
  await expect(up).toHaveCount(0);
  await expect.poll(async () => (await sql('SELECT p.name FROM teams t JOIN teams p ON p.id = t."parentId" WHERE t.id = $1', [id]))[0]?.name).toBe("Департамент партнёрств");

  // Режим управления: создать команду сразу с другим руководителем
  if (isPhone()) await owned.getByRole("button", { name: "К списку команд" }).click();
  await page.getByTestId("team-create").click();
  const pilot = page.getByRole("dialog", { name: "Новая weekly-команда" });
  await pilot.getByRole("textbox", { name: "Название команды" }).fill("Партнёрский пилот");
  await pilot.getByRole("combobox", { name: "Руководитель" }).fill("белова");
  await pilot.getByRole("option", { name: /Белова Ольга/ }).click();
  await pilot.getByLabel("Участники, можно добавить и позже").fill("седов");
  await pilot.getByRole("checkbox", { name: /Седов Максим/ }).check();
  await pilot.getByRole("button", { name: "Создать команду" }).click();
  // Карточка новой команды открывается переходом без перезагрузки страницы (этап 70): тост на месте и после неё
  const pilotCard = page.getByTestId("team-card");
  await expect(pilotCard.getByRole("heading", { name: "Партнёрский пилот", level: 2 })).toBeVisible();
  await expect(page.getByText("Команда «Партнёрский пилот»: добавлено 1. Руководитель: Белова Ольга").first()).toBeVisible();
  await expect(pilotCard).toContainText("Белова Ольга");
  // В режиме управления действия руководителя и ритма кнопками в шапке карточки
  await expect(pilotCard.getByTestId("team-card-actions").getByRole("button", { name: "Назначить руководителя" })).toBeVisible();
  await expect(pilotCard.getByTestId("team-card-actions").getByRole("button", { name: "Кто сдаёт и срок" })).toBeVisible();
  const [pilotRow] = await sql('SELECT l.slug AS leader, p.name AS parent FROM teams t JOIN people l ON l.id = t."leaderId" LEFT JOIN teams p ON p.id = t."parentId" WHERE t.name = $1', ["Партнёрский пилот"]);
  expect(pilotRow!.leader).toBe(await slugOf("Белова"));
  // Команда встала под команду своего руководителя по структуре, а не под топ-команду владельца
  expect(pilotRow!.parent).toBe("Департамент партнёрств");
  await shot(page, "owner-pilot");
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
  await expect(list).toContainText("Команда страхования и инвестиций");
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
  // Вкладка «Weekly-команды» при открытой карточке возвращает к списку. Адрес без команды: переход закончился,
  // дальше явный выбор строки ничем не перебивается (на ноутбуке первая команда только подсвечена, адрес не меняется)
  await reva.getByTestId("people-tab-teams").click();
  await expect(reva).toHaveURL(/\/people\/teams$/);
  await expect(list).toBeVisible();
  if (!isPhone()) await expect(list.locator('[aria-current="true"]')).toHaveCount(1);
  if (isPhone()) await expect(reva.getByTestId("team-card")).toBeHidden();
  const top = await openTeam(reva, "Команда страхования и инвестиций");
  await expect(top.getByTestId("team-card-readonly")).toContainText("Состав этой команды меняет владелец в режиме управления");
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

  // Руководитель департамента видит команды ниже своей и задаёт им ритм weekly, состав меняет их руководитель
  const ershov = await personal(browser, page, "Ершов");
  await ershov.goto("/people/teams");
  const below = ershov.getByTestId(`team-row-${await teamId("Управление кредитных продуктов")}`);
  await expect(below).toContainText("команда ниже вашей");
  const credit = await openTeam(ershov, "Управление кредитных продуктов");
  await expect(credit.getByTestId("team-card-actions").getByRole("button", { name: "Кто сдаёт и срок" })).toBeVisible();
  await expect(credit.getByRole("button", { name: "Добавить участников" })).toHaveCount(0);
  await expect(credit.getByTestId("team-card-readonly")).toContainText("Команда ниже вашей");
  await credit.getByRole("button", { name: "Кто сдаёт и срок" }).click();
  const rhythm = ershov.getByRole("dialog", { name: "Ритм weekly: Управление кредитных продуктов" });
  await rhythm.getByLabel(/Weekly сдают и специалисты/).check();
  await rhythm.getByRole("button", { name: "Сохранить" }).click();
  await expect(ershov.getByText("Ритм команды сохранён").first()).toBeVisible();
  await expect(credit).toContainText("Сдают все участники");
  await shot(ershov, "below");
  await ershov.close();

  // Общий логин без режима управления: только топ-команда, без кнопок
  const shared = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: isPhone(), hasTouch: isPhone() })).newPage();
  await enter(shared, "Рева Тарас");
  await shared.goto("/people/teams");
  await expect(shared.getByText("Под общим входом команды только для просмотра", { exact: false })).toBeVisible();
  await expect(shared.getByTestId("team-create")).toHaveCount(0);
  await expect(shared.getByTestId("teams-list").getByRole("link")).toHaveCount(1);
  const sharedTop = await openTeam(shared, "Команда страхования и инвестиций");
  await expect(sharedTop.getByTestId("team-card-readonly")).toBeVisible();
  await expect(sharedTop.getByRole("button", { name: /Убрать из команды/ })).toHaveCount(0);
  await shot(shared, "shared");
  await shared.close();
});

test("новая команда открывается без перезагрузки страницы: тост на месте, перебор команд на ноутбуке не копит историю", async ({ page }) => {
  test.setTimeout(120_000);
  await loadCompany(page);
  await page.goto("/people/teams");
  // Этап 70: адрес карточки раньше менялся через window.history, и Next после действия перезагружал всю страницу,
  // когда ответ действия приходил целиком (быстрая сеть). Отдаём ответ одним куском: так перезагрузка была каждый раз
  await page.route("**/people/teams*", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.body() });
  });
  const card = page.getByTestId("team-card");
  const length = await page.evaluate(() => window.history.length);
  for (const name of ["Пилот продаж", "Пилот сервиса"]) {
    if (isPhone() && (await card.isVisible())) await card.getByRole("button", { name: "К списку команд" }).click();
    await page.evaluate(() => ((window as unknown as { samePage?: boolean }).samePage = true));
    await page.getByTestId("team-create").click();
    const create = page.getByRole("dialog", { name: "Новая weekly-команда" });
    await create.getByRole("textbox", { name: "Название команды" }).fill(name);
    await create.getByRole("button", { name: "Создать команду" }).click();
    await expect(card.getByRole("heading", { name, level: 2 })).toBeVisible();
    await expect(page.getByText(`Команда «${name}» создана`).first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { samePage?: boolean }).samePage === true), "страница перезагрузилась").toBe(true);
    await expect(page).toHaveURL(new RegExp(`/people/teams\\?team=${await teamId(name)}$`));
  }
  if (isPhone()) {
    // Телефон: карточка новой команды открылась шагом вперёд, «Назад» возвращает к списку
    await page.goBack();
    await expect(page).toHaveURL(/\/people\/teams$/);
    await expect(page.getByTestId("teams-list")).toBeVisible();
  } else {
    // Ноутбук: обе карточки и перебор команд в списке заменяют адрес, история не растёт
    await openTeam(page, "Пилот продаж");
    await openTeam(page, "Департамент Money");
    expect(await page.evaluate(() => window.history.length)).toBe(length);
  }
});
