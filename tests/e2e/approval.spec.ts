import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 54: согласование задач в другие департаменты. Владелец включает согласование для финансов, руководитель из
// страхования ставит задачу сотруднице финансов, её руководитель согласует задачу. Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

const COMPANY = [
  ["ФИО", "Должность", "Департамент", "Управление", "Руководит"],
  ["Крайник Александр", "CEO", "", "", "да"],
  ["Мурадян Арам", "Директор департамента", "Департамент страхования и инвестиций", "", "да"],
  ["Рева Тарас Игоревич", "CPO", "Департамент страхования и инвестиций", "Управление продуктового развития (insurance)", "да"],
  ["Токов Никита Андреевич", "Analytics Lead", "Департамент страхования и инвестиций", "Управление продуктового развития (insurance)", ""],
  ["Харченко Артём", "CFO", "Финансовый департамент", "", "да"],
  ["Кацемба Наталья Сергеевна", "Chief Accountant", "Финансовый департамент", "Управление финансового учёта и контроля", "да"],
  ["Погосова Сабина Левоновна", "Finance coordinator", "Финансовый департамент", "Управление финансового учёта и контроля", ""],
]
  .map((r) => r.join("\t"))
  .join("\n");

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
});

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-a-${name}.png`, fullPage: true });
}

async function person(browser: Browser, page: Page, fullName: string) {
  const p = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: test.info().project.name === "phone" })).newPage();
  const [row] = await sql('SELECT slug FROM people WHERE "fullName" LIKE $1', [`${fullName}%`]);
  await enterByLink(p, row!.slug as string);
  return p;
}

test("этап 54: задача сотруднице другого департамента ждёт согласования её руководителя", async ({ page, browser }) => {
  test.setTimeout(120_000);
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
  // Владелец ставит Погосову в команду Ревы сразу
  const team = (await sql("SELECT id FROM teams WHERE name = 'Управление продуктового развития (insurance)'"))[0]!.id as string;
  const [pogosova] = await sql(`SELECT id FROM people WHERE "fullName" LIKE 'Погосова%'`);
  await sql(`INSERT INTO team_members ("teamId", "personId", external) VALUES ($1, $2, true)`, [team, pogosova!.id]);

  // Согласование для финансового департамента
  await page.goto("/settings#approval");
  const section = page.getByTestId("approval-section");
  await section.getByLabel("Финансовый департамент").selectOption("approve");
  await section.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Согласование задач сохранено").first()).toBeVisible();
  await shot(page, "settings");

  // Рева ставит задачу Погосовой в своей команде: задача уходит на согласование Кацембе
  const reva = await person(browser, page, "Рева");
  await reva.goto("/tasks");
  await reva.keyboard.press("n");
  const dialog = reva.getByRole("dialog", { name: "Новая задача" });
  await dialog.getByLabel("Команда").selectOption(team);
  await dialog.getByLabel("Задача").fill("Сверка комиссий партнёров");
  await dialog.getByLabel("Что нужно сделать").fill("Сверка за октябрь в таблице финансов");
  await dialog.getByLabel("Ответственный").selectOption({ label: "Погосова Сабина Левоновна" });
  await dialog.getByRole("button", { name: "Поставить задачу" }).click();
  await expect(reva.getByText(/отправлена на согласование: Кацемба Наталья/).first()).toBeVisible();
  await reva.close();
  const [task] = await sql(`SELECT number, status, "approvalState" FROM tasks WHERE title = 'Сверка комиссий партнёров'`);
  expect(task).toMatchObject({ status: "PROPOSED", approvalState: "PENDING" });

  // Погосова видит, что задача ждёт её руководителя, и принять её сама не может
  const worker = await person(browser, page, "Погосова");
  await worker.goto(`/tasks/${task!.number}`);
  await expect(worker.getByTestId("task-proposed")).toContainText("ждёт согласования: Кацемба Наталья");
  await worker.close();

  // Кацемба согласует из карточки задачи
  const boss = await person(browser, page, "Кацемба");
  await boss.goto(`/tasks/${task!.number}`);
  await expect(boss.getByTestId("task-confirm")).toContainText("Она станет задачей, когда вы её согласуете");
  await shot(boss, "confirm");
  await boss.getByRole("button", { name: "Согласовать", exact: true }).click();
  await expect(boss.getByTestId("task-approval")).toContainText("Согласовал руководитель ответственного");
  await boss.close();
  const [after] = await sql(`SELECT status, "approvalState" FROM tasks WHERE number = $1`, [task!.number]);
  expect(after).toMatchObject({ status: "IN_PROGRESS", approvalState: "APPROVED" });
});
