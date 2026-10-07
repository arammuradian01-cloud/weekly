import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, resetDatabase, sql } from "./helpers";

// Этап 20: упоминания и реакции в задачах, обсуждение записи weekly, вопрос в повестке встречи, живые обновления
// «Мне» без перезагрузки, настройки писем в профиле. Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

test.beforeEach(async () => {
  await resetDatabase();
});

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-d-${name}.png`, fullPage: true });
}

async function second(browser: Browser, page: Page, fullName: string) {
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: test.info().project.name === "phone", locale: "ru-RU", timezoneId: "Europe/Moscow" });
  const p = await ctx.newPage();
  await enter(p, fullName);
  return p;
}

test("упоминание в комментарии задачи приходит в «Мне» без перезагрузки, комментарий правится и получает реакцию", async ({ page, browser }) => {
  const [{ number }] = await sql(
    `SELECT t.number FROM tasks t JOIN people p ON p.id = t."ownerId" WHERE p.slug = 'loginova' AND t.status = 'IN_PROGRESS' AND t."archivedAt" IS NULL ORDER BY t.number LIMIT 1`,
  );
  // Рева заранее открыл «Мне» и ничего не перезагружает
  const reva = await second(browser, page, "Рева Тарас");
  await reva.goto("/me");
  await expect(reva.getByRole("heading", { name: "Всё разобрано" })).toBeVisible();

  await enter(page, "Фатьянов Евгений");
  await page.goto(`/tasks/${number}`);
  const field = page.getByLabel("Новый комментарий");
  await field.fill("Посмотри расчёт, @Ре");
  // Подсказка: выбираем человека из списка
  await page.getByRole("option", { name: "Рева Тарас" }).click();
  await expect(field).toHaveValue("Посмотри расчёт, @Рева Тарас ");
  await field.pressSequentially("пожалуйста");
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(field).toHaveValue("");
  const comment = page.locator("li").filter({ hasText: "Посмотри расчёт, @Рева Тарас пожалуйста" }).last();
  await expect(comment.getByText("@Рева Тарас")).toBeVisible();

  // У Ревы событие появилось само: живое обновление
  await expect(reva.getByText("Упоминание: «Посмотри расчёт, @Рева Тарас пожалуйста»")).toBeVisible({ timeout: 20_000 });

  // Свой комментарий правится, появляется пометка «изменено»
  await comment.getByRole("button", { name: "Изменить комментарий" }).click();
  const edit = page.getByLabel("Изменить комментарий");
  await edit.fill("Посмотри расчёт по КАСКО, @Рева Тарас");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Комментарий изменён").first()).toBeVisible();
  const editedComment = page.locator("li").filter({ hasText: "Посмотри расчёт по КАСКО" }).last();
  await expect(editedComment.getByText(", изменено")).toBeVisible();
  await shot(page, "task-comment");

  // Рева ставит «Спасибо» из меню реакций
  await reva.getByRole("link", { name: new RegExp(`^${number} `) }).first().click();
  const revaComment = reva.locator("li").filter({ hasText: "Посмотри расчёт по КАСКО" }).last();
  await revaComment.getByRole("button", { name: "Поставить реакцию" }).click();
  await reva.getByRole("menuitem", { name: "Спасибо" }).click();
  await expect(revaComment.getByRole("button", { name: "Спасибо: 1" })).toBeVisible();
  await reva.context().close();
});

test("обсуждение записи weekly: вопрос к встрече, упоминание, «Мне» автора и повестка встречи", async ({ page, browser }) => {
  const [row] = await sql(
    `SELECT e.id, e.what, to_char(w.start, 'YYYY-MM-DD') AS week FROM weekly_entries e JOIN people p ON p.id = e."authorId" JOIN weeks w ON w.id = e."weekId"
     WHERE p.slug = 'loginova' ORDER BY w.start DESC, e."sortOrder" LIMIT 1`,
  );
  const { id, what, week } = row as { id: string; what: string; week: string };

  await enter(page, "Мурадян Арам");
  await page.goto(`/weekly/entry/${id}`);
  await expect(page.getByRole("heading", { name: "Запись weekly", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: what })).toBeVisible();

  // «Обсудить на встрече» просит вопрос
  await page.getByRole("button", { name: "Обсудить на встрече" }).click();
  await page.getByLabel(/Что обсудить на встрече/).fill("Успеваем ли запустить до конца месяца?");
  await page.getByRole("button", { name: "В повестку" }).click();
  await expect(page.getByText("в повестке встречи")).toBeVisible();

  // Комментарий с упоминанием: подсказка выбирается с клавиатуры
  const field = page.getByLabel("Комментарий к записи");
  await field.fill("@Логи");
  await expect(page.getByRole("option", { name: "Логинова Светлана" })).toBeVisible();
  await field.press("Enter");
  await field.pressSequentially("какой план по срокам?");
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(field).toHaveValue("");
  await expect(page.getByText("какой план по срокам?")).toBeVisible();
  await shot(page, "entry");

  // Автор записи видит её в «Мне» и переходит к обсуждению
  const loginova = await second(browser, page, "Логинова Светлана");
  await loginova.goto("/me");
  await expect(loginova.getByText("Упоминание в обсуждении записи: «@Логинова Светлана какой план по срокам?»")).toBeVisible();
  await loginova.getByRole("link", { name: `Запись weekly: ${what}` }).click();
  await expect(loginova).toHaveURL(new RegExp(`/weekly/entry/${id}$`));
  await expect(loginova.getByText("Успеваем ли запустить до конца месяца?")).toBeVisible();
  await expect(loginova.getByText("какой план по срокам?")).toBeVisible();
  await loginova.context().close();

  // В режиме встречи вопрос идёт первым шагом
  await page.goto(`/weekly/meeting?week=${week}`);
  await expect(page.getByRole("button", { name: "Вопросы: 1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Вопросы к встрече" })).toBeVisible();
  await expect(page.getByText("Успеваем ли запустить до конца месяца?")).toBeVisible();
  await shot(page, "meeting-questions");
  await page.getByRole("button", { name: "Обсуждено" }).click();
  await expect(page.getByText("Все вопросы обсудили")).toBeVisible();
});

test("письма настраиваются в профиле при личном входе", async ({ page }) => {
  // По общему логину настройки только видны
  await enter(page, "Рева Тарас");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Письма" })).toBeVisible();
  await expect(page.getByText(/при личном входе по ссылке/)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Реакции/ })).toBeDisabled();

  await page.context().clearCookies();
  await enterByLink(page, "reva");
  await page.goto("/profile");
  const reactions = page.getByRole("checkbox", { name: /Реакции/ });
  await expect(reactions).toBeChecked();
  await reactions.uncheck();
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Настройки писем сохранены").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /Реакции/ })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Напоминания о сдаче/ })).toBeChecked();
  await shot(page, "profile-mail");
  const [person] = await sql(`SELECT "mailPrefs" FROM people WHERE slug = 'reva'`);
  expect((person as { mailPrefs: Record<string, boolean> }).mailPrefs.reactions).toBe(false);
});
