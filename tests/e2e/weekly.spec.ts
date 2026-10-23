import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterManagement, resetDatabase, sql } from "./helpers";

// Weekly на настоящей базе (этап 4): лента, черновик и сдача, отчёт CEO, закрытие недели.
// Каждый сценарий идёт и на ноутбуке 1440, и на телефоне 360: это и есть приёмка «сдать неделю с телефона и ноутбука»

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

test.beforeEach(async () => {
  await resetDatabase();
});

async function shot(page: Page, name: string) {
  // Ширина из настроек проекта, а не window.innerWidth: на телефоне широкая страница растягивает окно и прокрутку не видно
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-w-${name}.png`, fullPage: true });
}

test("лента weekly: последняя разобранная неделя и общие записи без автора", async ({ page }) => {
  await enter(page, "Головкин Владислав");
  await page.goto("/weekly");
  await expect(page.getByText(/За неделю \d+ записей пока нет\. Показана неделя 39/)).toBeVisible();
  await expect(page.getByText("Неделя закрыта: записи правят только владелец и администраторы")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Общее, без автора/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Рева Тарас" })).toBeVisible();
  await page.getByRole("radio", { name: "По блокам" }).click();
  await expect(page.getByRole("heading", { name: /^Цифры и прогноз/ })).toBeVisible();

  // Неделя 38 тоже на месте: её разбирали на встрече 22 сентября
  await page.goto("/weekly?week=2026-09-14");
  await expect(page.getByText(/Неделя 38/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Общее, без автора|Рева Тарас|Головкин Владислав/ }).first()).toBeVisible();
  await shot(page, "feed-38");
});

test("weekly человека по ссылке: отбор по автору в адресе, смена недели его сохраняет", async ({ page }) => {
  await enter(page, "Головкин Владислав");
  await page.goto("/weekly?author=reva");
  // Отбор включён и виден сразу, на телефоне тоже: фильтры раскрыты
  await expect(page.locator("#f-author")).toBeVisible();
  await expect(page.locator("#f-author")).toHaveValue("reva");
  await expect(page.getByRole("heading", { name: "Рева Тарас" })).toBeVisible();
  // Только карточка Ревы: ни общих записей, ни пустых карточек остальных
  await expect(page.getByRole("heading", { name: /Общее, без автора/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Головкин Владислав" })).toHaveCount(0);
  await expect(page.getByTestId("weekly-focus-elsewhere")).toHaveCount(0);
  await shot(page, "author-focus");

  // Смена недели сохраняет отбор
  await page.getByRole("button", { name: "Предыдущая неделя" }).click();
  await expect(page).toHaveURL(/week=2026-09-14&author=reva/);
  await expect(page.locator("#f-author")).toHaveValue("reva");

  // Сняли отбор: адрес без автора, лента целиком. Живое обновление экрана старый адрес не возвращает
  await page.locator("#f-author").selectOption("");
  await expect(page).not.toHaveURL(/author=/);
  await expect(page.getByRole("heading", { name: /Общее, без автора|Головкин Владислав/ }).first()).toBeVisible();
  const refreshed = page.waitForResponse((r) => new URL(r.url()).pathname === "/weekly" && r.request().headers()["rsc"] === "1" && !r.request().headers()["next-router-prefetch"]);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await refreshed;
  await expect(page).not.toHaveURL(/author=/);
  await expect(page.locator("#f-author")).toHaveValue("");
  // Выбрали автора руками: адрес с ним переживает и обновление, и перезагрузку
  await page.locator("#f-author").selectOption("reva");
  await expect(page).toHaveURL(/author=reva/);
  const again = page.waitForResponse((r) => new URL(r.url()).pathname === "/weekly" && r.request().headers()["rsc"] === "1" && !r.request().headers()["next-router-prefetch"]);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await again;
  await expect(page).toHaveURL(/author=reva/);
  await page.reload();
  await expect(page.locator("#f-author")).toHaveValue("reva");
  await page.locator("#f-author").selectOption("");

  // Автор из адреса без записей за неделю: понятная пустая лента с выходом
  await page.goto("/weekly?week=2026-09-14&author=afanasyev");
  await expect(page.locator("#f-author")).toHaveValue("afanasyev");
  await expect(page.getByText("Афанасьев Павел: за неделю 38 записей нет")).toBeVisible();
  await page.getByRole("button", { name: "Показать все записи" }).click();
  await expect(page).not.toHaveURL(/author=/);
  await expect(page.getByRole("heading", { name: "Рева Тарас" })).toBeVisible();

  // Неизвестный человек в адресе: обычная лента без отбора
  await page.goto("/weekly?author=nobody-here");
  await expect(page.locator("#f-author")).toHaveValue("");
  await expect(page.getByRole("heading", { name: /Общее, без автора/ })).toBeVisible();
});

test("лидер сдаёт weekly в три шага, черновик живёт на сервере", async ({ page }) => {
  await enter(page, "Афанасьев Павел");
  await page.getByRole("link", { name: "Сдать weekly" }).click();
  await expect(page).toHaveURL(/\/weekly\/submit$/);
  await expect(page.getByRole("button", { name: "Сдать weekly" })).toBeDisabled();

  // Главная фраза сохраняется сама: перезагрузка её не теряет
  await page.getByLabel("Главное одной фразой").fill("Договорились с двумя дилерами о пилоте");
  await expect(page.getByText(/Черновик сохранён в \d{2}:\d{2}/)).toBeVisible({ timeout: 8000 });
  await page.reload();
  await expect(page.getByLabel("Главное одной фразой")).toHaveValue("Договорились с двумя дилерами о пилоте");

  // Запись тоже сохраняется сама, ещё до кнопки
  await page.getByRole("button", { name: "Добавить запись" }).click();
  await page.getByLabel("Что произошло").fill("Два дилера готовы к пилоту в ноябре");
  await page.getByLabel("Цифра или факт").fill("Два письма о намерениях");
  await expect(page.getByText("Черновик записи сохранён")).toBeVisible({ timeout: 8000 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Два дилера готовы к пилоту в ноябре" })).toBeVisible();
  await expect(page.getByText("Два письма о намерениях")).toBeVisible();
  await shot(page, "submit-draft");

  await page.getByRole("button", { name: "Сдать weekly" }).click();
  await expect(page.getByText(/Weekly сдан|Сдан с опозданием/).first()).toBeVisible();

  // Лента отчётной недели: запись видна всем, полоса сдачи учла Павла
  await page.goto("/weekly");
  await expect(page.getByText(/записей пока нет/)).toHaveCount(0);
  await expect(page.getByText(/Сдали 1 из 8/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Два дилера готовы к пилоту в ноябре" })).toBeVisible();
  await shot(page, "feed-after-submit");

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Открыть мой weekly" })).toBeVisible();
  // Блок «Сейчас» (этап 44): заголовок, состояние и число записей
  const now = page.locator("section", { has: page.getByRole("heading", { name: /Мой weekly за неделю \d+/ }) });
  await expect(now.getByText(/1\s*запись/)).toBeVisible();
});

test("удаление записи спрашивает подтверждение и отменяется кнопкой «Отменить» (этап 7)", async ({ page }) => {
  await enter(page, "Афанасьев Павел");
  await page.goto("/weekly/submit");
  await page.getByRole("button", { name: "Добавить запись" }).click();
  await page.getByLabel("Что произошло").fill("Запись для проверки удаления");
  await page.getByRole("button", { name: "Сохранить запись" }).click();
  const heading = page.getByRole("heading", { name: "Запись для проверки удаления" });
  await expect(heading).toBeVisible();

  // Сначала окно подтверждения: «Не удалять» оставляет запись на месте
  await page.getByRole("button", { name: "Удалить запись «Запись для проверки удаления»" }).click();
  const dialog = page.getByRole("dialog", { name: "Удалить запись?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Не удалять" }).click();
  await expect(heading).toBeVisible();

  // Удалили и сразу отменили: запись вернулась и пережила перезагрузку
  await page.getByRole("button", { name: "Удалить запись «Запись для проверки удаления»" }).click();
  await page.getByRole("dialog", { name: "Удалить запись?" }).getByRole("button", { name: "Удалить" }).click();
  await expect(page.getByText("Запись удалена")).toBeVisible();
  await expect(heading).toHaveCount(0);
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect(page.getByText("Запись возвращена")).toBeVisible();
  await expect(heading).toBeVisible();
  await page.reload();
  await expect(heading).toBeVisible();
  await shot(page, "entry-restored");
});

test("по записи weekly ставится задача, человек остаётся на экране сдачи", async ({ page }) => {
  await enter(page, "Афанасьев Павел");
  await page.goto("/weekly/submit");
  await page.getByRole("button", { name: "Добавить запись" }).click();
  await page.getByLabel("Что произошло").fill("Партнёр просит новый тариф для такси");
  await page.getByLabel("Что делаем дальше").fill("Подготовить тариф для такси");
  await expect(page.getByText("Черновик записи сохранён")).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "Сделать задачей" }).click();
  const dialog = page.getByRole("dialog", { name: "Новая задача" });
  await expect(dialog.getByLabel("Задача", { exact: true })).toHaveValue("Подготовить тариф для такси");
  await dialog.getByRole("button", { name: "Поставить задачу" }).click();
  await expect(page).toHaveURL(/\/weekly\/submit$/);
  await expect(page.getByText("По записи уже есть задача 52")).toBeVisible();
  await page.getByRole("button", { name: "Сохранить запись" }).click();
  await expect(page.getByRole("link", { name: "Задача 52" })).toBeVisible();
});

test("владелец отмечает записи в отчёт CEO, отчёт собирается и сохраняется", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");

  // Отметка в ленте недели 39
  await page.goto("/weekly?week=2026-09-21");
  // Этап 68: при трёх лидерах и больше записи свёрнуты, кнопка «В отчёт CEO» внутри раскрытой карточки
  await page.getByRole("button", { name: "Развернуть всех" }).click();
  const unflagged = page.locator("article").filter({ has: page.getByRole("button", { name: "В отчёт CEO", exact: true }) }).first();
  const what = (await unflagged.locator("h3").textContent())!.trim();
  await unflagged.getByRole("button", { name: "В отчёт CEO", exact: true }).click();
  await expect(page.getByText("Запись попадёт в отчёт CEO").first()).toBeVisible();

  await page.goto("/ceo-report?week=2026-09-21");
  // Этап 47: число отметок только в цифрах панели, в подписи его больше нет
  await expect(page.getByTestId("ceo-fig-flags")).toContainText(/13\s*отметок «В отчёт CEO»/);
  // Этап 66: отчёт по смысловым блокам. Отмеченная запись в своём блоке строкой с продуктом
  const texts = await page.getByTestId("ceo-editor").getByRole("textbox").evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
  expect(texts.join("\n")).toContain(what.replace(/\.$/, ""));

  const risks = page.getByTestId("ceo-block-risks");
  await risks.getByRole("button", { name: "Добавить строку" }).click();
  await risks.getByRole("textbox").last().fill("Проверка сохранения отчёта");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Отчёт за неделю 39 сохранён").first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("ceo-block-risks").getByRole("textbox").last()).toHaveValue("Проверка сохранения отчёта");
  await expect(page.getByText(/^Сохранён \d+ октября/).first()).toBeVisible();
  await shot(page, "ceo-report");
});

test("администратор закрывает неделю, лидер больше не правит", async ({ page, browser }) => {
  await enter(page, "Головкин Владислав");
  await enterManagement(page, "admin");
  await page.goto("/weekly");
  await page.getByRole("link", { name: /^Открыть неделю \d+$/ }).click();
  await page.getByRole("button", { name: "Закрыть неделю" }).click();
  await expect(page.getByText(/Неделя \d+ закрыта/).first()).toBeVisible();

  const leader = await (await browser.newContext()).newPage();
  await enter(leader, "Сахибуллина Алсу");
  await leader.goto("/weekly/submit");
  await expect(leader.getByText(/Неделя \d+ закрыта: записи правят только владелец и администраторы/)).toBeVisible();
  await expect(leader.getByRole("button", { name: "Добавить запись" })).toHaveCount(0);
  await expect(leader.getByRole("button", { name: "Сдать weekly" })).toBeDisabled();
  await leader.close();

  await page.getByRole("button", { name: "Открыть неделю" }).click();
  await expect(page.getByText(/Неделя \d+ снова открыта/).first()).toBeVisible();
});

test("режим встречи по умолчанию открывает отчётную неделю; прошлые записи доступны при явном выборе", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  const [{ key }] = await sql(`WITH n AS (SELECT now() AT TIME ZONE 'Europe/Moscow' AS m), c AS (SELECT m, date_trunc('week', m)::date AS mon FROM n) SELECT to_char(CASE WHEN m < mon + interval '42 hours' THEN mon - 7 ELSE mon END, 'YYYY-MM-DD') AS key FROM c`);
  const [{ old }] = await sql(`SELECT to_char(w.start, 'YYYY-MM-DD') AS old FROM weeks w WHERE EXISTS (SELECT 1 FROM weekly_entries e WHERE e."weekId" = w.id) ORDER BY w.start DESC LIMIT 1`);
  expect(old).not.toBe(key);
  // Лента может показывать последнюю заполненную неделю, кнопка встречи должна вести на отчётную.
  // Проверяем записи слайда: рядом могут быть заголовки сводки плана, не относящиеся к weekly.
  await page.goto("/weekly");
  await expect(page.locator('a[href*="/weekly/meeting"]')).toHaveAttribute("href", `/weekly/meeting?week=${key}`);
  await page.goto("/weekly/meeting");
  await expect(page.getByTestId("meeting-week")).toContainText("отчётная");
  await expect(page.locator('section[aria-live="polite"]').getByRole("heading", { level: 1, name: "Риски и запросы помощи" })).toBeVisible();
  await expect(page.getByText("Рисков и запросов помощи на этой неделе нет.", { exact: true })).toBeVisible();
  await expect(page.locator('section[aria-live="polite"] article.sv-entry')).toHaveCount(0);
  await shot(page, "meeting-current-empty");
  // Явно выбранная прошлая неделя сохраняется и в ленте, и во встрече.
  await page.goto(`/weekly?week=${old}`);
  await expect(page.locator('a[href*="/weekly/meeting"]')).toHaveAttribute("href", `/weekly/meeting?week=${old}`);
  await page.goto(`/weekly/meeting?week=${old}`);
  await expect(page.getByTestId("meeting-week")).toContainText("Прошлая неделя");
  await expect(page.getByText(/Риски и запросы помощи/).first()).toBeVisible();
  const [risk] = await sql(`SELECT e.what FROM weekly_entries e JOIN weeks w ON w.id = e."weekId" JOIN dictionary_items t ON t.id = e."typeId" WHERE w.start = $1::date AND (t.code = 'risk' OR COALESCE(e.help, '') <> '') ORDER BY e."sortOrder", e."createdAt" LIMIT 1`, [old]);
  expect(risk).toBeTruthy();
  await expect(page.locator('section[aria-live="polite"] article.sv-entry').getByRole("heading", { name: risk.what, exact: true })).toBeVisible();
  await shot(page, "meeting");
  await page.getByRole("button", { name: "Текущая", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`week=${key}$`));
  await expect(page.locator('section[aria-live="polite"]').getByRole("heading", { level: 1, name: "Риски и запросы помощи" })).toBeVisible();
  await expect(page.getByText("Рисков и запросов помощи на этой неделе нет.", { exact: true })).toBeVisible();
  await expect(page.locator('section[aria-live="polite"] article.sv-entry')).toHaveCount(0);
});
