// Снимки экранов для проверки «вид не изменился». Данные одни и те же: база сбрасывается к выгрузке Bord.
// Меняющиеся во времени места (сколько осталось до срока, до скольких действует режим управления, время событий)
// закрываются маской.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { enter, enterManagement, resetDatabase } from "../e2e/helpers";

// Много экранов в одном сценарии: больше времени, чем у обычного теста
test.setTimeout(240_000);

test.beforeEach(async () => {
  await resetDatabase();
});

function volatile(page: Page): Locator[] {
  return [
    page.getByText(/Осталось \d/),
    page.getByText(/Режим управления до \d/),
    page.getByText(/^(Доброе утро|Добрый день|Добрый вечер|Доброй ночи)/),
    page.locator("[data-volatile]"),
  ];
}

/**
 * Время на экране меняется каждую минуту и меняет ширину надписей. Перед снимком часы и длительности
 * заменяются одинаковыми значениями, тогда раскладка совпадает от прогона к прогону
 */
async function normalize(page: Page) {
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      const before = node.data;
      const after = before
        .replace(/\b\d{1,2}:\d{2}\b/g, "00:00")
        .replace(/\d+ д \d+ ч(?![а-яё])/g, "1 д 1 ч")
        .replace(/\d+ ч \d+ мин(?![а-яё])/g, "1 ч 1 мин")
        .replace(/(?<![\d ч] )\d+ мин(?![а-яё])/g, "1 мин")
        .replace(/^(Доброе утро|Добрый день|Добрый вечер|Доброй ночи)/, "Добрый день")
        // Журнал растёт от прогона к прогону: число событий одинаковое для снимка
        .replace(/^\d+ событи[а-яё]*/, "100 событий");
      if (after !== before) node.data = after;
    }
  });
}

async function shot(page: Page, name: string, extra: Locator[] = []) {
  await page.waitForLoadState("networkidle");
  // Шрифты дорисовываются после загрузки: ждём их, иначе снимок плавает
  await page.evaluate(() => document.fonts.ready);
  await normalize(page);
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, mask: [...volatile(page), ...extra] });
}

test("без входа: вход и неверная ссылка", async ({ page }) => {
  await page.goto("/login");
  await shot(page, "login");
  await page.goto("/login/link?t=nope");
  await shot(page, "login-link-bad");
});

test("лидер: неделя, weekly, задачи, команда, инструкция, профиль, 404", async ({ page }) => {
  await enter(page, "Рева Тарас");
  for (const [path, name] of [
    ["/", "my-week"],
    ["/weekly", "weekly-feed"],
    ["/weekly/submit", "weekly-submit"],
    ["/tasks", "tasks"],
    ["/tasks/mine", "tasks-mine"],
    ["/tasks/board", "tasks-board"],
    ["/tasks/12", "task-12"],
    ["/team", "team"],
    ["/help", "help"],
    ["/profile", "profile"],
    ["/nope", "not-found"],
  ] as const) {
    await page.goto(path);
    await shot(page, `leader-${name}`);
  }
  // Меню профиля открыто: тень и пункты меню
  await page.goto("/");
  await page.getByRole("button", { name: /^Профиль:/ }).filter({ visible: true }).first().click();
  await expect(page.getByRole("menu")).toBeVisible();
  await shot(page, "leader-profile-menu");
});

test("владелец в режиме управления: встреча, разбор, журнал, настройки, синхронизация, отчёт CEO, образец", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  for (const [path, name] of [
    ["/", "my-week"],
    ["/weekly/meeting", "meeting"],
    ["/tasks/review", "review"],
    ["/settings", "settings"],
    ["/sync", "sync"],
    ["/ceo-report", "ceo-report"],
  ] as const) {
    await page.goto(path);
    await shot(page, `owner-${name}`);
  }
  // Журнал только дописывается и растёт от прогона к прогону: сравниваем шапку и фильтры, сами события закрыты маской
  await page.goto("/journal");
  await page.waitForLoadState("networkidle");
  await normalize(page);
  await expect(page).toHaveScreenshot("owner-journal.png", { mask: [...volatile(page), page.locator("table"), page.locator("ul.divide-y")] });
  // Окно со ссылкой для входа: сама ссылка каждый раз новая
  await page.goto("/settings");
  await page.getByRole("button", { name: "Ссылка для входа: Рева Тарас" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "owner-invite-modal", [page.getByLabel("Ссылка"), page.getByText(/Действует до/)]);
  await page.keyboard.press("Escape");
  // Образец компонентов последним: на этапе 10 он меняется намеренно (токены), остальные снимки сравниваются до него
  await page.goto("/ui");
  await shot(page, "owner-ui-sample");
});
