import { expect, test, type Browser, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enter, enterByLink, resetDatabase, sql } from "./helpers";

// Этап 28: встречи один на один. Человек ставит тему, руководитель видит её в «Мне», назначает встречу, записывает
// итог и задачу, заметки общие и личные, завершает встречу. Ноутбук 1440 и телефон 360

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

const phone = () => test.info().project.name === "phone";

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-oo-${name}.png`, fullPage: true });
}

async function person(browser: Browser, page: Page, fullName: string) {
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: phone(), hasTouch: phone() });
  const p = await ctx.newPage();
  const [row] = await sql('SELECT slug FROM people WHERE "fullName" LIKE $1', [`${fullName}%`]);
  await enterByLink(p, row!.slug as string);
  return p;
}

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
  await sql("DELETE FROM one_on_one_pairs");
  const dir = mkdtempSync(join(tmpdir(), "structure-"));
  const file = join(dir, "structure.tsv");
  writeFileSync(file, STRUCTURE);
  execSync(`npx tsx scripts/load-structure.ts ${file} --yes`, { env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL }, stdio: "ignore" });
});

test("человек ставит тему, руководитель проводит встречу: итог, задача, заметки, завершение и перенос открытых тем", async ({ page, browser }) => {
  // Антонов ставит тему встречи со своим руководителем
  const antonov = await person(browser, page, "Антонов");
  if (phone()) await antonov.goto("/one-on-one");
  else await antonov.getByRole("link", { name: "Один на один" }).locator("visible=true").first().click();
  await expect(antonov.getByRole("heading", { name: "С руководителем" })).toBeVisible();
  await antonov.getByRole("link", { name: /Рева Тарас/ }).click();
  await expect(antonov.getByRole("heading", { name: /Один на один: Рева Тарас/ })).toBeVisible();
  await antonov.getByLabel("Новая тема").fill("Хочу обсудить нагрузку сектора на ноябрь");
  await antonov.getByRole("button", { name: "Добавить тему" }).click();
  await expect(antonov.getByText("Тема добавлена в повестку").first()).toBeVisible();
  await expect(antonov.getByRole("listitem", { name: "Тема: Хочу обсудить нагрузку сектора на ноябрь" })).toBeVisible();

  // Рева видит тему в «Мне» и открывает встречу оттуда
  const reva = await person(browser, page, "Рева");
  await reva.goto("/me");
  await expect(reva.getByText("Тема для встречи один на один: «Хочу обсудить нагрузку сектора на ноябрь»")).toBeVisible();
  await reva.getByRole("link", { name: "Один на один: Антонов Дмитрий" }).click();
  await expect(reva.getByRole("heading", { name: /Один на один: Антонов Дмитрий/ })).toBeVisible();
  // Итог темы без встречи не записать: сначала назначить
  await expect(reva.getByRole("button", { name: "Обсудили" })).toBeDisabled();
  await reva.getByRole("button", { name: "Назначить" }).click();
  await expect(reva.getByText(/Встреча назначена на/).first()).toBeVisible();

  // Своя тема руководителя и задача из неё
  await reva.getByLabel("Новая тема").fill("Цели сектора на квартал");
  await reva.getByRole("button", { name: "Добавить тему" }).click();
  const goals = reva.getByRole("listitem", { name: "Тема: Цели сектора на квартал" });
  await goals.getByRole("button", { name: "Поставить задачу" }).click();
  const dialog = reva.getByRole("dialog", { name: "Поставить задачу из темы" });
  await dialog.getByLabel("Что нужно сделать").fill("Три цели сектора с метриками и сроками");
  await dialog.getByRole("button", { name: "Поставить задачу" }).click();
  await expect(reva.getByText("Задача поставлена").first()).toBeVisible();
  await expect(goals.getByRole("link", { name: /задача \d+/ })).toBeVisible();

  // Итог темы Антонова
  const load = reva.getByRole("listitem", { name: "Тема: Хочу обсудить нагрузку сектора на ноябрь" });
  await load.getByRole("button", { name: "Обсудили" }).click();
  await load.getByLabel("О чём договорились").fill("Переносим часть задач на декабрь, ищем ещё одного дизайнера");
  await load.getByRole("button", { name: "Сохранить итог" }).click();
  await expect(reva.getByText("Тема обсуждена").first()).toBeVisible();

  // Заметки: общие видят оба, личные только автор
  await reva.getByLabel("Общие заметки").fill("Нагрузка выше плана на 20%");
  await reva.getByLabel("Мои личные заметки").fill("Подумать о повышении Антонова");
  await reva.getByRole("button", { name: "Сохранить заметки" }).click();
  await expect(reva.getByText("Заметки сохранены").first()).toBeVisible();
  // Запоздавшее обновление страницы не стирает сохранённые общие заметки
  await reva.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await reva.waitForTimeout(1000);
  await expect(reva.getByLabel("Общие заметки")).toHaveValue("Нагрузка выше плана на 20%");
  await expect(reva.getByRole("listitem", { name: "Тема: Хочу обсудить нагрузку сектора на ноябрь" })).toHaveCount(0);
  await shot(reva, "meeting");

  // Завершить встречу: следующая через неделю, незакрытая тема остаётся в повестке
  await reva.getByRole("button", { name: "Завершить встречу" }).click();
  await reva.getByRole("dialog", { name: "Завершить встречу?" }).getByRole("button", { name: "Завершить и назначить" }).click();
  await expect(reva.getByText(/Встреча завершена, следующая/).first()).toBeVisible();
  const history = reva.getByRole("main").locator("section", { has: reva.getByRole("heading", { name: /Прошлые встречи/ }) });
  await expect(history.getByText("Переносим часть задач на декабрь, ищем ещё одного дизайнера")).toBeVisible();
  await expect(history.getByText("Подумать о повышении Антонова")).toBeVisible();
  await expect(reva.getByRole("listitem", { name: "Тема: Цели сектора на квартал" })).toBeVisible();
  await reva.close();

  // Антонов видит итог и общие заметки, но не личную заметку руководителя
  await antonov.reload();
  const hist = antonov.getByRole("main").locator("section", { has: antonov.getByRole("heading", { name: /Прошлые встречи/ }) });
  await expect(hist.getByText("Переносим часть задач на декабрь, ищем ещё одного дизайнера")).toBeVisible();
  await expect(hist.getByText("Нагрузка выше плана на 20%")).toBeVisible();
  await expect(antonov.getByText("Подумать о повышении Антонова")).toHaveCount(0);
  await shot(antonov, "history");
  await antonov.close();
});

test("по общему логину встречи закрыты, руководитель открывает встречу из карточки лидера в аналитике", async ({ page, browser }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/one-on-one");
  await expect(page.getByText("Встречи один на один открываются только при личном входе")).toBeVisible();

  const reva = await person(browser, page, "Рева");
  await reva.goto("/analytics");
  const card = reva.getByRole("main").getByRole("listitem", { name: "Карточка: Антонов Дмитрий" });
  await card.getByRole("link", { name: "Один на один" }).click();
  await expect(reva.getByRole("heading", { name: /Один на один: Антонов Дмитрий/ })).toBeVisible();
  // Цифры для разговора: та же карточка, что в аналитике
  await expect(reva.getByRole("heading", { name: "Цифры для разговора" })).toBeVisible();
  await reva.close();
});
