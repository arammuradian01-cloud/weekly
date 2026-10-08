import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, resetDatabase, sql } from "./helpers";

// Этап 29: календарь сроков по личной ссылке и анонимная оценка встреч. Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-cr-${name}.png`, fullPage: true });
}

/** Месяц вида 2026-08 со сдвигом от текущего по Москве */
function month(shift: number): string {
  const msk = new Date(Date.now() + 3 * 3600_000);
  const d = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth() + shift, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
  await sql("DELETE FROM calendar_feeds");
  await sql("DELETE FROM meeting_rating_votes");
  await sql("DELETE FROM meeting_ratings");
});

test("календарь сроков: ссылка один раз, файл открывается без входа, отключённая ссылка не работает", async ({ page, playwright }) => {
  await enterByLink(page, "reva");
  await page.goto("/profile");
  const section = page.getByRole("region", { name: "Календарь сроков" });
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByText(/Сроки ваших задач, срок weekly/)).toBeVisible();
  // Названия выключены по умолчанию, при включении предупреждение про сервис календаря
  const titles = section.getByRole("checkbox", { name: /Показывать названия задач и имена/ });
  await expect(titles).not.toBeChecked();
  await titles.check();
  await expect(section.getByText(/увидит и сохранит у себя сервис календаря/)).toBeVisible();
  await titles.uncheck();
  await expect(section.getByText(/увидит и сохранит у себя сервис календаря/)).toHaveCount(0);

  await section.getByRole("button", { name: "Создать ссылку" }).click();
  const link = section.getByRole("textbox", { name: "Ссылка на календарь" });
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  expect(url).toMatch(/^http:\/\/localhost:3100\/api\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
  await expect(section.getByText("Ссылка готова. Она показывается один раз")).toBeVisible();
  await expect(section.getByRole("link", { name: "открыть в календаре" })).toHaveAttribute("href", /^webcal:\/\/localhost:3100\/api\/calendar\//);
  await shot(page, "calendar-link");

  // Календарь забирает файл без cookie
  const outside = await playwright.request.newContext();
  const res = await outside.get(url);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/calendar");
  const body = await res.text();
  expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  expect(body.replace(/\r\n /g, "")).toMatch(/SUMMARY:Срок weekly\\, неделя \d+/);

  // После обновления страницы ссылки уже не видно, видно, что календарь забирал данные
  await page.reload();
  await expect(section.getByText(/Ссылка создана/)).toBeVisible();
  await expect(section.getByText(/Календарь последний раз забирал данные/)).toBeVisible();
  await expect(section.getByRole("textbox", { name: "Ссылка на календарь" })).toHaveCount(0);

  await section.getByRole("button", { name: "Отключить ссылку" }).click();
  await expect(page.getByText("Ссылка отключена: календарь перестанет обновляться")).toBeVisible();
  await expect(section.getByRole("button", { name: "Создать ссылку" })).toBeVisible();
  expect((await outside.get(url)).status()).toBe(404);
  // Неверная ссылка выглядит так же
  expect((await outside.get(url.replace(/.{6}\.ics$/, "AAAAAA.ics"))).status()).toBe(404);
  await outside.dispose();
});

test("календарь по общему логину не подключить", async ({ page }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/profile");
  const section = page.getByRole("region", { name: "Календарь сроков" });
  await expect(section.getByText(/подключается при личном входе/)).toBeVisible();
  await expect(section.getByRole("button", { name: "Создать ссылку" })).toHaveCount(0);
});

test("оценка встреч: участник отвечает анонимно один раз, руководитель видит итог закрытого месяца от трёх ответов", async ({ page, browser }) => {
  // Закрытый месяц: три ответа уже есть, в нём итог и комментарии по алфавиту
  const closed = month(-2);
  for (const [score, remove] of [
    [5, ""],
    [4, "статусы по кругу"],
    [3, "длинные отчёты"],
  ] as const) {
    await sql(`INSERT INTO meeting_ratings (id, "teamId", month, score, remove) VALUES (gen_random_uuid()::text, 'top', $1, $2, $3)`, [closed, score, remove]);
  }

  await enterByLink(page, "loginova");
  await page.goto("/meeting-rating");
  await expect(page.getByRole("heading", { name: "Оценка встреч", level: 1 })).toBeVisible();
  await expect(page.getByText(/Ответ анонимный/)).toBeVisible();
  const form = page.getByRole("form").filter({ hasText: "Встречи ведёт Мурадян" }).last();
  await expect(form.getByRole("button", { name: "Отправить анонимно" })).toBeDisabled();
  await form.locator("label").filter({ has: page.getByRole("radio", { name: "4, полезны", exact: true }) }).click();
  await expect(form.getByRole("radio", { name: "4, полезны", exact: true })).toBeChecked();
  await form.getByLabel("Что убрать из встреч").fill("Повторы статусов задач");
  await shot(page, "rate-form");
  await form.getByRole("button", { name: "Отправить анонимно" }).click();
  await expect(page.getByText(/ответ за .+ учтён/).last()).toBeVisible();
  await page.reload();
  await expect(page.getByText(/ответ за .+ учтён/).last()).toBeVisible();
  // В базе ответ без автора
  const rows = await sql("SELECT * FROM meeting_ratings WHERE month = $1", [month(0)]);
  expect(rows).toHaveLength(1);
  expect(Object.keys(rows[0]).sort()).toEqual(["id", "month", "remove", "score", "teamId"]);

  // Руководитель топ-команды видит итог в аналитике
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: test.info().project.name === "phone", hasTouch: test.info().project.name === "phone" });
  const owner = await ctx.newPage();
  await enterByLink(owner, "muradyan");
  await owner.goto("/analytics");
  const panel = owner.getByRole("region", { name: "Встречи глазами команды" });
  await panel.scrollIntoViewIfNeeded();
  await expect(panel.getByText(/Опрос идёт до \d+ \S+, ответили 1 из \d+/)).toBeVisible();
  await expect(panel.getByText("4,0 из 5, 3 ответа")).toBeVisible();
  const comments = panel.getByRole("list", { name: "Что предлагают убрать" }).getByRole("listitem");
  await expect(comments).toHaveText(["длинные отчёты", "статусы по кругу"]);
  // Текст ответа за текущий месяц руководитель не видит, пока опрос идёт
  await expect(panel.getByText("Повторы статусов задач")).toHaveCount(0);
  await shot(owner, "rating-results");
  await ctx.close();
});
