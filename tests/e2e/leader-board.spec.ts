import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import ExcelJS from "exceljs";
import { enter, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 31: цели квартала из файла борда лидера. Владелец загружает .xlsx, видит, чьи цели и что не взято, загружает;
// задачу Ревы привязывают к её личной цели, в списке задач видна метка цели и группировка «По цели».
// Данные выдуманы, формат как в настоящих бордах. Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });
const phone = () => test.info().project.name === "phone";

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-lb-${name}.png`, fullPage: true });
}

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Файл борда: лист с зарплатами, вкладка целей Ревы и вкладка без владельца. Раздел текущего квартала */
async function boardBuffer(): Promise<Buffer> {
  const msk = new Date(Date.now() + 3 * 3_600_000);
  const q = Math.floor(msk.getUTCMonth() / 3) + 1;
  const header = ["№", "Направление", `Запланировано на ${q}Q`, "Артефакт/описание", "Start", "Целевые"];
  const book = new ExcelJS.Workbook();
  const salary = book.addWorksheet("INS CPO_новая");
  salary.addRow(["Сотрудник", "Заработная плата"]);
  salary.addRow(["Рева Тарас", "р.999 999"]);
  book.addWorksheet("Цели и мотивация").addRow(["Gross Salary", "330 000"]);
  const cpo = book.addWorksheet("Цели CPO");
  for (const row of [["", "", "CPO - Рева Тарас"], [], header, ["1", "Product", "Подписка ОСАГО запущена и имеет P&L", "Проблема: рынок идёт в короткие полисы", "", "P&L к 15.12"], ["2", "Data", "Скоринг на проде", "", "", "до 15.12"], [], ["№", "Направление", "Договоренности"], ["1", "", "Не цель"]]) cpo.addRow(row);
  const tm = book.addWorksheet("Цели Telemarketing Unit");
  for (const row of [["На кого???", "Еще не утвердили"], header, ["1", "", "Цель без владельца"]]) tm.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
  await sql("DELETE FROM goals");
});

test("цели Q4 из файла борда лидера, задача с личной целью и метка цели в списке", async ({ page }) => {
  test.setTimeout(90_000);
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/goals");
  await page.getByRole("button", { name: "Загрузить цели" }).click();
  const drawer = page.getByRole("dialog", { name: "Загрузить цели" });
  await drawer.getByRole("radio", { name: "Файл борда лидера" }).click();
  await expect(drawer.getByText(/Вкладки с зарплатами, мотивацией, оценками и премиями не читаются/)).toBeVisible();
  // Файл передаётся содержимым: путь во временной папке браузеру в песочнице не виден
  await drawer.getByLabel("Файл борда лидера").setInputFiles({ name: "Борд лидера INS CPO.xlsx", mimeType: XLSX, buffer: await boardBuffer() });
  await drawer.getByRole("button", { name: "Проверить" }).click();
  await expect(drawer.getByText("Новых целей 2, изменится 0, без изменений 0")).toBeVisible();
  await expect(drawer.getByText(/Рева Тарас: целей 2, команда «Топ-команда». Вкладка «Цели CPO»/)).toBeVisible();
  await expect(drawer.getByText(/«Цели Telemarketing Unit»: В шапке вкладки не указан владелец/)).toBeVisible();
  await expect(drawer.getByText(/«Цели и мотивация»: Вкладка с мотивацией, оценками или оплатой: не читается/)).toBeVisible();
  await expect(drawer.getByText(/999 999|330 000|Salary/)).toHaveCount(0);
  await shot(page, "preview");
  await drawer.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByText("Цели загружены: новых 2, изменено 0")).toBeVisible();
  // В дереве целей: код, название, владелец и целевое значение из борда
  const tree = page.getByRole("list", { name: "Дерево целей" });
  await expect(tree.getByText(/^РТ-1\s*Подписка ОСАГО запущена и имеет P&L$/)).toBeVisible();
  await expect(tree.getByText("Топ-команда, владелец Рева Тарас, цель P&L к 15.12")).toBeVisible();

  // Задача Ревы в топ-команде: к ней можно привязать её личную цель
  const [task] = await sql(`SELECT t.number FROM tasks t JOIN people p ON p.id = t."ownerId" WHERE p.slug = 'reva' AND t."archivedAt" IS NULL AND t.status IN ('IN_PROGRESS', 'CLARIFY') ORDER BY t.number LIMIT 1`);
  const number = task!.number as number;
  await page.goto(`/tasks/${number}`);
  await page.getByRole("button", { name: "Выбрать цель" }).click();
  const select = page.getByLabel("Цель команды, команды выше или личная цель");
  const option = select.locator("option", { hasText: "личная цель Рева Тарас: РТ-1. Подписка ОСАГО" });
  await select.selectOption({ value: (await option.getAttribute("value"))! });
  await expect(page.getByText("Задача работает на цель: Подписка ОСАГО запущена и имеет P&L")).toBeVisible();

  // В списке задач метка цели, группировка «По цели»
  await page.goto(`/tasks?q=${number}`);
  const tag = page.getByRole("link", { name: "Цель РТ-1: Подписка ОСАГО запущена и имеет P&L" }).locator("visible=true");
  await expect(tag).toHaveText("Цель РТ-1");
  await page.getByLabel("Группировать").selectOption("goal");
  await expect(page.getByText("Цель РТ-1. Подписка ОСАГО запущена и имеет P&L").locator("visible=true").first()).toBeVisible();
  await shot(page, "tasks-tag");
  // Метка ведёт к цели
  await tag.click();
  await expect(page).toHaveURL(/\/goals\?q=\d{4}-Q\d#goal-/);
});

test("без режима управления файл борда не загрузить", async ({ page }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/goals");
  const upload = page.getByRole("button", { name: "Загрузить цели" });
  if (await upload.count()) {
    await upload.click();
    await expect(page.getByRole("dialog", { name: "Загрузить цели" }).getByRole("radio", { name: "Файл борда лидера" })).toHaveCount(0);
  }
  // И прямой запрос на сервер не пройдёт
  const res = await page.request.post("/api/goals/leader-board", { multipart: { file: { name: "b.xlsx", mimeType: XLSX, buffer: await boardBuffer() }, team: "top", quarter: "", mode: "apply" } });
  expect(res.status()).toBe(403);
  expect(await res.json()).toMatchObject({ ok: false, error: expect.stringMatching(/режиме управления/) });
  expect((await sql("SELECT count(*)::int AS n FROM goals"))[0]!.n).toBe(0);
  // Права проверяются до чтения файла: на испорченный файл тот же ответ, а не «файл не читается»
  const junk = await page.request.post("/api/goals/leader-board", { multipart: { file: { name: "b.xlsx", mimeType: XLSX, buffer: Buffer.from("это не xlsx") }, team: "top", quarter: "", mode: "preview" } });
  expect(await junk.json()).toMatchObject({ ok: false, error: expect.stringMatching(/режиме управления/) });
  // Запрос с чужого сайта отклоняется, и «Origin: null» не ломает сервер
  for (const origin of ["https://evil.example", "null"]) {
    const other = await page.request.post("/api/goals/leader-board", { headers: { origin }, multipart: { file: { name: "b.xlsx", mimeType: XLSX, buffer: Buffer.from("x") }, team: "top", quarter: "", mode: "preview" } });
    expect(other.status()).toBe(403);
  }
});
