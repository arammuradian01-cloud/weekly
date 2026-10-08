import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, resetDatabase, sql } from "./helpers";

// Этап 21: просьба коллеге из карточки задачи, ответ адресата в «Мне» с телефона и ноутбука, «Жду от коллег» у автора,
// задача из просьбы, зависшая просьба на встрече. Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

test.beforeEach(async () => {
  await resetDatabase();
});

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-r-${name}.png`, fullPage: true });
}

async function second(browser: Browser, page: Page, fullName: string) {
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: test.info().project.name === "phone", locale: "ru-RU", timezoneId: "Europe/Moscow" });
  const p = await ctx.newPage();
  await enter(p, fullName);
  return p;
}

async function revaTask(): Promise<number> {
  const [{ number }] = await sql(
    `SELECT t.number FROM tasks t JOIN people p ON p.id = t."ownerId" WHERE p.slug = 'reva' AND t.status = 'IN_PROGRESS' AND t."archivedAt" IS NULL ORDER BY t.number LIMIT 1`,
  );
  return Number(number);
}

test("просьба из карточки задачи: адресат принимает со сроком и делает задачей, автор видит ответ", async ({ page, browser }) => {
  const number = await revaTask();
  await enter(page, "Рева Тарас");
  await page.goto(`/tasks/${number}`);
  await page.getByRole("button", { name: "Попросить коллегу" }).click();
  const dialog = page.getByRole("dialog", { name: "Попросить коллегу" });
  await expect(dialog.getByText(`К задаче ${number}`)).toBeVisible();
  await dialog.getByRole("button", { name: "Попросить" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Выберите, кого просите");
  await dialog.getByLabel("Кого просите").selectOption("loginova");
  await dialog.getByLabel("Что нужно").fill("Данные по трафику ДВС за сентябрь в таблице");
  await dialog.getByRole("button", { name: "Пятница" }).click();
  await dialog.getByRole("button", { name: "Попросить" }).click();
  await expect(page.getByText(/^Просьба \d+ ушла/)).toBeVisible();
  const [{ n }] = await sql(`SELECT number AS n FROM help_requests ORDER BY number DESC LIMIT 1`);
  const requestNumber = Number(n);
  // Просьба видна в карточке задачи
  const row = page.locator("li").filter({ hasText: "Данные по трафику ДВС за сентябрь" });
  await expect(row.getByText("Ждёт ответа")).toBeVisible();
  await shot(page, "task-card");

  // Адресат отвечает из «Мне»
  const loginova = await second(browser, page, "Логинова Светлана");
  await loginova.goto("/me");
  const incoming = loginova.locator("section", { has: loginova.getByRole("heading", { name: /Просьбы ко мне/ }) });
  await expect(incoming.getByRole("link", { name: /Данные по трафику ДВС/ })).toBeVisible();
  await incoming.getByRole("button", { name: "Другой срок" }).click();
  const accept = loginova.getByRole("dialog", { name: `Принять просьбу ${requestNumber}` });
  await accept.getByRole("button", { name: "Через неделю" }).click();
  await accept.getByRole("button", { name: "Принять", exact: true }).click();
  await expect(loginova.getByText("Просьба принята")).toBeVisible();
  await expect(incoming.getByText("Принята")).toBeVisible();
  await shot(loginova, "me");

  // Автор видит ответ на «Моей неделе», в блоке «Жду от коллег»
  await page.goto("/");
  const waiting = page.locator("section", { has: page.getByRole("heading", { name: /Жду от коллег/ }) });
  await expect(waiting.getByText("Принята")).toBeVisible();
  await expect(waiting.getByRole("button", { name: "Напомнить" })).toBeVisible();
  await shot(page, "my-week");

  // Адресат делает просьбу своей задачей со страницы просьбы
  await loginova.goto(`/requests/${requestNumber}`);
  await loginova.getByRole("button", { name: "Сделать задачей" }).click();
  const toTask = loginova.getByRole("dialog", { name: `Задача из просьбы ${requestNumber}` });
  await expect(toTask.getByText(`Направление возьмём из задачи ${number}`)).toBeVisible();
  await toTask.getByRole("button", { name: "Сделать задачей" }).click();
  await expect(loginova.getByText(/^Задача \d+ поставлена$/)).toBeVisible();
  await expect(loginova.getByText("Задача адресата")).toBeVisible();
  await shot(loginova, "request-page");

  // Автор открывает просьбу из «Мне»: событие об ответе ведёт на страницу просьбы
  await page.goto("/me");
  await page.getByRole("link", { name: new RegExp(`Просьба ${requestNumber}:`) }).first().click();
  await expect(page.getByRole("heading", { name: `Просьба ${requestNumber}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Отозвать" })).toBeVisible();
  await loginova.context().close();
});

test("отклонить можно только с причиной; зависшая просьба видна на встрече", async ({ page, browser }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/me");
  await page.getByRole("button", { name: "Попросить коллегу" }).click();
  const dialog = page.getByRole("dialog", { name: "Попросить коллегу" });
  await dialog.getByLabel("Кого просите").selectOption("fatyanov");
  await dialog.getByLabel("Что нужно").fill("Посмотреть оффер для партнёра");
  await dialog.getByRole("button", { name: "Попросить" }).click();
  await expect(page.getByText(/^Просьба \d+ ушла/)).toBeVisible();
  await page.getByRole("button", { name: "Попросить коллегу" }).click();
  await dialog.getByLabel("Кого просите").selectOption("loginova");
  await dialog.getByLabel("Что нужно").fill("Согласовать текст рассылки");
  await dialog.getByRole("button", { name: "Попросить" }).click();
  await expect(page.getByText(/^Просьба \d+ ушла/).last()).toBeVisible();

  const fatyanov = await second(browser, page, "Фатьянов Евгений");
  await fatyanov.goto("/me");
  await fatyanov.getByRole("button", { name: "Отклонить" }).click();
  const decline = fatyanov.getByRole("dialog", { name: /^Отклонить просьбу/ });
  await decline.getByRole("button", { name: "Отклонить" }).click();
  await expect(decline.getByRole("alert")).toContainText("причину");
  await decline.getByLabel("Причина").fill("Это вопрос к партнёрскому каналу");
  await decline.getByRole("button", { name: "Отклонить" }).click();
  await expect(fatyanov.getByText("Просьба отклонена")).toBeVisible();
  await fatyanov.context().close();

  // Просьба к Логиновой без ответа неделю: попадает на встречу
  await sql(`UPDATE help_requests SET "createdAt" = now() - interval '7 days' WHERE text = 'Согласовать текст рассылки'`);
  await page.goto("/weekly/meeting");
  await page.getByRole("button", { name: /^Вопросы: / }).first().click();
  await expect(page.getByRole("heading", { name: "Зависло: 1" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Согласовать текст рассылки/ })).toBeVisible();
  await shot(page, "meeting");
});
