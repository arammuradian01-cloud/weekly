// «Мне» (этап 11): комментарий к чужой задаче попадает ответственному, счётчик в меню, «Напомнить» и «Разобрано»
import { expect, test } from "@playwright/test";
import { enter, resetDatabase, sql } from "./helpers";

test.beforeEach(async () => {
  await resetDatabase();
});

test("комментарий к задаче Ревы виден ему в «Мне»: счётчик, напомнить, разобрано", async ({ page, browser }) => {
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
  const nav = reva.getByRole("navigation", { name: "Разделы" }).filter({ visible: true }).first();
  await expect(nav.getByRole("link", { name: /Мне.*ждут 1/ })).toBeVisible();
  await nav.getByRole("link", { name: /Мне/ }).click();
  await expect(reva).toHaveURL(/\/me$/);
  await expect(reva.getByText("Комментарий: «Тарас, посмотри мой расчёт по КАСКО»")).toBeVisible();
  // Строка события по дизайн-системе: кто сделал под текстом, время справа
  await expect(reva.getByText("Фатьянов Евгений", { exact: true })).toBeVisible();
  await expect(reva.getByText(/^сегодня в \d\d:\d\d$/)).toBeVisible();
  await reva.screenshot({ path: `tests/e2e/screenshots/${test.info().project.name}-c-inbox.png`, fullPage: true });

  // «Напомнить завтра»: строка уходит, счётчик гаснет
  await reva.getByRole("button", { name: /^Напомнить:/ }).click();
  await reva.getByRole("menuitem", { name: "Завтра в 9:00" }).click();
  await expect(reva.getByRole("heading", { name: "Всё разобрано" })).toBeVisible();
  await expect(reva.getByText("Отложено до напоминания: 1")).toBeVisible();
  await expect(nav.getByRole("link", { name: /Мне.*ждут/ })).toHaveCount(0);

  // Утро наступило: строка вернулась
  await sql(`UPDATE inbox_events SET "snoozeUntil" = now() - interval '1 minute'`);
  await reva.reload();
  await expect(reva.getByText("Комментарий: «Тарас, посмотри мой расчёт по КАСКО»")).toBeVisible();

  // «Разобрано»: список пуст, ссылка ведёт к задаче
  await expect(reva.getByRole("link", { name: new RegExp(`^${number} `) }).first()).toHaveAttribute("href", `/tasks/${number}`);
  await reva.getByRole("button", { name: /^Разобрано:/ }).click();
  await expect(reva.getByRole("heading", { name: "Всё разобрано" })).toBeVisible();
  await reva.close();
});
