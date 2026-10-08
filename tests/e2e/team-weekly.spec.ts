import { expect, test, type Browser, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterByLink, resetDatabase, sql } from "./helpers";

// Этап 15: weekly команд. Руководитель сектора включает weekly специалистов и свой срок, специалист пишет запись,
// руководитель поднимает её наверх, руководитель выше видит её в ленте своей команды. Ноутбук 1440 и телефон 360

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
  await resetDatabase({ tasks: false });
  const dir = mkdtempSync(join(tmpdir(), "structure-"));
  const file = join(dir, "structure.tsv");
  writeFileSync(file, STRUCTURE);
  execSync(`npx tsx scripts/load-structure.ts ${file} --yes`, { env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL }, stdio: "ignore" });
});

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-t-${name}.png`, fullPage: true });
}

async function person(browser: Browser, page: Page, fullName: string) {
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: test.info().project.name === "phone" });
  const p = await ctx.newPage();
  const [row] = await sql('SELECT slug FROM people WHERE "fullName" LIKE $1', [`${fullName}%`]);
  await enterByLink(p, row!.slug as string);
  return p;
}

test("руководитель сектора включает weekly специалистов, поднимает запись наверх, руководитель выше видит её у себя", async ({ page, browser }) => {
  // Длинный сценарий двух людей: на нагруженной машине близко к 30 секундам по умолчанию
  test.setTimeout(60_000);
  const phone = test.info().project.name === "phone";

  // Ритм сектора: свой срок в пятницу и weekly специалистов
  const antonov = await person(browser, page, "Антонов");
  await antonov.goto("/structure");
  await antonov.getByRole("radio", { name: /Команды/ }).click();
  await antonov.getByRole("button", { name: "Показать участников: Сектор автострахования" }).click();
  await expect(antonov.getByText("Weekly в этой команде не ждём")).toBeVisible();
  await antonov.getByRole("button", { name: "Ритм weekly" }).click();
  const modal = antonov.getByRole("dialog", { name: /Ритм weekly/ });
  await modal.getByLabel("Когда").first().selectOption("own");
  await modal.locator("#rh-deadline-week").selectOption("0");
  await modal.locator("#rh-deadline-day").selectOption("5");
  await modal.locator("#rh-deadline-time").fill("16:00");
  await modal.getByLabel(/Weekly сдают и специалисты/).check();
  await shot(antonov, "rhythm");
  await modal.getByRole("button", { name: "Сохранить" }).click();
  await expect(antonov.getByText("Ритм команды сохранён").first()).toBeVisible();
  await expect(antonov.getByText(/Weekly: сдали 0 из 1.*пт, 16:00/)).toBeVisible();
  await shot(antonov, "structure-lights");

  // Специалист пишет запись: weekly от неё теперь ждут в секторе
  const alisa = await person(browser, page, "Чемоданова");
  await alisa.goto("/weekly/submit");
  await expect(alisa.getByText("Сдаёте в команду: Сектор автострахования")).toBeVisible();
  await alisa.getByRole("button", { name: "Добавить запись" }).click();
  await alisa.getByLabel("Что произошло").fill("Согласовали макет формы расчёта ОСАГО");
  await expect(alisa.getByText("Черновик записи сохранён")).toBeVisible({ timeout: 8000 });
  await alisa.close();

  // Руководитель сектора поднимает запись в свой weekly с фразой от себя
  await antonov.goto("/weekly");
  const card = antonov.getByRole("main").locator("li", { hasText: "Согласовали макет формы расчёта ОСАГО" }).first();
  await card.getByRole("button", { name: "Наверх" }).click();
  await card.getByLabel("От себя одной фразой, если нужно").fill("Форма выйдет в релиз 20 октября");
  await card.getByRole("button", { name: "Поднять в мой weekly" }).click();
  await expect(antonov.getByText("Запись поднята в ваш weekly").first()).toBeVisible();
  await expect(card.getByText("В вашем weekly")).toBeVisible();
  await shot(antonov, "lead-feed");
  await antonov.goto("/weekly/submit");
  await expect(antonov.getByRole("heading", { name: /Из команды/ })).toBeVisible();
  await expect(antonov.getByText("Форма выйдет в релиз 20 октября")).toBeVisible();
  await shot(antonov, "lead-submit");

  // Неделю сектора руководитель закрывает после встречи команды
  await antonov.goto("/weekly");
  await antonov.getByRole("button", { name: "Закрыть неделю команды" }).click();
  await expect(antonov.getByText(/команды закрыта/).first()).toBeVisible();
  await antonov.close();

  // Рева в ленте своей команды видит запись Алисы у Антонова, с его фразой
  const reva = await person(browser, page, "Рева");
  const revaTeam = (await sql("SELECT id FROM teams WHERE name = 'Управление развития продуктов'"))[0]!.id as string;
  await reva.goto("/weekly");
  await reva.locator(phone ? "#team-switcher-m" : "#team-switcher").selectOption(revaTeam);
  await expect(reva.getByRole("heading", { name: "Антонов Дмитрий" })).toBeVisible();
  const fromTeam = reva.getByRole("main").getByRole("heading", { name: /Из команды/ });
  await expect(fromTeam).toBeVisible();
  await expect(reva.getByText("Согласовали макет формы расчёта ОСАГО")).toBeVisible();
  await expect(reva.getByText("Форма выйдет в релиз 20 октября")).toBeVisible();
  // Рева может поднять её дальше, в топ-команду
  await expect(reva.getByRole("button", { name: "Наверх" })).toBeVisible();
  await shot(reva, "upper-feed");
  await reva.close();
});
