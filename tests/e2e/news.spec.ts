// Этап 60: новости по продуктам. Ленты из фикстур (NEWS_FAKE=1 и WEEKLY_E2E=1 на тестовом сервере): владелец добавляет
// источники, запускает забор кнопкой (он идёт в фоне, итог после обновления), видит ошибку недоступной ленты,
// включает строгую привязку, удаляет источник
// с подтверждением; раздел «Новости» с фильтром в адресе и честной подписью описания; блок на главной;
// дайджест настраивается в профиле при личном входе; «Мои продукты» без продуктов пустые с подсказкой.
// Этап 59: лента компактная: описание страницы в одну строку, описание новости не длиннее двух строк, подпись начала
// анонса только для диктора, продукты фильтра в одну строку (на телефоне с прокруткой), в карточке на телефоне два
// продукта и «+N». Ноутбук 1440 и телефон 360
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, enterTeam, resetDatabase, sql } from "./helpers";

const SHOTS = "tests/e2e/screenshots";
const isPhone = () => test.info().project.name === "phone";
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-news-${name}.png`, fullPage: true });
}

async function resetNews() {
  await sql("DELETE FROM news_digests");
  await sql("DELETE FROM news_items");
  await sql("DELETE FROM news_sources");
  await sql("DELETE FROM settings WHERE key IN ('news.keywords', 'news.lastFetchAt', 'news.claude.status', 'news.manualFetch', 'news.loop.startedAt')");
  await sql(`UPDATE people SET "newsPrefs" = '{}'::jsonb`);
}

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
  await resetNews();
});

test("владелец ведёт источники и забирает ленты, раздел «Новости» с фильтром, блок на главной", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/settings#news");
  const section = page.getByTestId("news-section");
  await expect(section.getByRole("heading", { name: "Новости" })).toBeVisible();
  await expect(page.getByTestId("news-claude")).toContainText("не подключено");

  // Два живых источника из фикстур и один несуществующий
  for (const [name, url] of [
    ["Банк России", "https://www.cbr.ru/rss/RssPress"],
    ["АСН", "https://www.asn-news.ru/rss"],
    ["Нет такой ленты", "https://nowhere.example/rss"],
  ]) {
    await page.getByTestId("news-add-source").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Название").fill(name!);
    await dialog.getByLabel("Адрес ленты").fill(url!);
    await page.getByTestId("news-source-save").click();
    await expect(page.getByText("Источник добавлен").first()).toBeVisible();
    await expect(dialog).toBeHidden();
  }
  // Внутренний адрес и нестандартный порт не принимаются
  await page.getByTestId("news-add-source").click();
  await page.getByRole("dialog").getByLabel("Название").fill("Локальный");
  await page.getByRole("dialog").getByLabel("Адрес ленты").fill("http://localhost:3000/rss");
  await page.getByTestId("news-source-save").click();
  await expect(page.getByText("Адрес не разрешён: внутренняя сеть").first()).toBeVisible();
  await page.getByRole("dialog").getByLabel("Адрес ленты").fill("https://feed.example:8080/rss");
  await page.getByTestId("news-source-save").click();
  await expect(page.getByText("Адрес не разрешён: только порты 80 и 443").first()).toBeVisible();
  await page.keyboard.press("Escape");

  // «Забрать сейчас» не держит запрос: экран сразу говорит «Забор запущен», итог появляется после обновления
  await page.getByTestId("news-fetch-now").click();
  await expect(page.getByText("Забор запущен").first()).toBeVisible();
  await expect
    .poll(async () => ((await sql("SELECT value->>'running' AS running FROM settings WHERE key = 'news.manualFetch'"))[0]?.running as string | undefined) ?? "", { timeout: 30_000 })
    .toBe("false");
  await page.reload();
  await expect(page.getByTestId("news-fetch-report")).toContainText("лент 3, новых новостей 4, с ошибкой 1");
  await expect(page.getByTestId("news-fetch-report")).toHaveAttribute("data-running", "no");
  const sources = page.getByTestId("news-sources");
  await expect(sources.getByText("Работает")).toHaveCount(2);
  await expect(sources.getByTestId("news-source-error")).toContainText("Сервер ответил 404");
  const [{ count }] = await sql("SELECT count(*)::int AS count FROM news_items");
  expect(count).toBe(4);
  await shot(page, "settings");

  // Строгая привязка для общей ленты: отметка в окне источника и метка в списке
  const missing = sources.locator("li", { hasText: "Нет такой ленты" });
  await missing.getByRole("button", { name: /Изменить источник/ }).click();
  await page.getByTestId("news-source-strict").check();
  await page.getByTestId("news-source-save").click();
  await expect(page.getByText("Источник изменён").first()).toBeVisible();
  await expect(missing.getByText("Два признака продукта")).toBeVisible();

  // Удаление с подтверждением: «Отмена» ничего не удаляет
  await missing.getByTestId("news-source-remove").click();
  const confirm = page.getByRole("dialog", { name: "Удалить источник?" });
  await expect(confirm).toContainText("Если лента временно не работает, лучше выключить её");
  await confirm.getByRole("button", { name: "Отмена" }).click();
  await expect(missing).toBeVisible();
  await missing.getByTestId("news-source-remove").click();
  await page.getByTestId("news-source-remove-confirm").click();
  await expect(page.getByText("Источник удалён").first()).toBeVisible();
  await expect(sources.locator("li", { hasText: "Нет такой ленты" })).toHaveCount(0);

  // Ключевые слова: пустое поле выключает продукт
  const kw = page.getByTestId("news-keywords");
  await kw.getByLabel("КАСКО").fill("");
  await page.getByTestId("news-keywords-save").click();
  await expect(page.getByText("Ключевые слова сохранены").first()).toBeVisible();
  const [row] = await sql("SELECT value FROM settings WHERE key = 'news.keywords'");
  expect((row!.value as Record<string, string[]>).kasko).toEqual([]);

  // Раздел «Новости»: все, фильтр по продукту в адресе
  await page.goto("/news");
  await expect(page.getByRole("heading", { name: "Новости", level: 1 })).toBeVisible();
  await expect(page.getByTestId("news-item")).toHaveCount(4);
  // Этап 68: новости регулятора и союзов повторяются в колонке «Официально» (от 1280 px), поэтому ищем в ленте
  await expect(page.getByTestId("news-list").getByText("Банк России обсудил со страховщиками изменения в тарифах ОСАГО")).toBeVisible();
  const link = page.getByRole("link", { name: /Страховщики подвели итоги продаж КАСКО/ });
  await expect(link).toHaveAttribute("href", "https://www.asn-news.ru/news/1?utm_campaign=rss");
  await expect(link).toHaveAttribute("target", "_blank");
  // Без Claude описание честно подписано: это начало анонса источника. Подпись для диктора, глазу она не видна
  await expect(page.getByTestId("news-summary").first()).toContainText("Начало анонса источника:");
  const label = page.getByTestId("news-summary").first().getByText("Начало анонса источника:");
  expect((await label.boundingBox())!.width, "подпись «Начало анонса источника» видна глазу").toBeLessThanOrEqual(1);
  // Описание страницы одной фразой со временем обновления без секунд
  await expect(page.getByTestId("news-updated")).toHaveText(/^Новости рынка по продуктам\. Обновлено (сегодня|вчера|\d{1,2} [а-я]+( \d{4})?) в \d{2}:\d{2}\.$/);
  // Описание новости не длиннее двух строк: у длинного анонса на телефоне было четыре
  for (const summary of await page.getByTestId("news-summary").all()) {
    const lines = await summary.evaluate((el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
    expect(lines, "описание новости длиннее двух строк").toBeLessThanOrEqual(2.05);
  }
  // Продукты фильтра в одну строку: на телефоне строка прокручивается вбок, страница нет (проверяет shot)
  const tops = await page.getByTestId("news-filter").locator("a").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size, "продукты фильтра не в одну строку").toBe(1);
  // Новость с четырьмя продуктами: на ноутбуке все четыре, на телефоне два и «+2»
  const tags = page.getByTestId("news-item").filter({ hasText: "Маркетплейс Сравни запустил" }).getByTestId("news-tags");
  const products = tags.locator(".sv-badge--accent");
  await expect(products).toHaveCount(4);
  if (isPhone()) {
    await expect(products.filter({ visible: true })).toHaveCount(2);
    await expect(tags.getByTestId("news-more")).toHaveText("+2");
    await expect(tags).toContainText("ещё Продукт и CJM, Страхование в целом");
  } else {
    await expect(products.filter({ visible: true })).toHaveCount(4);
    await expect(tags.getByTestId("news-more")).toBeHidden();
  }
  await shot(page, "list");
  // Повтор параметра не роняет страницу: берётся первый
  await page.goto("/news?d=deposits&d=kasko");
  await expect(page.getByTestId("news-item")).toHaveCount(1);
  // Выбранный продукт виден в ряду и на телефоне, где ряд прокручивается вбок и «Депозиты и инвестиции» за краем экрана
  const filter = page.getByTestId("news-filter");
  const picked = filter.locator('[aria-current="page"]');
  await expect(picked).toHaveAttribute("data-testid", "news-filter-deposits");
  await expect
    .poll(async () => {
      const a = (await picked.boundingBox())!;
      const row = (await filter.boundingBox())!;
      return a.x >= row.x - 0.5 && a.x + a.width <= row.x + row.width + 0.5;
    }, { message: "выбранный продукт за краем ряда" })
    .toBe(true);
  await page.getByTestId("news-filter-deposits").click();
  await expect(page).toHaveURL(/\/news\?d=deposits$/);
  await expect(page.getByTestId("news-item")).toHaveCount(1);
  await expect(page.getByTestId("news-list").getByText("Ключевая ставка сохранена")).toBeVisible();
  await page.getByTestId("news-filter-all").click();
  await expect(page.getByTestId("news-item")).toHaveCount(4);

  // Главная: Арам руководит департаментом, видит все продукты, не больше пяти новостей
  await page.goto("/");
  const block = page.getByTestId("home-news");
  await expect(block).toBeVisible();
  await expect(block.getByTestId("news-item")).toHaveCount(4);
  await page.getByRole("link", { name: "Все новости" }).click();
  await expect(page).toHaveURL(/\/news\?d=my$/);
  await expect(page.getByTestId("news-filter-my")).toHaveAttribute("aria-current", "page");
});

test("дайджест настраивается в профиле при личном входе, по общему логину только виден", async ({ page }) => {
  // Именно общий логин: у Головкина роль администратора, обычный помощник enter завёл бы его личным входом
  await enterTeam(page, "Головкин Владислав");
  await page.goto("/profile?tab=mail");
  await expect(page.getByRole("heading", { name: "Дайджест новостей" })).toBeVisible();
  await expect(page.getByText("Дайджест настраивается при личном входе")).toBeVisible();
  await expect(page.getByRole("radio", { name: "По будням утром" })).toBeDisabled();

  await page.context().clearCookies();
  await enterByLink(page, "golovkin");
  await page.goto("/profile?tab=mail");
  const form = page.getByTestId("news-prefs");
  // По умолчанию дайджест не приходит (решение 22.10), продукты направления: у Головкина ОСАГО
  await expect(form.getByRole("radio", { name: "Не присылать" })).toBeChecked();
  await expect(form.getByRole("radio", { name: /Продукты моего направления: ОСАГО/ })).toBeChecked();
  await form.getByRole("radio", { name: "По будням утром" }).check();
  await form.getByRole("radio", { name: "Выбрать самому" }).check();
  await form.getByRole("checkbox", { name: "КАСКО" }).check();
  await page.getByTestId("news-prefs-save").click();
  await expect(page.getByText("Настройки дайджеста сохранены").first()).toBeVisible();
  await shot(page, "profile");
  const [row] = await sql(`SELECT "newsPrefs" FROM people WHERE slug = 'golovkin'`);
  expect(row!.newsPrefs).toEqual({ frequency: "daily", directions: ["osago", "kasko"] });
  await page.reload();
  await expect(page.getByTestId("news-prefs").getByRole("checkbox", { name: "КАСКО" })).toBeChecked();

  // Ничего не выбрал: «Мои продукты» пустые с подсказкой, а не вся лента
  await sql(`UPDATE people SET "newsPrefs" = '{"frequency":"weekly","directions":[]}'::jsonb WHERE slug = 'golovkin'`);
  await page.goto("/news?d=my");
  await expect(page.getByTestId("news-my-empty")).toContainText("Выберите продукты в профиле");
  await expect(page.getByTestId("news-item")).toHaveCount(0);
});
