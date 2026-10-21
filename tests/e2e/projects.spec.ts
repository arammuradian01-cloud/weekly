import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 57: weekly-проекты. Готовые команды департаментов по структуре, Money и партнёрства отдельно. Руководитель
// забирает к себе целую команду или человека: свои входят сразу, люди других веток ждут согласия своего
// непосредственного руководителя. На ноутбуке перетаскиванием, на телефоне кнопкой «Добавить в проект».
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

test("руководитель собирает weekly-проект из готовой команды другого департамента и своего человека", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await loadCompany(page);
  const reva = await personal(browser, page, "Рева");
  await reva.goto("/people");
  await reva.getByTestId("people-tab-projects").click();
  await expect(reva).toHaveURL(/\/people\/projects$/);
  await expect(reva.getByRole("heading", { name: "Готовые команды по структуре" })).toBeVisible();
  // Money и партнёрства отдельными командами, рядом департамент страхования
  const money = await unitId("Департамент Money");
  const partners = await unitId("Департамент партнёрств");
  const ins = await unitId(INS);
  const ready = reva.getByTestId("ready-teams");
  await expect(ready.getByTestId(`unit-${money}`)).toContainText("Ершов Пётр, 3 человека");
  await expect(ready.getByTestId(`unit-${partners}`)).toContainText("Белова Ольга, 2 человека");
  await expect(ready.getByTestId(`unit-${ins}`)).toBeVisible();
  // Своя команда по структуре уже среди проектов
  await expect(reva.getByRole("heading", { name: "Управление продуктового развития (insurance)", level: 3 })).toBeVisible();
  await shot(reva, "start");

  const name = "Weekly: Департамент Money";
  if (isPhone()) {
    await ready.getByRole("button", { name: "Департамент Money, 3 человека: добавить в проект" }).click();
    await reva.getByRole("menuitem", { name: "Новый проект" }).click();
  } else {
    await drag(reva, reva.getByTestId(`drag-unit-${money}`), reva.getByTestId("project-new"));
  }
  const dialog = reva.getByRole("dialog", { name: "Новый weekly-проект" });
  await expect(dialog).toContainText("3 человека из «Департамент Money»");
  await expect(dialog.getByLabel("Название проекта")).toHaveValue(name);
  await shot(reva, "new-dialog");
  await dialog.getByRole("button", { name: "Создать проект" }).click();
  await expect(reva.getByText(`Проект «${name}»: добавлено 0, ждут согласия руководителя 3`).first()).toBeVisible();
  const [team] = await sql("SELECT id, kind, \"parentId\" FROM teams WHERE name = $1", [name]);
  expect(team!.kind).toBe("CUSTOM");
  // Каждого согласует его непосредственный руководитель по структуре
  const requests = await sql(
    `SELECT p."fullName" AS who, a."fullName" AS approver FROM team_join_requests r JOIN people p ON p.id = r."personId" JOIN people a ON a.id = r."approverId" WHERE r."teamId" = $1 AND r.status = 'PENDING' ORDER BY p."fullName"`,
    [team!.id],
  );
  expect(requests.map((r) => `${r.who}: ${r.approver}`)).toEqual(["Ершов Пётр: Крайник Александр", "Котов Игорь: Лисина Анна", "Лисина Анна: Ершов Пётр"]);
  const card = reva.getByTestId(`project-${team!.id}`);
  await expect(card).toContainText("Котов Игорь: ждёт согласия, Лисина Анна");
  await expect(card).toContainText("0 участников, ждут согласия 3");

  // Свой человек из ветки входит сразу: на ноутбуке перетаскиванием, на телефоне кнопкой через поиск
  const tokov = await slugOf("Токов");
  if (isPhone()) {
    await reva.getByLabel("Найти человека или подразделение").fill("токов");
    await reva.getByTestId("projects-found").getByRole("button", { name: "Токов Никита Андреевич: добавить в проект" }).click();
    await reva.getByRole("menuitem", { name }).click();
  } else {
    await ready.getByRole("button", { name: new RegExp(`^${INS}`) }).click();
    await reva.getByRole("button", { name: /^Управление продуктового развития \(insurance\)/ }).click();
    await drag(reva, reva.getByTestId(`drag-person-${tokov}`), card);
  }
  const add = reva.getByRole("dialog", { name: `В проект «${name}»` });
  await expect(add).toContainText("Токов Никита Андреевич");
  await add.getByRole("button", { name: "Добавить" }).click();
  await expect(reva.getByText(`Проект «${name}»: добавлено 1`).first()).toBeVisible();
  await expect(card).toContainText("1 участник, ждут согласия 3");
  expect((await sql('SELECT external FROM team_members m JOIN people p ON p.id = m."personId" WHERE m."teamId" = $1 AND p.slug = $2', [team!.id, tokov]))[0]?.external).toBe(false);
  await shot(reva, "project");

  // Человека убирают из проекта крестиком
  await card.getByRole("button", { name: `Убрать из проекта «${name}»: Токов Никита Андреевич` }).click();
  await expect(reva.getByText("Токов Никита Андреевич убран из проекта").first()).toBeVisible();
  await expect(card).toContainText("0 участников, ждут согласия 3");

  // Пустой проект кнопкой: название обязательно
  await reva.getByTestId("project-new").click();
  const empty = reva.getByRole("dialog", { name: "Новый weekly-проект" });
  await empty.getByLabel("Название проекта").fill("");
  await expect(empty.getByRole("button", { name: "Создать проект" })).toBeDisabled();
  await empty.getByLabel("Название проекта").fill("Кросс-продажи");
  await empty.getByRole("button", { name: "Создать проект" }).click();
  await expect(reva.getByText("Проект «Кросс-продажи» создан").first()).toBeVisible();
  await expect(reva.getByRole("heading", { name: "Кросс-продажи", level: 3 })).toBeVisible();
});

test("сотрудник Money: цифры прогноза закрыты, проектов не собирает, под логотипом нет департамента", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await loadCompany(page);
  const kotov = await personal(browser, page, "Котов");
  await expect(kotov.getByText("Страхование и инвестиции")).toHaveCount(0);
  await kotov.goto("/forecast");
  await expect(kotov.getByTestId("forecast-closed")).toContainText("Прогноз по вашему направлению появится позже");
  await expect(kotov.getByTestId("forecast-closed")).toContainText("департамент страхования и инвестиций");
  await shot(kotov, "forecast-closed");
  const exported = await kotov.request.get("/forecast/export");
  expect(exported.status()).toBe(403);
  await kotov.goto("/people/structure");
  await expect(kotov.getByTestId("people-tab-projects")).toHaveCount(0);
  // По адресу страница открывается только для просмотра структуры
  await kotov.goto("/people/projects");
  await expect(kotov.getByText("Собирать weekly-проекты могут руководители, войдя лично.")).toBeVisible();
  await expect(kotov.getByTestId("project-new")).toHaveCount(0);

  // Сотрудник страхования с ролью сотрудника цифры видит
  const tokov = await personal(browser, page, "Токов");
  await tokov.goto("/forecast");
  await expect(tokov.getByTestId("forecast-closed")).toHaveCount(0);
});
