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
  await modal.getByLabel("Команда").selectOption({ label: "Топ-команда" });
  await modal.getByLabel("Цель", { exact: true }).fill("Маржа департамента 150 млн");
  await modal.getByLabel("Номер").fill("D1");
  await modal.getByLabel("База").fill("120");
  await modal.getByLabel("Целевое значение").fill("150");
  await modal.getByRole("button", { name: "Завести цель" }).click();
  await expect(page.getByText("Цель заведена").first()).toBeVisible();
  await expect(page.getByRole("main").getByText("Маржа департамента 150 млн")).toBeVisible();

  // Руководитель сектора видит цель департамента и заводит цель ниже
  const antonov = await person(browser, page, "Антонов");
  await antonov.goto("/goals");
  await expect(antonov.getByRole("main").getByText("Маржа департамента 150 млн")).toBeVisible();
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
  await dialog.getByLabel("Ответственный").selectOption({ label: "Чемоданова Алиса" });
  await dialog.getByRole("button", { name: "Поставить задачу" }).click();
  await expect(antonov.getByText(/Задача \d+ создана/).first()).toBeVisible();
  const [task] = await sql("SELECT number FROM tasks WHERE title = 'Выкатить форму на весь трафик'");
  await antonov.goto(`/tasks/${task!.number}`);
  await antonov.getByRole("button", { name: "Выбрать цель" }).click();
  const [goal] = await sql("SELECT id FROM goals WHERE title = 'Новая форма расчёта на всём трафике'");
  await antonov.getByLabel("Цель команды или команды выше").selectOption(goal!.id as string);
  await expect(antonov.getByText(/Задача работает на цель/).first()).toBeVisible();

  // Дерево целей: прогресс у цели сектора и у цели департамента
  await antonov.goto("/goals");
  await expect(antonov.getByText("задач закрыто 0 из 1").first()).toBeVisible();
  await antonov.getByRole("button", { name: "Развернуть: Новая форма расчёта на всём трафике" }).click();
  await expect(antonov.getByRole("main").getByText("Выкатить форму на весь трафик")).toBeVisible();
  await shot(antonov, "tree");
  await antonov.close();
});
