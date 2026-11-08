import { expect, test } from "@playwright/test";
import { enter, resetDatabase, sql } from "./helpers";

// Иначе service worker может отдать скрипты из кэша мимо page.route, и задержка не будет проверена.
test.use({ serviceWorkers: "block" });

const addEvent = (id: string) => sql(
  `INSERT INTO inbox_events (id, "recipientId", kind, "actorId", "actorName", subject, text, "createdAt")
   SELECT $1, r.id, 'MEETING', a.id, 'Мурадян Арам', $2, $3, now() FROM people r, people a
   WHERE r.slug = 'reva' AND a.slug = 'muradyan'`,
  [id, `decision:${id}`, id],
);

test("якорь «Прочитать»: живое обновление сохраняет место и ручную прокрутку", async ({ page }) => {
  await resetDatabase();
  await addEvent("anchor-before");
  await enter(page, "Рева Тарас");
  // Закрываем документ после входа, чтобы ожидание не приняло его поздний ответ SSE за новую подписку.
  await page.goto("/robots.txt");
  const stream = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/events");
  await page.goto("/me#me-read");
  await stream;
  const heading = page.getByRole("heading", { name: /^Прочитать/ });
  await expect(heading).toBeInViewport();
  await addEvent("anchor-after");
  await expect(page.getByTestId("me-read")).toContainText("anchor-after", { timeout: 10_000 });
  await expect(heading).toBeInViewport();

  // Хэш остаётся в адресе, но человек уже ушёл выше: новое событие не должно возвращать его к группе.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await addEvent("anchor-manual");
  await expect(page.getByTestId("me-read")).toContainText("anchor-manual", { timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test("старая ссылка на группу открывается при отложенной загрузке скриптов", async ({ page }) => {
  await resetDatabase();
  await addEvent("anchor-slow");
  await enter(page, "Рева Тарас");
  await page.goto("/robots.txt");
  let release!: () => void;
  let heldScripts = 0;
  const scripts = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/_next/static/**/*.js", async (route) => {
    heldScripts += 1;
    await scripts;
    await route.continue();
  });
  // Эффект InboxEvents отмечает показанные события: ответ подтверждает, что группа уже ожила после HTML.
  const mounted = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST" && (request.postData()?.includes("decision:anchor-slow") ?? false);
  });
  try {
    await page.goto("/me#me-read", { waitUntil: "commit" });
    await expect.poll(() => heldScripts, "хотя бы один скрипт действительно задержан").toBeGreaterThan(0);
    // Сначала приходит HTML, скрипты ещё в пути. Возобновляем их только после появления группы.
    await expect(page.getByTestId("me-read")).toBeVisible();
  } finally {
    release();
  }
  await page.waitForLoadState("load");
  await mounted;
  await expect(page).toHaveURL(/\/#me-read$/);
  await expect(page.getByRole("heading", { name: /^Прочитать/ })).toBeInViewport();
});

// Нативный переход должен работать ещё до гидратации: группа сразу видна в ответе сервера.
test("якорь доступен в исходной странице без выполнения скриптов", async ({ page, browser, isMobile, hasTouch, deviceScaleFactor, locale, timezoneId }) => {
  await resetDatabase();
  await addEvent("anchor-server");
  await enter(page, "Рева Тарас");
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    viewport: page.viewportSize(),
    isMobile,
    hasTouch,
    deviceScaleFactor,
    locale,
    timezoneId,
    javaScriptEnabled: false,
    serviceWorkers: "block",
  });
  try {
    const initial = await context.newPage();
    await initial.goto("/me#me-read");
    await expect(initial).toHaveURL(/\/#me-read$/);
    const heading = initial.getByRole("heading", { name: /^Прочитать/ });
    await expect(heading).toBeVisible();
    await expect(heading).toBeInViewport();
  } finally {
    await context.close();
  }
});

test("карточка задачи открывается из очереди и по прямой ссылке на главную", async ({ page }) => {
  await resetDatabase();
  await enter(page, "Рева Тарас");
  await page.getByTestId("me-late").locator("li").first().getByRole("button").first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(/\?task=\d+$/);
  const direct = page.url();
  await drawer.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  await page.goto(direct);
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Ждёт вас/ })).toBeVisible();
});
