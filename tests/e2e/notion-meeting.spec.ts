import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 61: разбор встречи из Notion. Ведущий даёт ссылку на страницу встречи, ресурс разбирает её (здесь имитация Notion
// по фикстурам tests/fixtures/notion и без ключа Claude, то есть правилами; второй сценарий с имитацией ответа Claude
// из tests/fixtures/claude), показывает итоги, черновик weekly для CEO и черновики задач. Владелец правит weekly и
// отправляет CEO, CEO видит отчёт и событие в «Мне». Задачи создаются разом после проверки, нераспознанный
// ответственный требует выбора. Ноутбук 1440 и телефон 360 без горизонтальной прокрутки.
// Переменные сервера: NOTION_FAKE_DIR и ANTHROPIC_FAKE_DIR в playwright.config.ts

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

const RULES_URL = "https://www.notion.so/sravni/Vstrecha-top-komandy-20-10-3a4b5c6d7e8f40a1b2c3d4e5f6a7b8c9";
const CLAUDE_URL = "https://www.notion.so/sravni/Vstrecha-top-komandy-27-10-4b5c6d7e8f9041a2b3c4d5e6f7a8b9c0";
const MISSING_URL = "https://www.notion.so/sravni/Ne-rasshareno-9f9f9f9f9f9f49f9a9f9f9f9f9f9f9f9";

const isPhone = () => test.info().project.name === "phone";

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-nm-${name}.png`, fullPage: true });
}

async function personal(browser: Browser, page: Page, slug: string) {
  const p = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: isPhone(), hasTouch: isPhone() })).newPage();
  await enterByLink(p, slug);
  return p;
}

/** Ссылка на страницу Notion в окне со страницы встречи: ресурс открывает страницу разбора */
async function startParse(page: Page, url: string) {
  await page.goto("/weekly/meeting");
  await page.getByTestId("notion-parse-bar").getByRole("button", { name: "Разобрать встречу из Notion" }).click();
  const dialog = page.getByRole("dialog", { name: "Разобрать встречу из Notion" });
  await dialog.getByLabel("Ссылка на страницу встречи в Notion").fill(url);
  await dialog.getByRole("button", { name: "Разобрать", exact: true }).click();
  await expect(page).toHaveURL(/\/meeting\/notion\/[^/?]+/);
}

test.beforeEach(async () => {
  await resetDatabase();
  await sql("DELETE FROM meeting_parses");
  // CEO подключён: профиль ceo включён, структуры компании в тестовой базе нет
  await sql("UPDATE people SET active = true WHERE slug = 'ceo'");
});

test("этап 61: разбор встречи правилами, weekly для CEO с предпросмотром отправлен в приложении, задачи и решение созданы после проверки", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await enterByLink(page, "muradyan");
  await enterManagement(page, "owner");
  await page.goto("/weekly/meeting");
  await expect(page.getByTestId("notion-parse-bar")).toContainText("Итоги встречи из Notion");
  await shot(page, "meeting");

  await startParse(page, RULES_URL);
  // Разбор идёт после ответа экрану: страница сама обновляется, пока статус не сменится
  const method = page.getByTestId("parse-method");
  await expect(method).toContainText("Разобрано правилами", { timeout: 30_000 });
  await expect(method).toContainText("ANTHROPIC_API_KEY");
  const summary = page.getByRole("tabpanel", { name: "Итоги" });
  await expect(summary.getByRole("listitem").filter({ hasText: "Конверсия ОСАГО выросла до 12%" })).toBeVisible();
  await expect(summary.getByRole("listitem").filter({ hasText: "пилот КАСКО для такси запускаем в ноябре" })).toBeVisible();
  await expect(summary.getByRole("listitem").filter({ hasText: "Задержка данных от СК" })).toBeVisible();
  await summary.getByText("Текст страницы из Notion").click();
  await expect(summary.locator("pre")).toContainText("Нужна помощь финансов с выгрузкой");
  await shot(page, "summary");

  // Weekly для CEO (этап 66): черновик по смысловым блокам отчёта CEO, каждая строка с продуктом; правка и отправка
  // только в приложении
  await page.getByRole("tab", { name: "Отчёт руководителю" }).click();
  const products = page.getByTestId("parse-ceo-block-products");
  await expect(products.getByRole("textbox").first()).toHaveValue("Конверсия ОСАГО выросла до 12%");
  await expect(products.getByRole("combobox").first()).toHaveValue("osago");
  await expect(page.getByTestId("parse-ceo-block-partners").getByRole("textbox").first()).toHaveValue("Партнёрский канал отстаёт от плана на 8%");
  const plan = page.getByTestId("parse-ceo-block-plan");
  await plan.getByRole("combobox").first().selectOption("kasko");
  await plan.getByRole("textbox").first().fill("Пилот КАСКО для такси в ноябре");
  await expect(page.getByText(/Получит: CEO/)).toBeVisible();
  // Предпросмотр собранного отчёта: блоки из черновика поверх автосборки недели, решения недели и цифры отчёт CEO соберёт сам
  const preview = page.getByTestId("ceo-preview");
  await expect(preview).toContainText("Что получит CEO: отчёт за неделю");
  await expect(preview.getByRole("region", { name: "План на неделю" })).toContainText("Пилот КАСКО для такси в ноябре");
  await expect(preview.getByRole("region", { name: "Продукты" })).toContainText("Конверсия ОСАГО выросла до 12%");
  await shot(page, "ceo");
  await page.getByRole("button", { name: "Отправить руководителю", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Отправить отчёт руководителю?" });
  await expect(confirm).toContainText("без письма");
  await confirm.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.getByText(/Отчёт отправлен руководителю/).first()).toBeVisible();
  await page.getByRole("tab", { name: "Отчёт руководителю" }).click();
  await expect(page.getByTestId("ceo-sent")).toBeVisible();
  const [report] = await sql(`SELECT "sentAt" IS NOT NULL AS sent, next, blocks IS NOT NULL AS blocks, "sentTo" FROM ceo_reports`);
  expect(report).toMatchObject({ sent: true, blocks: true, sentTo: [expect.objectContaining({ name: "CEO" })] });
  expect(report!.next).toContain("- КАСКО. Пилот КАСКО для такси в ноябре");

  // Задачи: Логинова и Фатьянов узнаны, «Иванов» требует выбора, без него задачи не создаются
  await page.getByRole("tab", { name: /^Задачи/ }).click();
  const drafts = page.getByTestId("task-draft");
  await expect(drafts).toHaveCount(3);
  await expect(drafts.nth(0).getByLabel("Ответственный", { exact: true })).toHaveValue("loginova");
  await expect(drafts.nth(1).getByLabel("Ответственный", { exact: true })).toHaveValue("fatyanov");
  await expect(drafts.nth(2)).toContainText("В тексте встречи «Иванов»");
  await page.getByRole("button", { name: "Создать задачи" }).click();
  await expect(page.getByText(/Выберите ответственного: «созвониться с СК по API»/)).toBeVisible();
  expect((await sql(`SELECT count(*)::int AS n FROM tasks WHERE "sourceNote" LIKE 'Разбор встречи из Notion%'`))[0]!.n).toBe(0);
  await drafts.nth(2).getByLabel("Создать задачу 3").uncheck();
  await drafts.nth(0).getByLabel("Задача", { exact: true }).fill("Прислать выгрузку по убыткам ВЗР");
  // Решения встречи по одному: по умолчанию не записываются, текст можно поправить
  const decision = page.getByTestId("decision-draft").first();
  await expect(decision.getByLabel("Записать решение 1")).not.toBeChecked();
  await decision.getByLabel("Записать решение 1").check();
  await decision.getByLabel("Текст решения 1").fill("Пилот КАСКО для такси запускаем 10 ноября");
  await shot(page, "tasks");
  await page.getByRole("button", { name: "Создать задачи" }).click();
  await expect(page.getByText(/Создано 2 задачи, решений 1/).first()).toBeVisible();
  expect(await sql("SELECT text FROM decisions")).toEqual([{ text: "Пилот КАСКО для такси запускаем 10 ноября" }]);
  await page.getByRole("tab", { name: /^Задачи/ }).click();
  await expect(page.getByTestId("tasks-created")).toContainText("Повторно из этого разбора задачи не создаются");
  await expect(page.getByRole("button", { name: "Создать задачи" })).toHaveCount(0);
  const tasks = await sql(`SELECT title, "sourceCode", o.slug AS owner FROM tasks t JOIN people o ON o.id = t."ownerId" WHERE "sourceNote" LIKE 'Разбор встречи из Notion%' ORDER BY number`);
  expect(tasks).toEqual([
    { title: "Прислать выгрузку по убыткам ВЗР", sourceCode: "meeting", owner: "loginova" },
    { title: "Подготовить план пилота КАСКО для такси", sourceCode: "meeting", owner: "fatyanov" },
  ]);
  await shot(page, "tasks-created");
  // Всё в журнале
  const actions = (await sql(`SELECT action FROM audit_log WHERE action LIKE 'meeting.parse.%' ORDER BY id`)).map((r) => r.action);
  expect(actions).toEqual(expect.arrayContaining(["meeting.parse.start", "meeting.parse.done", "meeting.parse.ceo", "meeting.parse.tasks"]));

  // Страница встречи помнит разбор
  await page.goto("/weekly/meeting");
  await expect(page.getByTestId("notion-parse-bar")).toContainText("Отправлено руководителю, задачи созданы");

  // CEO видит weekly в «Мне» и на странице отчёта CEO, только для чтения
  const ceo = await personal(browser, page, "ceo");
  await ceo.goto("/me");
  // Этап 73: событие ведёт в «Отчёт руководителю», вкладка «Полученные», отчёт команды страхования и инвестиций
  await ceo.getByRole("link", { name: "Отчёт руководителю" }).click();
  await expect(ceo).toHaveURL(/\/leader-report\?tab=received&team=top&week=/);
  const sent = ceo.getByTestId("sent-report");
  await expect(sent).toContainText("Отчёт за неделю");
  // Собранный отчёт по блокам: строки с продуктом, решения недели (решение записано на встрече команды), без кнопок правки
  await expect(sent.getByRole("region", { name: "План на неделю" })).toContainText("Пилот КАСКО для такси в ноябре");
  await expect(sent.getByRole("region", { name: "Продукты" })).toContainText("Конверсия ОСАГО выросла до 12%");
  await expect(sent.getByRole("region", { name: "Решения недели" })).toContainText("Пилот КАСКО для такси запускаем 10 ноября");
  await expect(ceo.getByRole("button", { name: "Сохранить" })).toHaveCount(0);
  await shot(ceo, "ceo-view");
  await ceo.close();
});

test("этап 61: разбор через Claude (имитация ответа), отправка CEO без режима управления недоступна, понятная ошибка Notion", async ({ page }) => {
  test.setTimeout(120_000);
  await enterByLink(page, "muradyan");
  await startParse(page, CLAUDE_URL);
  await expect(page.getByTestId("parse-method")).toContainText("Разобрал Claude", { timeout: 30_000 });
  await expect(page.getByRole("tabpanel", { name: "Итоги" }).getByRole("listitem").filter({ hasText: "Тарифы ВЗР пересматриваем после пилота" })).toBeVisible();
  await shot(page, "claude-summary");

  await page.getByRole("tab", { name: "Отчёт руководителю" }).click();
  await expect(page.getByTestId("parse-ceo-block-products").getByRole("textbox").first()).toHaveValue("ВЗР: тариф не поднимаем до конца года");
  await expect(page.getByTestId("parse-ceo-block-products").getByRole("combobox").first()).toHaveValue("red");
  await expect(page.getByText(/Отправить руководителю может владелец или администратор в режиме управления/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Отправить руководителю/ })).toHaveCount(0);
  // Собранный отчёт с решениями и благодарностями топ-команды только тем, кто отправляет CEO
  await expect(page.getByTestId("ceo-preview")).toHaveCount(0);
  await expect(page.getByTestId("ceo-preview-hidden")).toBeVisible();

  await page.getByRole("tab", { name: /^Задачи/ }).click();
  const drafts = page.getByTestId("task-draft");
  await expect(drafts).toHaveCount(2);
  await expect(drafts.nth(0).getByLabel("Ответственный", { exact: true })).toHaveValue("reva");
  await expect(drafts.nth(1).getByLabel("Ответственный", { exact: true })).toHaveValue("sakhibullina");
  await expect(drafts.nth(1)).toContainText("Павел А.");
  await shot(page, "claude-tasks");
  await page.getByRole("button", { name: "Создать задачи" }).click();
  // Решения по умолчанию не записываются
  await expect(page.getByText(/Создано 2 задачи/).first()).toBeVisible();
  expect((await sql("SELECT count(*)::int AS n FROM decisions"))[0]!.n).toBe(0);
  const [co] = await sql(`SELECT count(*)::int AS n FROM task_co_executors c JOIN tasks t ON t.id = c."taskId" JOIN people p ON p.id = c."personId" WHERE t.title = 'Договориться с двумя агрегаторами' AND p.slug = 'afanasyev'`);
  expect(co!.n).toBe(1);

  // Страница не расшарена на интеграцию: ошибка словами и «Повторить»
  await startParse(page, MISSING_URL);
  const failed = page.getByTestId("parse-failed");
  await expect(failed).toContainText("не расшарена на интеграцию", { timeout: 30_000 });
  await expect(failed.getByRole("button", { name: "Повторить" })).toBeVisible();
  await shot(page, "failed");
});
