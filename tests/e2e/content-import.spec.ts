import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase } from "./helpers";

// Этап 67: импорт наполнения. Владелец при личном входе в режиме управления выбирает файл пакета в «Настройках»
// (синтетический tests/fixtures/content-import/package.json, данные выдуманные), видит предпросмотр: что добавится,
// обновится и пропустится, кого нет в ресурсе. Загружает по кнопке, новые задачи видны в списке задач. Повторный
// выбор того же файла: загружать нечего. Без режима управления, по общему логину и администратору раздела нет,
// обработчик отвечает отказом. Ноутбук 1440 и телефон 360 без горизонтальной прокрутки

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });
const PACKAGE = "tests/fixtures/content-import/package.json";
const isPhone = () => test.info().project.name === "phone";

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-content-import-${name}.png`, fullPage: true });
}

async function newPage(browser: Browser, page: Page) {
  return (await browser.newContext({ viewport: page.viewportSize()!, isMobile: isPhone(), hasTouch: isPhone() })).newPage();
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("владелец видит предпросмотр, загружает пакет, повтор того же пакета ничего не добавляет", async ({ page }) => {
  test.setTimeout(150_000);
  await enterByLink(page, "muradyan");
  await enterManagement(page, "owner");
  await page.goto("/settings#content-import");
  const section = page.getByTestId("content-import");
  await expect(section.getByRole("heading", { name: "Импорт наполнения" })).toBeVisible();

  await section.locator("#content-import-file").setInputFiles(PACKAGE);
  const preview = section.getByTestId("content-import-preview");
  await expect(preview).toBeVisible();
  await expect(preview.getByText("Что даст загрузка: Синтетический пакет для тестов")).toBeVisible();
  await expect(preview.getByTestId("content-import-tasks")).toHaveText("Задачи: добавится 4, обновится 0, пропустится 1");
  await expect(preview.getByTestId("content-import-decisions")).toHaveText("Решения: добавится 2, обновится 0, пропустится 0");
  await expect(preview.getByTestId("content-import-goals")).toHaveText("Цели: добавится 2, обновится 0, пропустится 0");
  await expect(preview.getByTestId("content-import-links")).toHaveText("Связи задач с целями: добавится 2, обновится 0, пропустится 0");
  await expect(preview.getByTestId("content-import-missing-people")).toContainText("Иванов Пётр, Сидоров Никто");
  await preview.getByText(/Подробнее: что пропустится и почему/).click();
  await expect(preview.getByTestId("content-import-notes")).toContainText("ответственный «Иванов Пётр» не найден в ресурсе");
  await shot(page, "preview");
  await section.screenshot({ path: `${SHOTS}/${test.info().project.name}-content-import-section.png` });

  await preview.getByTestId("content-import-apply").click();
  const done = section.getByTestId("content-import-done");
  await expect(done).toBeVisible();
  await expect(done.getByText("Загружено")).toBeVisible();
  await expect(done.getByText(/Номера новых задач:/)).toBeVisible();
  await shot(page, "done");

  // Новая задача открывается по номеру: первая задача пакета получила следующий номер после задач из Bord
  await page.goto("/tasks/52");
  await expect(page.getByRole("heading", { name: /Собрать тестовую сводку по выдуманным партнёрам/ })).toBeVisible();

  // Тот же файл ещё раз: всё уже загружено
  await page.goto("/settings#content-import");
  await page.getByTestId("content-import").locator("#content-import-file").setInputFiles(PACKAGE);
  const again = page.getByTestId("content-import-preview");
  await expect(again.getByTestId("content-import-tasks")).toHaveText("Задачи: добавится 0, обновится 0, пропустится 5");
  await expect(again.getByTestId("content-import-apply")).toBeDisabled();
  await expect(again.getByTestId("content-import-apply")).toHaveText("Нечего загружать");
});

test("пакет с ошибками: список ошибок, база не тронута", async ({ page }) => {
  await enterByLink(page, "muradyan");
  await enterManagement(page, "owner");
  await page.goto("/settings#content-import");
  const broken = JSON.parse(readFileSync(PACKAGE, "utf8")) as { tasks: Record<string, unknown>[] };
  broken.tasks[1]!.resolution = "";
  broken.tasks[0]!.due = "15.12.2026";
  await page.getByTestId("content-import").locator("#content-import-file").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(broken)) });
  await expect(page.getByText(/В пакете ошибки: 2/)).toBeVisible();
  const problems = page.getByTestId("content-import-problems");
  await expect(problems).toContainText("«Срок» не дата в виде ГГГГ-ММ-ДД");
  await expect(problems).toContainText("для статуса «done» нужен итог или причина");
  await expect(page.getByTestId("content-import-preview")).toHaveCount(0);
  await shot(page, "errors");
});

test("без режима управления, по общему логину и администратору раздела нет, обработчик отказывает", async ({ page, browser }) => {
  // Владелец лично, но без режима управления: настройки закрыты
  await enterByLink(page, "muradyan");
  const res = await page.request.post("/api/content-import?mode=preview", { headers: { "Content-Type": "application/json" }, data: readFileSync(PACKAGE) });
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toBe("Наполнение загружает владелец при личном входе в режиме управления");

  // Общий логин с режимом управления владельца: остальные настройки есть, импорта нет
  const team = await newPage(browser, page);
  await enter(team, "Мурадян Арам");
  await enterManagement(team, "owner");
  await team.goto("/settings");
  await expect(team.getByRole("heading", { name: "Настройки" })).toBeVisible();
  await expect(team.getByTestId("content-import")).toHaveCount(0);
  const teamRes = await team.request.post("/api/content-import?mode=apply", { headers: { "Content-Type": "application/json" }, data: readFileSync(PACKAGE) });
  expect(teamRes.status()).toBe(403);

  // Администратор в режиме управления: раздела нет
  const admin = await newPage(browser, page);
  await enter(admin, "Головкин Владислав");
  await enterManagement(admin, "admin");
  await admin.goto("/settings");
  await expect(admin.getByRole("heading", { name: "Настройки" })).toBeVisible();
  await expect(admin.getByTestId("content-import")).toHaveCount(0);
});
