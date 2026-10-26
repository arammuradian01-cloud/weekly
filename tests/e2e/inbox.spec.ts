// Очередь «Ждёт вас» на «Моей неделе» (этап 11 как раздел «Мне», с этапа 76 блок главной): комментарий к чужой задаче
// попадает ответственному, счётчик у пункта «Моя неделя», «Напомнить», отложенное и «Разобрано»
import { expect, test } from "@playwright/test";
import { enter, resetDatabase, sql } from "./helpers";

test.beforeEach(async () => {
  await resetDatabase();
});

test("комментарий к задаче Ревы виден ему на «Моей неделе» в «Ждёт вас»: счётчик, напомнить, разобрано", async ({ page, browser }) => {
  const [{ number }] = await sql(
    `SELECT t.number FROM tasks t JOIN people p ON p.id = t."ownerId" WHERE p.slug = 'reva' AND t.status = 'IN_PROGRESS' AND t."archivedAt" IS NULL ORDER BY t.number LIMIT 1`,
  );

  // Фатьянов комментирует задачу Ревы
  await enter(page, "Фатьянов Евгений");
  await page.goto(`/tasks/${number}`);
  await page.getByLabel("Новый комментарий").fill("Тарас, посмотри мой расчёт по КАСКО");
  await page.getByRole("button", { name: "Отправить" }).click();
  // Поле очищается, когда сервер сохранил комментарий
  await expect(page.getByLabel("Новый комментарий")).toHaveValue("");
  await expect(page.getByText("Тарас, посмотри мой расчёт по КАСКО").first()).toBeVisible();

  const reva = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  await enter(reva, "Рева Тарас");
  // Этап 76: после входа сразу «Моя неделя», счётчик «ждут 1» у её пункта, пункта «Мне» нет
  const nav = reva.getByRole("navigation", { name: "Разделы" }).filter({ visible: true }).first();
  await expect(nav.getByRole("link", { name: /Моя неделя.*ждут 1/ })).toBeVisible();
  await expect(nav.getByRole("link", { name: /^Мне/ })).toHaveCount(0);
  await nav.getByRole("link", { name: /Моя неделя/ }).click();
  await expect(reva).toHaveURL(/\/$/);
  await expect(reva.getByRole("heading", { name: /^Ждёт вас/, level: 2 })).toBeVisible();
  // Счётчик «новое событие» ведёт к группе «Прочитать» на той же странице
  const figures = reva.getByTestId("my-attention-figures");
  await figures.getByRole("link", { name: /новое событие/ }).click();
  await expect(reva).toHaveURL(/\/#me-read$/);
  const read = reva.getByTestId("me-read");
  await expect(read.getByRole("heading", { name: /^Прочитать/ })).toBeInViewport();
  const row = read.locator("li.sv-event").filter({ hasText: "Комментарий: «Тарас, посмотри мой расчёт по КАСКО»" });
  await expect(row).toHaveCount(1);
  // Строка события по дизайн-системе: кто сделал под текстом, время справа. Время устойчиво к полуночи
  await expect(row.getByText("Фатьянов Евгений", { exact: true })).toBeVisible();
  await expect(row.getByText(/^(сегодня|вчера) в \d\d:\d\d$/)).toBeVisible();
  await reva.screenshot({ path: `tests/e2e/screenshots/${test.info().project.name}-c-inbox.png`, fullPage: true });

  // «Напомнить завтра»: строка уходит, счётчик гаснет
  await row.getByRole("button", { name: /^Напомнить:/ }).click();
  await reva.getByRole("menuitem", { name: "Завтра в 9:00" }).click();
  // Событий нет: группы «Прочитать» в очереди нет (этап 44), отложенное видно строкой
  await expect(reva.getByTestId("me-read")).toHaveCount(0);
  await expect(reva.getByText("Отложено до напоминания: 1")).toBeVisible();
  await expect(nav.getByRole("link", { name: /Моя неделя.*ждут/ })).toHaveCount(0);
  const [snoozed] = await sql(`SELECT count(*)::int AS n FROM inbox_events WHERE "snoozeUntil" > now() AND "doneAt" IS NULL`);
  expect(snoozed.n).toBe(1);

  // Утро наступило: строка вернулась
  await sql(`UPDATE inbox_events SET "snoozeUntil" = now() - interval '1 minute'`);
  await reva.reload();
  await expect(read.getByText("Комментарий: «Тарас, посмотри мой расчёт по КАСКО»")).toBeVisible();
  await expect(nav.getByRole("link", { name: /Моя неделя.*ждут 1/ })).toBeVisible();

  // «Разобрано»: группа пуста, ссылка ведёт к задаче
  await expect(read.getByRole("link", { name: new RegExp(`^${number} `) }).first()).toHaveAttribute("href", `/tasks/${number}`);
  await read.getByRole("button", { name: /^Разобрано:/ }).click();
  await expect(reva.getByTestId("me-read")).toHaveCount(0);
  const [done] = await sql(`SELECT count(*)::int AS n FROM inbox_events WHERE "doneAt" IS NOT NULL`);
  expect(done.n).toBe(1);
  await expect(nav.getByRole("link", { name: /Моя неделя.*ждут/ })).toHaveCount(0);
  await reva.close();
});

test("новое событие появляется в «Ждёт вас» без перезагрузки, «Разобрать всё» разбирает группу", async ({ page }) => {
  const [reva] = await sql(`SELECT id FROM people WHERE slug = 'reva'`);
  const [aram] = await sql(`SELECT id FROM people WHERE slug = 'muradyan'`);
  await enter(page, "Рева Тарас");
  await expect(page.getByTestId("me-read")).toHaveCount(0);
  // Событие пишет база (её триггер сообщает в weekly_live), страницу никто не перезагружает: поток /api/events
  // обновляет «Мою неделю» сам
  for (const i of [1, 2]) {
    await sql(
      `INSERT INTO inbox_events (id, "recipientId", kind, "actorId", "actorName", subject, text, "createdAt") VALUES ($1, $2, 'MEETING', $3, 'Мурадян Арам', $4, $5, now())`,
      [`ev-e2e76-live-${i}`, reva.id, aram.id, `decision:e2e76-${i}`, `Вы владелец решения встречи: решение ${i}`],
    );
  }
  const read = page.getByTestId("me-read");
  await expect(read.getByText("Вы владелец решения встречи: решение 2")).toBeVisible({ timeout: 20_000 });
  await expect(read.getByRole("link", { name: "Решение встречи" }).first()).toHaveAttribute("href", "/decisions");
  await read.getByRole("button", { name: "Разобрать всё" }).click();
  await expect(page.getByTestId("me-read")).toHaveCount(0);
  const [left] = await sql(`SELECT count(*)::int AS n FROM inbox_events WHERE "recipientId" = $1 AND "doneAt" IS NULL`, [reva.id]);
  expect(left.n).toBe(0);
});
