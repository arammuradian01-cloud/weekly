import { expect, test } from "@playwright/test";
import { enter, resetDatabase, sql } from "./helpers";

test("якорь «Прочитать»: живое обновление сохраняет место и ручную прокрутку", async ({ page }) => {
  await resetDatabase();
  const addEvent = (id: string) => sql(
    `INSERT INTO inbox_events (id, "recipientId", kind, "actorId", "actorName", subject, text, "createdAt")
     SELECT $1, r.id, 'MEETING', a.id, 'Мурадян Арам', $2, $3, now() FROM people r, people a
     WHERE r.slug = 'reva' AND a.slug = 'muradyan'`,
    [id, `decision:${id}`, id],
  );
  await addEvent("anchor-before");
  await enter(page, "Рева Тарас");
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
  await sql(
    `INSERT INTO inbox_events (id, "recipientId", kind, "actorId", "actorName", subject, text, "createdAt")
     SELECT 'anchor-slow', r.id, 'MEETING', a.id, 'Мурадян Арам', 'decision:anchor-slow',
     'Проверить тариф', now() FROM people r, people a WHERE r.slug = 'reva' AND a.slug = 'muradyan'`,
  );
  await enter(page, "Рева Тарас");
  let release!: () => void;
  const scripts = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/_next/static/**/*.js", async (route) => {
    await scripts;
    await route.continue();
  });
  try {
    await page.goto("/me#me-read", { waitUntil: "commit" });
    // Сначала приходит HTML, скрипты ещё в пути. Возобновляем их только после появления группы.
    await expect(page.getByTestId("me-read")).toBeVisible();
  } finally {
    release();
  }
  await page.waitForLoadState("load");
  await expect(page).toHaveURL(/\/#me-read$/);
  await expect(page.getByRole("heading", { name: /^Прочитать/ })).toBeInViewport();
});
