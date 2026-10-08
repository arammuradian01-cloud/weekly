import { expect, test, type Browser, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 27 (модуль М12): аналитика руководителя и отчёт CEO 2.0. Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

const STRUCTURE = [
  ["ФИО", "Должность", "Управление", "Отдел", "Сектор", "Руководитель", "Руководит"],
  ["Рева Тарас Игоревич", "CPO", "Управление развития продуктов", "", "", "Мурадян Арам", "да"],
  ["Антонов Дмитрий", "PO OSAGO", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "Рева Тарас", "да"],
  ["Чемоданова Алиса", "Product Designer", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "", ""],
  ["Токов Никита", "Team Lead", "Управление развития продуктов", "Продуктовая аналитика", "", "Рева Тарас", "да"],
  ["Иванова Мария", "Аналитик", "Управление развития продуктов", "Продуктовая аналитика", "", "", ""],
]
  .map((r) => r.join("\t"))
  .join("\n");

const phone = () => test.info().project.name === "phone";

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-an-${name}.png`, fullPage: true });
}

async function person(browser: Browser, page: Page, fullName: string) {
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: phone(), hasTouch: phone() });
  const p = await ctx.newPage();
  const [row] = await sql('SELECT slug FROM people WHERE "fullName" LIKE $1', [`${fullName}%`]);
  await enterByLink(p, row!.slug as string);
  return p;
}

test.describe("аналитика руководителя", () => {
  test.beforeEach(async () => {
    await resetDatabase({ weekly: false });
    const dir = mkdtempSync(join(tmpdir(), "structure-"));
    const file = join(dir, "structure.tsv");
    writeFileSync(file, STRUCTURE);
    execSync(`npx tsx scripts/load-structure.ts ${file} --yes`, { env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL }, stdio: "ignore" });
    // Просроченная задача сектора и перенос срока на этой неделе
    const [sector] = await sql(`SELECT t.id FROM teams t JOIN people p ON p.id = t."leaderId" WHERE p."fullName" LIKE 'Антонов%'`);
    const [alisa] = await sql(`SELECT id FROM people WHERE "fullName" LIKE 'Чемоданова%'`);
    const [dir2] = await sql(`SELECT id FROM dictionary_items WHERE kind = 'DIRECTION' AND code = 'osago'`);
    await sql(
      `INSERT INTO tasks (id, number, title, outcome, "directionId", due, "whereUpdatedAt", "teamId", "ownerId", "updatedAt")
       VALUES ('e2e-an-1', 9101, 'Обновить калькулятор ОСАГО', 'Новые коэффициенты', $1, (now() AT TIME ZONE 'Europe/Moscow')::date - 3, (now() AT TIME ZONE 'Europe/Moscow')::date, $2, $3, now())`,
      [dir2!.id, sector!.id, alisa!.id],
    );
    await sql(`INSERT INTO task_transfers (id, "taskId", "fromDue", "toDue", reason, at) VALUES ('e2e-an-tr', 'e2e-an-1', (now() AT TIME ZONE 'Europe/Moscow')::date - 10, (now() AT TIME ZONE 'Europe/Moscow')::date - 3, 'Ждём данные', now() - interval '1 minute')`);
  });

  test("руководитель открывает аналитику своей команды: задачи сейчас, графики, таблица, карточки лидеров и спуск вниз", async ({ page, browser }) => {
    const reva = await person(browser, page, "Рева");
    if (phone()) {
      // На телефоне аналитика открывается из «Моих команд»
      await reva.goto("/my-teams");
      await reva.getByRole("link", { name: "Аналитика", exact: true }).click();
    } else {
      await reva.getByRole("link", { name: "Аналитика" }).locator("visible=true").first().click();
    }
    await expect(reva).toHaveURL(/\/analytics/);
    await expect(reva.getByRole("heading", { name: "Аналитика", level: 1 })).toBeVisible();
    const main = reva.getByRole("main");
    await expect(main.getByText("Управление развития продуктов", { exact: true }).first()).toBeVisible();

    // Панель открывается быстрее 2 секунд: повторное открытие той же страницы
    const t0 = Date.now();
    await reva.goto(reva.url());
    await expect(reva.getByRole("heading", { name: "Задачи сейчас" })).toBeVisible();
    expect(Date.now() - t0, "панель открывается быстрее 2 секунд").toBeLessThan(2000);

    const now = main.locator("section", { has: reva.getByRole("heading", { name: "Задачи сейчас" }) });
    await expect(now.locator("div", { has: reva.getByText("Просрочено", { exact: true }) }).getByText("1", { exact: true })).toBeVisible();

    // Weekly по неделям: таблица вместо графика и обратно
    const weeklyChart = main.locator("figure", { has: reva.getByText("Сдача weekly по неделям") });
    await weeklyChart.getByRole("button", { name: "Таблицей" }).click();
    await expect(weeklyChart.getByRole("columnheader", { name: "Вовремя, %" })).toBeVisible();
    await expect(weeklyChart.getByRole("row")).toHaveCount(9);
    await weeklyChart.getByRole("button", { name: "Графиком" }).click();
    await expect(weeklyChart.getByRole("img")).toBeVisible();

    // Подсказка при наведении или касании: неделя и значение
    const transfers = main.locator("figure", { has: reva.getByText("Переносы срока", { exact: true }) });
    await transfers.scrollIntoViewIfNeeded();
    const box = (await transfers.locator("svg").boundingBox())!;
    if (phone()) await transfers.locator("svg").tap({ position: { x: box.width - 10, y: box.height / 2 } });
    else await reva.mouse.move(box.x + box.width - 10, box.y + box.height / 2);
    await expect(transfers.locator(".sv-chart__tip")).toContainText(/Неделя \d+, идёт/);
    await expect(transfers.locator(".sv-chart__tip")).toContainText("Переносов 1");

    // Карточки лидеров уровнем ниже, без рейтинга
    await expect(main.getByRole("heading", { name: /Лидеры/ })).toBeVisible();
    const antonov = main.getByRole("listitem", { name: "Карточка: Антонов Дмитрий" });
    const tokov = main.getByRole("listitem", { name: "Карточка: Токов Никита" });
    await expect(antonov).toBeVisible();
    await expect(tokov).toBeVisible();
    await expect(antonov.locator("div", { has: reva.getByText("Переносов срока за 8 недель") }).getByText("1", { exact: true })).toBeVisible();
    await shot(reva, "team");

    // Топ-команду руководитель управления не открывает: показывается своя
    await reva.goto("/analytics?team=top");
    await expect(main.locator('[aria-current="page"]').getByText("Управление развития продуктов")).toBeVisible();

    // Спуск в сектор: команд ниже нет
    await antonov.getByRole("link", { name: "Задачи и люди" }).click();
    await expect(reva).toHaveURL(/\/my-teams\?team=/);
    await reva.goBack();
    const [sector] = await sql(`SELECT t.id FROM teams t JOIN people p ON p.id = t."leaderId" WHERE p."fullName" LIKE 'Антонов%'`);
    const before = reva.url();
    await reva.getByRole("main").getByLabel("Команда", { exact: true }).selectOption(sector!.id as string);
    // Выбор в списке сам не переходит: команда открывается по «Показать»
    await reva.waitForTimeout(300);
    expect(reva.url()).toBe(before);
    await reva.getByRole("button", { name: "Показать" }).click();
    await expect(reva).toHaveURL(new RegExp(`/analytics\\?team=${sector!.id}`));
    await expect(reva.getByText("Ниже этой команды других команд нет.")).toBeVisible();
    await shot(reva, "sector");
    await reva.close();
  });

  test("сотрудник без команды: пункта меню нет, страница объясняет, кому открыта аналитика", async ({ page, browser }) => {
    const ivanova = await person(browser, page, "Иванова");
    await expect(ivanova.getByRole("link", { name: "Аналитика" })).toHaveCount(0);
    await ivanova.goto("/analytics");
    await expect(ivanova.getByText("Аналитика открыта руководителям команд")).toBeVisible();
    await ivanova.close();
  });
});

test.describe("отчёт CEO 2.0", () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test("решения недели, встречи недели, подтверждение «Собрать заново», сравнение с прошлой неделей, копия и письмо", async ({ page }) => {
    await enter(page, "Мурадян Арам");
    await enterManagement(page, "owner");
    // Решение топ-команды без встречи, в среду недели 39
    await sql(`INSERT INTO decisions (id, "teamId", text, date, "updatedAt") VALUES ('e2e-dec-39', 'top', 'Запускаем пилот ОСАГО с партнёром в ноябре', '2026-09-23', now())`);

    await page.goto("/ceo-report?week=2026-09-21");
    const decisions = page.locator("section", { has: page.getByRole("heading", { name: "Решения недели" }) });
    await expect(decisions.getByText("Запускаем пилот ОСАГО с партнёром в ноябре")).toBeVisible();

    // «Собрать заново» спрашивает подтверждение: «Отмена» оставляет правки
    const mainField = page.getByLabel("Главное за неделю");
    const built = await mainField.inputValue();
    await mainField.fill(`${built}\n- Моя правка руками`);
    await page.getByRole("button", { name: "Собрать заново" }).click();
    const dialog = page.getByRole("dialog", { name: "Собрать отчёт заново?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Отмена" }).click();
    await expect(mainField).toHaveValue(/Моя правка руками/);
    await page.getByRole("button", { name: "Собрать заново" }).click();
    await dialog.getByRole("button", { name: "Собрать заново" }).click();
    await expect(mainField).not.toHaveValue(/Моя правка руками/);

    // Встреча недели: 4-5 предложений от первого лица, подсказка считает предложения
    await mainField.fill(`${built}\n- Главное недели 39`);
    await page.getByRole("button", { name: "Добавить встречу" }).click();
    await page.getByLabel("Встреча 1: с кем и о чём").fill("Встреча с партнёрами по ноябрю");
    await page.getByLabel("Встреча 1: что важно").fill("Обсуждали условия на ноябрь. Договорились о скидке для новых клиентов.");
    await expect(page.getByText("2 предложения. Хорошо, когда их 4-5")).toBeVisible();
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByText("Отчёт за неделю 39 сохранён").first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Встреча 1: с кем и о чём")).toHaveValue("Встреча с партнёрами по ноябрю");

    // Копия текста: разделы по порядку ТЗ
    if (!phone()) {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.getByRole("button", { name: "Скопировать текст" }).click();
      await expect(page.getByText("Текст отчёта скопирован").first()).toBeVisible();
      const text = await page.evaluate(() => navigator.clipboard.readText());
      const order = ["Главное за неделю", "Решения недели", "Риски", "Что дальше", "Мои встречи недели"].map((h) => text.indexOf(`\n${h}\n`));
      expect(order.every((i) => i > 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(text).toContain("- Запускаем пилот ОСАГО с партнёром в ноябре");
    }

    // Черновик письма: тема в ссылке. Отчёт длинный и в адрес письма не влезает: в письме подсказка вставить текст,
    // сам текст по нажатию уходит в буфер обмена
    const mail = page.getByRole("link", { name: "Открыть письмом" });
    const href = (await mail.getAttribute("href"))!;
    const url = new URL(href);
    expect(url.protocol).toBe("mailto:");
    expect(href.length).toBeLessThanOrEqual(1900);
    expect(url.searchParams.get("subject")).toBe("Отчёт за неделю 39");
    expect(url.searchParams.get("body")).toBe("Полный текст отчёта скопирован в буфер обмена: вставьте его сюда.");
    await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-an-ceo-report.png`, fullPage: true });

    // Неделя 40: сравнение с отчётом недели 39
    await page.goto("/ceo-report?week=2026-09-28");
    await page.getByRole("button", { name: "Сравнить с прошлой неделей" }).click();
    await expect(page.getByText("Неделя 39").first()).toBeVisible();
    await expect(page.getByText("- Главное недели 39")).toBeVisible();
    await expect(page.getByText("Встреча с партнёрами по ноябрю")).toBeVisible();
    await page.getByRole("button", { name: "Скрыть прошлую неделю" }).click();
    await expect(page.getByText("- Главное недели 39")).toHaveCount(0);
    // Неделя 41: прошлый отчёт не сохраняли
    await page.goto("/ceo-report?week=2026-10-05");
    await page.getByRole("button", { name: "Сравнить с прошлой неделей" }).click();
    await expect(page.getByText("Отчёт за неделю 40 не сохраняли: сравнивать не с чем.")).toBeVisible();
    await shot(page, "ceo-compare");
  });

  test("сохранение поверх чужого отчёта: понятная ошибка, а не тихая перезапись", async ({ page, browser }) => {
    await enter(page, "Мурадян Арам");
    await enterManagement(page, "owner");
    await page.goto("/ceo-report?week=2026-09-21");
    // Второе устройство открыло тот же отчёт и сохранило раньше
    const other = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: phone(), hasTouch: phone() })).newPage();
    await enter(other, "Мурадян Арам");
    await enterManagement(other, "owner");
    await other.goto("/ceo-report?week=2026-09-21");
    await other.getByLabel("Риски").fill("- Риск со второго устройства");
    await other.getByRole("button", { name: "Сохранить" }).click();
    await expect(other.getByText("Отчёт за неделю 39 сохранён").first()).toBeVisible();
    await other.close();

    await page.getByLabel("Риски").fill("- Риск с первого устройства");
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByText(/уже сохранён с другого устройства или другим человеком/).first()).toBeVisible();

    // Страница обновилась сама (вкладка снова на виду): набранное не пропадает, видно предупреждение
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByText(/Отчёт за эту неделю сохранён на другом устройстве или другим человеком/)).toBeVisible();
    await expect(page.getByLabel("Риски")).toHaveValue("- Риск с первого устройства");
    await page.getByRole("button", { name: "Показать сохранённую версию" }).click();
    await expect(page.getByLabel("Риски")).toHaveValue("- Риск со второго устройства");

    // Своё сохранение после этого проходит, и обновление страницы не стирает то, что набрано после него
    await page.getByLabel("Что дальше").fill("- Дальше с первого устройства");
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByText("Отчёт за неделю 39 сохранён").first()).toBeVisible();
    await page.getByLabel("Риски").fill("- Набрано после сохранения");
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(1500);
    await expect(page.getByLabel("Риски")).toHaveValue("- Набрано после сохранения");
    await expect(page.getByText("Есть несохранённые правки")).toBeVisible();
  });
});
