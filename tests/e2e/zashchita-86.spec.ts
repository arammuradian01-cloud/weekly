import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterManagement, resetDatabase, sql, watchCspRefusals } from "./helpers";

// Этап 86: защита и наблюдение. Заголовки безопасности, страница «Состояние», сбор ошибок из браузера.
// Ноутбук 1440 и телефон 360. Сквозной стенд идёт с политикой CSP по-настоящему (CSP_MODE=on в playwright.config.ts):
// если политика что-то блокирует, это видно здесь, а не на стенде у людей

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

test.beforeEach(async () => {
  await resetDatabase({ tasks: false, weekly: false });
  await sql("DELETE FROM error_events");
});

async function noScroll(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-z86-${name}.png`, fullPage: true });
}

test("заголовки безопасности: политика уходит, встроенный скрипт темы работает", async ({ page }) => {
  const refusals = watchCspRefusals(page);
  const response = await page.goto("/login");
  const headers = response!.headers();
  const policy = headers["content-security-policy"];
  expect(policy).toBeTruthy();
  // Политика по умолчанию: чужие адреса закрыты, запросы и формы только к себе, жалобы идут на свой адрес.
  // Встроенные скрипты разрешены: иначе не работает дашборд рынка в окне srcdoc (src/lib/security.ts)
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("script-src 'self' 'unsafe-inline'");
  expect(policy).toContain("connect-src 'self'");
  expect(policy).toContain("form-action 'self'");
  expect(policy).toContain("object-src 'none'");
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
  // Встроенный скрипт темы сработал: политика его пустила
  await expect(page.locator("html")).toHaveAttribute("data-theme", /^(light|dark)$/);
  expect(refusals, refusals.join("\n")).toEqual([]);
});

test("главные страницы под политикой открываются без жалоб", async ({ page }) => {
  const refusals = watchCspRefusals(page);
  await enter(page, "Мурадян Арам");
  for (const path of ["/", "/tasks", "/weekly", "/people"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  // Шрифты и значки лежат рядом с приложением: политика их пускает, и ни одна жалоба не всплыла
  expect(refusals, refusals.join("\n")).toEqual([]);
});

test("страница «Состояние»: база, проверка, версия и сбои", async ({ page }) => {
  const refusals = watchCspRefusals(page);
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "Состояние", exact: true })).toBeVisible();
  await expect(page.getByTestId("status-db")).toContainText("отвечает");
  await expect(page.getByTestId("status-backup")).toContainText("выключена");
  await expect(page.getByTestId("status-backup-restore")).toContainText("выключена");
  await expect(page.getByTestId("status-version")).not.toBeEmpty();
  await expect(page.getByRole("heading", { name: "Проверки и версия" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Защита" })).toBeVisible();
  // Сбоев ещё не было. Если что-то всплыло, оно названо прямо в ошибке теста: источник, текст и страница
  const rows = (await sql(`SELECT source, message, place, times FROM error_events ORDER BY "lastAt" DESC`)) as {
    source: string;
    message: string;
    place: string | null;
    times: number;
  }[];
  expect(
    rows.map((r) => `${r.source}: ${r.message} (${r.place ?? "без страницы"}, раз ${r.times})`),
    "сбои ресурса за вход, режим управления и открытие «Состояния»",
  ).toEqual([]);
  await expect(page.getByTestId("status-errors-empty")).toBeVisible();
  await noScroll(page, "sostoyanie");
  expect(refusals, refusals.join("\n")).toEqual([]);
});

test("сбой из браузера доходит до страницы «Состояние»", async ({ page, request }) => {
  // Сообщение уходит до всякого входа, отдельным запросом без cookie: так его присылает браузер с экрана входа и
  // так браузер присылает жалобу политики. Обработчик открыт нарочно и всегда отвечает «принято» без текста
  const sent = await request.post("/api/errors", { data: { message: "Проверка сбора сбоев", place: "/weekly?week=1", stack: "zashchita-86.spec.ts:1" } });
  expect(sent.status()).toBe(204);
  const again = await request.post("/api/errors", { data: { message: "Проверка сбора сбоев", place: "/weekly?week=2" } });
  expect(again.status()).toBe(204);
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/status");
  const list = page.getByTestId("status-errors");
  await expect(list).toContainText("Проверка сбора сбоев");
  await expect(list).toContainText("Браузер");
  // Одинаковые сбои сложены в одну запись со счётчиком
  await expect(list).toContainText("раз: 2");
  // Счётчик за сутки считает случаи, а не записи: два одинаковых сбоя это два случая
  const counter = (await page.getByTestId("status-errors-count").textContent()) ?? "";
  const perDay = Number(/за сутки\D*(\d+)/.exec(counter)?.[1] ?? "0");
  expect(perDay, counter).toBeGreaterThanOrEqual(2);
  await noScroll(page, "sostoyanie-sboi");
  // Своих сбоев у ресурса за весь сценарий (вход, режим управления, две страницы) быть не должно: в списке только
  // тот сбой, который отправил тест. Если что-то всплыло, оно названо прямо в ошибке теста, а не теряется
  const rows = (await sql(`SELECT source, message, place, times FROM error_events ORDER BY "lastAt" DESC`)) as {
    source: string;
    message: string;
    place: string | null;
    times: number;
  }[];
  const mine = rows.filter((r) => r.message === "Проверка сбора сбоев");
  expect(mine).toHaveLength(1);
  expect(mine[0]!.times).toBe(2);
  const others = rows.filter((r) => r.message !== "Проверка сбора сбоев").map((r) => `${r.source}: ${r.message} (${r.place ?? "без страницы"}, раз ${r.times})`);
  expect(others, "посторонние сбои за сценарий").toEqual([]);
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
