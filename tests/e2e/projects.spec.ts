import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 57: weekly-проекты. Готовые команды департаментов по структуре, Money и партнёрства отдельно. Руководитель
// забирает к себе целую команду или человека: свои входят сразу, люди других веток ждут согласия своего
// непосредственного руководителя. На ноутбуке перетаскиванием, на телефоне кнопкой «В команду». С этапа 64 это
// помощник «Собрать из структуры» на экране «Weekly-команды», основной путь в tests/e2e/weekly-teams.spec.ts.
// Цифры прогноза пока только у страхования и инвестиций. Ноутбук 1440 и телефон 360

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
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-pr-${name}.png`, fullPage: true });
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

const unitId = async (name: string) => (await sql("SELECT id FROM org_units WHERE name = $1 AND active", [name]))[0]!.id as string;
const slugOf = async (name: string) => (await sql('SELECT slug FROM people WHERE "fullName" LIKE $1', [`${name}%`]))[0]!.slug as string;

/** Перетаскивание мышью: dnd-kit начинает после сдвига на 6 точек */
async function drag(page: Page, from: Locator, to: Locator) {
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  await page.mouse.move(a.x + 8, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 30, a.y + a.height / 2, { steps: 5 });
  const b = (await to.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await page.mouse.up();
}

test("помощник «Собрать из структуры»: руководитель забирает готовую команду другого департамента и своего человека", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await loadCompany(page);
  const reva = await personal(browser, page, "Рева");
  await reva.goto("/people");
  await reva.getByTestId("people-tab-teams").click();
  await expect(reva).toHaveURL(/\/people\/teams$/);
  // Этап 64: перетаскивание осталось помощником, свёрнутым по умолчанию
  const helper = reva.getByTestId("assemble");
  await expect(helper.getByRole("heading", { name: "Готовые команды по структуре" })).toBeHidden();
  await helper.locator("summary").click();
  await expect(helper.getByRole("heading", { name: "Готовые команды по структуре" })).toBeVisible();
  // Money и партнёрства отдельными командами, рядом департамент страхования
  const money = await unitId("Департамент Money");
  const partners = await unitId("Департамент партнёрств");
  const ins = await unitId(INS);
  const ready = reva.getByTestId("ready-teams");
  await expect(ready.getByTestId(`unit-${money}`)).toContainText("Ершов Пётр, 3 человека");
  await expect(ready.getByTestId(`unit-${partners}`)).toContainText("Белова Ольга, 2 человека");
  await expect(ready.getByTestId(`unit-${ins}`)).toBeVisible();
  // Своя команда по структуре уже среди команд, куда можно добавить
  await expect(helper.getByRole("heading", { name: "Управление продуктового развития (insurance)", level: 3 })).toBeVisible();
  await shot(reva, "start");

  const name = "Weekly: Департамент Money";
  if (isPhone()) {
    await ready.getByRole("button", { name: "Департамент Money, 3 человека: добавить в команду" }).click();
    await reva.getByRole("menuitem", { name: "Новая команда" }).click();
  } else {
    await drag(reva, reva.getByTestId(`drag-unit-${money}`), reva.getByTestId("assemble-new"));
  }
  const dialog = reva.getByRole("dialog", { name: "Новая weekly-команда" });
  await expect(dialog).toContainText("3 человека из «Департамент Money»");
  await expect(dialog.getByRole("textbox", { name: "Название команды" })).toHaveValue(name);
  await shot(reva, "new-dialog");
  await dialog.getByRole("button", { name: "Создать команду" }).click();
  await expect(reva.getByText(`Команда «${name}»: добавлено 0, ждут согласия руководителя 3`).first()).toBeVisible();
  const [team] = await sql("SELECT id, kind, \"parentId\" FROM teams WHERE name = $1", [name]);
  expect(team!.kind).toBe("CUSTOM");
  // Каждого согласует его непосредственный руководитель по структуре
  const requests = await sql(
    `SELECT p."fullName" AS who, a."fullName" AS approver FROM team_join_requests r JOIN people p ON p.id = r."personId" JOIN people a ON a.id = r."approverId" WHERE r."teamId" = $1 AND r.status = 'PENDING' ORDER BY p."fullName"`,
    [team!.id],
  );
  expect(requests.map((r) => `${r.who}: ${r.approver}`)).toEqual(["Ершов Пётр: Крайник Александр", "Котов Игорь: Лисина Анна", "Лисина Анна: Ершов Пётр"]);
  // Карточка новой команды открылась сама
  const card = reva.getByTestId("team-card");
  await expect(card.getByRole("heading", { name, level: 2 })).toBeVisible();
  await expect(card.getByTestId("team-waiting")).toContainText("согласует Лисина Анна");
  const target = reva.getByTestId(`assemble-target-${team!.id}`);
  await expect(target).toContainText("в команде 1 человек, ждут согласия 3");

  // Свой человек из ветки входит сразу: на ноутбуке перетаскиванием, на телефоне кнопкой через поиск
  const tokov = await slugOf("Токов");
  if (isPhone()) {
    await card.getByRole("button", { name: "К списку команд" }).click();
    await reva.getByLabel("Найти человека или подразделение").fill("токов");
    await reva.getByTestId("assemble-found").getByRole("button", { name: "Токов Никита Андреевич: добавить в команду" }).click();
    await reva.getByRole("menuitem", { name }).click();
  } else {
    // Окно создания закрыто, помощник по-прежнему раскрыт (он помнит это сам): раскрываем департамент и управление
    await expect(reva.getByRole("dialog")).toHaveCount(0);
    await expect(helper).toHaveAttribute("open", "");
    const insToggle = ready.getByTestId(`unit-${ins}`).locator("button[aria-expanded]").first();
    await expect(insToggle).toContainText(INS);
    await insToggle.click();
    await expect(insToggle).toHaveAttribute("aria-expanded", "true");
    const product = ready.getByTestId(`unit-${await unitId("Управление продуктового развития (insurance)")}`).locator("button[aria-expanded]").first();
    await product.click();
    await expect(product).toHaveAttribute("aria-expanded", "true");
    await drag(reva, reva.getByTestId(`drag-person-${tokov}`), target);
  }
  const add = reva.getByRole("dialog", { name: `В команду «${name}»` });
  await expect(add).toContainText("Токов Никита Андреевич");
  await add.getByRole("button", { name: "Добавить" }).click();
  await expect(reva.getByText(`Команда «${name}»: добавлено 1`).first()).toBeVisible();
  await expect(target).toContainText("в команде 2 человека, ждут согласия 3");
  await expect(card.getByTestId("team-members")).toContainText("Токов Никита Андреевич");
  expect((await sql('SELECT external FROM team_members m JOIN people p ON p.id = m."personId" WHERE m."teamId" = $1 AND p.slug = $2', [team!.id, tokov]))[0]?.external).toBe(false);
  await shot(reva, "project");

  // Пустая команда из помощника: обычное окно создания, название обязательно
  if (isPhone()) await card.getByRole("button", { name: "К списку команд" }).click();
  await reva.getByTestId("assemble-new").click();
  const empty = reva.getByRole("dialog", { name: "Новая weekly-команда" });
  await expect(empty.getByRole("button", { name: "Создать команду" })).toBeDisabled();
  await empty.getByRole("textbox", { name: "Название команды" }).fill("Кросс-продажи");
  await empty.getByRole("button", { name: "Создать команду" }).click();
  // Карточка новой команды открывается переходом без перезагрузки страницы (этап 70): тост и раскрытое дерево
  // помощника на месте и после того, как карточка открылась
  await expect(reva.getByTestId("team-card").getByRole("heading", { name: "Кросс-продажи", level: 2 })).toBeVisible();
  await expect(reva.getByText("Команда «Кросс-продажи» создана").first()).toBeVisible();
  if (!isPhone()) await expect(ready.getByTestId(`unit-${ins}`).locator("button[aria-expanded]").first()).toHaveAttribute("aria-expanded", "true");
});

test("сотрудник Money: цифры прогноза закрыты, команды только для просмотра, под логотипом нет департамента", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await loadCompany(page);
  const kotov = await personal(browser, page, "Котов");
  // Сначала страница отрисовалась, потом проверяем, что подписи департамента нет
  await expect(kotov.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(kotov.getByText("Страхование и инвестиции")).toHaveCount(0);
  await kotov.goto("/forecast");
  await expect(kotov.getByTestId("forecast-closed")).toContainText("Прогноз по вашему направлению появится позже");
  await expect(kotov.getByTestId("forecast-closed")).toContainText("департамент страхования и инвестиций");
  await shot(kotov, "forecast-closed");
  const exported = await kotov.request.get("/forecast/export");
  expect(exported.status()).toBe(403);
  // Этап 64: вкладку команд видят все; прежний адрес проектов ведёт туда же. Своя команда только для просмотра
  await kotov.goto("/people/projects");
  await expect(kotov).toHaveURL(/\/people\/teams$/);
  await expect(kotov.getByTestId("people-tab-teams")).toBeVisible();
  await expect(kotov.getByTestId("teams-list")).toContainText("Управление кредитных продуктов");
  await expect(kotov.getByTestId("team-create")).toHaveCount(0);
  await expect(kotov.getByTestId("assemble")).toHaveCount(0);
  // Одна команда: переключателя в шапке нет, на его месте ссылка на экран команд
  await kotov.goto("/tasks");
  await kotov.getByTestId(isPhone() ? "team-manage-link-m" : "team-manage-link").click();
  await expect(kotov).toHaveURL(/\/people\/teams$/);

  // Сотрудник страхования с ролью сотрудника видит все цифры
  const tokov = await personal(browser, page, "Токов");
  await tokov.goto("/forecast");
  await expect(tokov.getByTestId("tab-month")).toBeVisible();
  await expect(tokov.getByTestId("forecast-closed")).toHaveCount(0);

  // Руководитель департамента Money: топ-менеджмент видит основные цифры, без вкладок с драйверами
  const ershov = await personal(browser, page, "Ершов");
  await ershov.goto("/forecast");
  await expect(ershov.getByTestId("forecast-summary")).toBeVisible();
  await expect(ershov.getByTestId("tab-month")).toHaveCount(0);
  await shot(ershov, "forecast-summary");
});

test("владелец настраивает доступ к цифрам; схема раскладывает подчинённых по подразделениям", async ({ page }) => {
  test.setTimeout(120_000);
  await loadCompany(page);
  await page.goto("/settings#numbers-access");
  const section = page.getByTestId("numbers-access-section");
  await expect(section).toBeVisible();
  await expect(section.getByTestId("numbers-access-counts")).toContainText("Сейчас все цифры видят");
  const full = section.getByRole("group", { name: "Все цифры" });
  await expect(full.getByRole("checkbox", { name: INS })).toBeChecked();
  await full.getByRole("checkbox", { name: "Департамент Money" }).check();
  await section.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Доступ к цифрам сохранён").first()).toBeVisible();
  const [row] = await sql("SELECT value FROM settings WHERE key = 'numbers.access'");
  expect((row!.value as { full: { units: string[] } }).full.units).toContain(await unitId("Департамент Money"));
  await shot(page, "numbers-access");

  // Схема: у руководителя департамента подчинённые разложены по управлениям с руководителем управления
  await page.goto(`/people/structure?person=${await slugOf("Ершов")}`);
  const tree = page.getByTestId("people-tree");
  await expect(tree.getByTestId("person-focus")).toContainText("Ершов Пётр");
  const credit = tree.getByTestId(`tree-unit-${await unitId("Управление кредитных продуктов")}`);
  await expect(credit).toContainText("Руководитель: Лисина Анна");
  await expect(credit.getByTestId(`person-${await slugOf("Лисина")}`)).toBeVisible();
  await shot(page, "tree-units");
});
