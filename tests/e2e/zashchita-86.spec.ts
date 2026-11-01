import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 86: защита и наблюдение. Заголовки безопасности, страница «Состояние», сбор ошибок из браузера.
// Ноутбук 1440 и телефон 360. Сквозной стенд идёт с политикой CSP по-настоящему (CSP_MODE=on в playwright.config.ts):
// если политика что-то блокирует, это видно здесь, а не на стенде у людей

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

test.beforeEach(async () => {
  await resetDatabase({ tasks: false, weekly: false });
  await sql("DELETE FROM error_events");
});

/** Жалобы политики из консоли браузера: с ними страница работает не целиком */
function watchRefusals(page: Page): string[] {
  const refusals: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) refusals.push(message.text());
  });
  return refusals;
}

async function noScroll(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-z86-${name}.png`, fullPage: true });
}

test("заголовки безопасности: политика с меткой, скрипт темы работает", async ({ page }) => {
  const refusals = watchRefusals(page);
  const response = await page.goto("/login");
  const headers = response!.headers();
  const policy = headers["content-security-policy"];
  expect(policy).toBeTruthy();
  // Встроенные скрипты только с одноразовой меткой, страницу не встроить в чужую, жалобы идут на свой адрес
  expect(policy).toContain("'nonce-");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("report-uri /api/errors");
  expect(headers["reporting-endpoints"]).toContain("/api/errors");
  // Режим не «только жалобы»: политика действительно действует
  expect(headers["content-security-policy-report-only"]).toBeUndefined();
  // Адрес стенда в тестах http, поэтому заголовка «только по https» нет: по http он всё равно не действует
  expect(headers["strict-transport-security"]).toBeUndefined();
  // Прежние заголовки на месте
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-robots-tag"]).toContain("noindex");

  await expect(page.getByLabel("Логин")).toBeVisible();
  // Встроенный скрипт темы получил метку и сработал: без метки политика его бы не пустила
  await expect(page.locator("html")).toHaveAttribute("data-theme", /^(light|dark)$/);
  expect(refusals, refusals.join("\n")).toEqual([]);
});

test("главные страницы под политикой открываются без жалоб", async ({ page }) => {
  const refusals = watchRefusals(page);
  await enter(page, "Мурадян Арам");
  for (const path of ["/", "/tasks", "/weekly", "/people"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  // Шрифты и значки лежат рядом с приложением: политика их пускает, и ни одна жалоба не всплыла
  expect(refusals, refusals.join("\n")).toEqual([]);
});

test("страница «Состояние»: база, проверка, версия и сбои", async ({ page }) => {
  const refusals = watchRefusals(page);
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "Состояние", exact: true })).toBeVisible();
  await expect(page.getByTestId("status-db")).toContainText("отвечает");
  await expect(page.getByTestId("status-version")).not.toBeEmpty();
  await expect(page.getByRole("heading", { name: "Проверки и версия" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Защита" })).toBeVisible();
  // Сбоев ещё не было
  await expect(page.getByTestId("status-errors-empty")).toBeVisible();
  await noScroll(page, "sostoyanie");
  expect(refusals, refusals.join("\n")).toEqual([]);
});

test("сбой из браузера доходит до страницы «Состояние»", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  // Так же сообщает о себе браузер человека: обработчик открыт без входа и всегда отвечает «принято»
  const sent = await page.request.post("/api/errors", { data: { message: "Проверка сбора сбоев", place: "/weekly?week=1", stack: "zashchita-86.spec.ts:1" } });
  expect(sent.status()).toBe(204);
  const again = await page.request.post("/api/errors", { data: { message: "Проверка сбора сбоев", place: "/weekly?week=2" } });
  expect(again.status()).toBe(204);
  await page.goto("/status");
  const list = page.getByTestId("status-errors");
  await expect(list).toContainText("Проверка сбора сбоев");
  await expect(list).toContainText("Браузер");
  // Одинаковые сбои сложены в одну запись со счётчиком
  await expect(list).toContainText("раз: 2");
  await expect(page.getByTestId("status-errors-count")).toContainText("2");
  await noScroll(page, "sostoyanie-sboi");
});

test("«Состояние» закрыто без режима управления и не владельцу", async ({ page }) => {
  // Без режима управления владельца уводит на ввод пароля
  await enter(page, "Мурадян Арам");
  await page.goto("/status");
  await expect(page).toHaveURL(/\/manage\?next=%2Fstatus$/);
  await enterManagement(page, "owner");
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "Состояние", exact: true })).toBeVisible();
});

test("администратору «Состояние» не открывается", async ({ page }) => {
  await enter(page, "Головкин Владислав");
  await enterManagement(page, "admin");
  await page.goto("/status");
  // Раздел владельца: администратора уводит на главную, пункта меню он не видит
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Состояние" })).toHaveCount(0);
});
