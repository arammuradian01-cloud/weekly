import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, resetDatabase, sql } from "./helpers";

// Этап 26 (М11): приложение на экране «Домой», черновик weekly без сети, уведомления в профиле и три мобильных
// сценария в два нажатия. Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

test.beforeEach(async () => {
  await resetDatabase();
});

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-ph-${name}.png`, fullPage: true });
}

/** Служебный обработчик встал и управляет страницей */
async function workerReady(page: Page) {
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === "activated", null, { timeout: 20_000, polling: 250 });
  // clients.claim() берёт страницу под обработчик сам; если не успел, новая загрузка страницы точно под ним
  const claimed = await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 5_000, polling: 250 }).then(() => true, () => false);
  if (claimed) return;
  await page.goto(page.url());
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20_000, polling: 250 });
}

test("приложение на экран «Домой»: описание, значки и обработчик открыты без входа; без сети страница «Нет сети»", async ({ page, request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expect(await manifest.json()).toMatchObject({ short_name: "Weekly", display: "standalone", start_url: "/" });
  for (const path of ["/sw.js", "/offline.html", "/icons/icon-192.png", "/icons/apple-touch-icon.png"]) expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
  // Рабочая страница без входа по-прежнему уводит на вход
  expect((await request.get("/me", { maxRedirects: 0 })).status()).toBe(307);

  await page.goto("/login");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/apple-touch-icon.png");
  // Обработчик встал, управляет страницей и заранее положил страницу «Нет сети»: без сети покажется она.
  // Сам переход без сети здесь не проверить: эмуляция сети в Chromium не действует на служебный обработчик
  await workerReady(page);
  expect(await page.evaluate(async () => !!(await caches.match("/offline.html")))).toBe(true);
  // Страницы с данными в кэш не попадают
  await page.goto("/login");
  expect(await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname)))).flat().filter((p) => !p.startsWith("/_next/static/") && !p.startsWith("/icons/") && !p.startsWith("/logo/")))).toEqual(["/offline.html"]);
  await page.goto("/offline.html");
  await expect(page.getByRole("heading", { name: "Нет сети" })).toBeVisible();
  await expect(page.getByText("Черновик weekly, который вы писали, сохранён на этом устройстве")).toBeVisible();
  await shot(page, "offline");
});

test("черновик weekly без сети: запись не теряется, уходит сама, когда связь вернулась, и не задваивается", async ({ page }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/weekly/submit");
  await page.getByRole("button", { name: /Добавить запись/ }).first().click();

  // Сеть пропала до автосохранения: запись остаётся на устройстве, человек видит, что она уйдёт сама
  await page.context().setOffline(true);
  await page.getByLabel("Что произошло").fill("Подписали допсоглашение с партнёром по ОСАГО");
  await expect(page.getByText("Нет сети: запись сохранена на этом устройстве и уйдёт на сервер, когда появится связь").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("status").filter({ hasText: "Нет сети" })).toBeVisible();
  await shot(page, "submit-offline");

  // Связь вернулась: запись ушла без нажатий
  await page.context().setOffline(false);
  await expect(page.getByText("Черновик записи сохранён")).toBeVisible({ timeout: 15_000 });
  const rows = await sql(`SELECT e.what, e."clientKey" FROM weekly_entries e JOIN people p ON p.id = e."authorId" WHERE p.slug = 'reva' AND e.what LIKE 'Подписали допсоглашение%'`);
  expect(rows).toHaveLength(1);
  expect(rows[0].clientKey).toMatch(/^[A-Za-z0-9_-]{8,64}$/);

  // Без сети дописали и закрыли страницу: после возвращения связи черновик уходит при открытии страницы
  await page.getByRole("button", { name: "Сохранить запись" }).click();
  await expect(page.getByText("Запись сохранена")).toBeVisible();
  await page.getByRole("button", { name: /Добавить запись/ }).first().click();
  await page.context().setOffline(true);
  await page.getByLabel("Что произошло").fill("Договорились о пилоте с банком");
  await expect(page.getByText("Нет сети: запись сохранена на этом устройстве").first()).toBeVisible({ timeout: 10_000 });
  // Черновик уже на устройстве: сообщение выше могло остаться от первой записи
  await expect
    .poll(() => page.evaluate(() => Object.entries(localStorage).some(([k, v]) => k.startsWith("weekly-offline:") && v.includes("Договорились о пилоте с банком"))))
    .toBe(true);
  await page.goto("/weekly/submit").catch(() => undefined);
  await page.context().setOffline(false);
  await page.goto("/weekly/submit");
  await expect(page.getByText("Договорились о пилоте с банком")).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await sql(`SELECT count(*)::int AS n FROM weekly_entries WHERE what = 'Договорились о пилоте с банком'`))[0].n).toBe(1);
  // Черновик дошёл и убран с устройства: повторное открытие не создаёт копию
  await page.reload();
  await expect(page.getByText("Договорились о пилоте с банком")).toBeVisible();
  expect((await sql(`SELECT count(*)::int AS n FROM weekly_entries WHERE what = 'Договорились о пилоте с банком'`))[0].n).toBe(1);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("weekly-offline:")).length)).toBe(0);
});

test("просьбу можно принять с телефона в два нажатия: «Мне» и «Принять к сроку»", async ({ page }) => {
  const [author] = await sql(`SELECT id FROM people WHERE slug = 'reva'`);
  const [to] = await sql(`SELECT id FROM people WHERE slug = 'loginova'`);
  const [{ number, id }] = await sql(
    `INSERT INTO help_requests (id, "authorId", "addresseeId", text, due, status, "updatedAt") VALUES ('rq-e2e-1', $1, $2, 'Цифры по трафику ДВС за сентябрь', (now() AT TIME ZONE 'Europe/Moscow')::date + 5, 'OPEN', now()) RETURNING number, id`,
    [author.id, to.id],
  );
  await sql(
    `INSERT INTO inbox_events (id, "recipientId", kind, "actorId", "actorName", subject, "requestId", text, "createdAt") VALUES ('ev-e2e-1', $1, 'REQUEST', $2, 'Рева Тарас', $3, $4, 'Просьба к вам', now())`,
    [to.id, author.id, `request:${number}`, id],
  );
  await enter(page, "Логинова Светлана");
  // Нажатие 1: «Мне» в нижнем меню телефона или в боковом меню
  const nav = test.info().project.name === "phone" ? page.locator("nav.fixed") : page.getByRole("navigation", { name: "Разделы" }).first();
  await nav.getByRole("link", { name: /^Мне/ }).click();
  await expect(page).toHaveURL(/\/me$/);
  const row = page.locator("li.sv-event").filter({ hasText: "Цифры по трафику ДВС за сентябрь" });
  await shot(page, "me-request");
  // Нажатие 2: «Принять к …»
  await row.getByRole("button", { name: new RegExp(`^Принять просьбу ${number} к \\d{1,2} \\S+$`) }).click();
  await expect(page.getByText(/^Просьба принята, срок \d{1,2} \S+$/)).toBeVisible();
  const [r] = await sql(`SELECT status, "acceptedDue" = due AS same FROM help_requests WHERE id = 'rq-e2e-1'`);
  expect(r).toEqual({ status: "ACCEPTED", same: true });
  // Событие разобрано: из списка ушло
  await expect(row).toHaveCount(0);

  // На странице просьбы то же одним нажатием, свой срок отдельной кнопкой
  await sql(`UPDATE help_requests SET status = 'OPEN', "acceptedDue" = NULL WHERE id = 'rq-e2e-1'`);
  await page.goto(`/requests/${number}`);
  await expect(page.getByRole("button", { name: /^Принять к \d{1,2} \S+$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Другой срок" })).toBeVisible();
});

test("задачу можно обновить с главной в два нажатия; лента и повестка в одном нажатии", async ({ page }) => {
  const [{ number }] = await sql(
    `UPDATE tasks SET due = (now() AT TIME ZONE 'Europe/Moscow')::date - 2 WHERE number = (SELECT t.number FROM tasks t JOIN people p ON p.id = t."ownerId" WHERE p.slug = 'reva' AND t.status = 'IN_PROGRESS' AND t."archivedAt" IS NULL ORDER BY t.number LIMIT 1) RETURNING number`,
  );
  await enter(page, "Рева Тарас");
  const urgent = page.locator("section", { has: page.getByRole("heading", { name: /Просроченные и срочные/ }) });
  const row = urgent.locator("li").filter({ hasText: new RegExp(`^${number}`) });
  // Нажатие 1: статус, нажатие 2: новый статус
  await row.getByRole("button", { name: new RegExp(`^Статус задачи ${number}: В работе`) }).click();
  await page.getByRole("menuitem", { name: "Требует уточнений" }).click();
  await expect(row.getByRole("button", { name: new RegExp(`^Статус задачи ${number}: Требует уточнений`) })).toBeVisible();
  const [t] = await sql(`SELECT status FROM tasks WHERE number = $1`, [number]);
  expect(t.status).toBe("CLARIFY");
  await shot(page, "home-status");

  // Лента weekly: одно нажатие из меню; повестка встречи: одно нажатие с плитки на главной
  const phone = test.info().project.name === "phone";
  const nav = phone ? page.locator("nav.fixed") : page.getByRole("navigation", { name: "Разделы" }).first();
  await nav.getByRole("link", { name: "Weekly" }).click();
  await expect(page).toHaveURL(/\/weekly$/);
  await page.goto("/");
  await page.getByRole("link", { name: /Повестка, решения недели и разбор задач/ }).click();
  await expect(page).toHaveURL(/\/weekly\/meeting/);
});

test("уведомления в браузере: по общему логину выключены, при личном входе раздел в профиле", async ({ page, browser }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/profile");
  const section = page.locator("section", { has: page.getByRole("heading", { name: "Телефон и уведомления" }) });
  await expect(section.getByText("Уведомления в браузере включаются при личном входе")).toBeVisible();
  await expect(section.getByTestId("install-app")).toBeVisible();

  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: test.info().project.name === "phone", locale: "ru-RU", timezoneId: "Europe/Moscow" });
  const own = await ctx.newPage();
  await enterByLink(own, "loginova");
  await own.goto("/profile");
  const mine = own.getByTestId("push-settings");
  await expect(mine).toBeVisible();
  // Браузер в тестах без службы уведомлений: раздел честно говорит, что можно, а настройки типов сохраняются
  await expect(mine.getByText(/На этом устройстве уведомления выключены|Этот браузер не умеет уведомления от сайтов/)).toBeVisible({ timeout: 15_000 });
  const reactions = mine.getByRole("checkbox", { name: /^Реакции/ });
  await reactions.uncheck();
  await expect(reactions).not.toBeChecked();
  await mine.getByRole("button", { name: "Сохранить" }).click();
  await expect(own.getByText("Настройки уведомлений сохранены")).toBeVisible();
  const [p] = await sql(`SELECT "pushPrefs" FROM people WHERE slug = 'loginova'`);
  expect(p.pushPrefs).toEqual({ tasks: true, mentions: true, reactions: false });
  await shot(own, "profile-push");
  await ctx.close();
});
