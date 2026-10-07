import { expect, test, type Browser, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterByLink, resetDatabase, sql } from "./helpers";

// Этап 16: панель «Мои команды». Руководитель управления видит просроченную задачу сектора в «Требует внимания»,
// просит ответственного обновить её, ответственный получает событие в «Мне». Ноутбук 1440 и телефон 360

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
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-m-${name}.png`, fullPage: true });
}

async function person(browser: Browser, page: Page, fullName: string) {
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: test.info().project.name === "phone" });
  const p = await ctx.newPage();
  const [row] = await sql('SELECT slug FROM people WHERE "fullName" LIKE $1', [`${fullName}%`]);
  await enterByLink(p, row!.slug as string);
  return p;
}

test("руководитель видит просрочку сектора в «Мои команды», просит обновить, ответственный получает событие", async ({ page, browser }) => {
  // Руководитель сектора ставит задачу специалисту, срок задним числом сдвигаем в прошлое
  const antonov = await person(browser, page, "Антонов");
  await antonov.goto("/tasks");
  await antonov.keyboard.press("n");
  const dialog = antonov.getByRole("dialog", { name: "Новая задача" });
  await dialog.getByLabel("Задача").fill("Обновить калькулятор ОСАГО");
  await dialog.getByLabel("Что нужно сделать").fill("Новые коэффициенты в калькуляторе");
  await dialog.getByLabel("Ответственный").selectOption({ label: "Чемоданова Алиса" });
  await dialog.getByRole("button", { name: "Поставить задачу" }).click();
  await expect(antonov.getByText(/Задача \d+ создана/).first()).toBeVisible();
  await antonov.close();
  const [task] = await sql("SELECT number FROM tasks WHERE title = 'Обновить калькулятор ОСАГО'");
  await sql("UPDATE tasks SET due = (now() AT TIME ZONE 'Europe/Moscow')::date - 3 WHERE number = $1", [task!.number]);

  // Рева открывает панель из меню: своя команда, сектор ниже, просрочка в «Требует внимания»
  const reva = await person(browser, page, "Рева");
  await reva.getByRole("link", { name: "Мои команды" }).locator("visible=true").first().click();
  await expect(reva).toHaveURL(/\/my-teams$/);
  await expect(reva.getByRole("main").getByText("Управление развития продуктов", { exact: true }).first()).toBeVisible();
  await expect(reva.getByRole("link", { name: "Сектор автострахования" })).toBeVisible();
  const attention = reva.getByRole("main").locator("section", { has: reva.getByRole("heading", { name: /Требует внимания/ }) });
  await expect(attention.getByText("Обновить калькулятор ОСАГО")).toBeVisible();
  await expect(attention.getByText("просрочена на 3 дн.")).toBeVisible();
  await shot(reva, "panel");
  await attention.getByRole("button", { name: "Попросить обновить" }).click();
  await expect(reva.getByText(/Просьба ушла: Чемоданова Алиса/).first()).toBeVisible();

  // Спуск в сектор: люди сектора и их задачи
  await reva.getByRole("link", { name: "Сектор автострахования" }).click();
  await expect(reva).toHaveURL(/\/my-teams\?team=/);
  await reva.getByRole("button", { name: "Показать задачи: Чемоданова Алиса" }).click();
  await expect(reva.getByRole("main").getByText("Обновить калькулятор ОСАГО").first()).toBeVisible();
  await shot(reva, "panel-sector");

  // Карточка задачи: подписка и история статусов
  await reva.goto(`/tasks/${task!.number}`);
  await expect(reva.getByText("Сколько была в каждом статусе")).toBeVisible();
  await reva.getByRole("button", { name: "Следить за задачей" }).click();
  await expect(reva.getByText(/Вы следите за задачей/).first()).toBeVisible();
  await reva.close();

  // Ответственный видит просьбу в «Мне»
  const alisa = await person(browser, page, "Чемоданова");
  await alisa.goto("/me");
  await expect(alisa.getByText("Просят обновить задачу: где сейчас, состояние и срок")).toBeVisible();
  await alisa.close();
});
