import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 58: единая воронка, шаг 1. Владелец загружает снимок «Все СК» и план ОСАГО по СК из хаба в имитации, в карточке
// ОСАГО появляется таблица по СК с ранрейтом (с 4-го числа); лидер КАСКО видит полисы, но не выручку и КВ. Время загрузки
// факта и плана видно отдельно, поле соответствия названий СК у владельца. Ноутбук 1440 и телефон 360.
// Этап 59: блок по СК не шире карточки ОСАГО, таблица по СК прокручивается внутри своего контейнера с закреплённой
// колонкой СК, кнопки «Изменить» и метки не обрезаны краем и на телефоне не наезжают на отклонения

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-plan58-${name}.png`, fullPage: true });
}

const isPhone = () => test.info().project.name === "phone";

/** Блок по ширине внутри контейнера: левый и правый края не выходят за его края (полпикселя на округление) */
async function within(inner: Locator, outer: Locator, what: string) {
  const a = (await inner.boundingBox())!;
  const b = (await outer.boundingBox())!;
  expect(a.x, `${what}: левый край`).toBeGreaterThanOrEqual(b.x - 0.5);
  expect(a.x + a.width, `${what}: правый край`).toBeLessThanOrEqual(b.x + b.width + 0.5);
}

/** Прямоугольники пересекаются */
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

/** Контейнер таблицы не прокручивается вбок: таблица помещается целиком, ничего не спрятано за краем */
async function fits(table: Locator, what: string) {
  const hidden = await table.evaluate((el) => el.parentElement!.scrollWidth - el.parentElement!.clientWidth);
  expect(hidden, `${what}: часть таблицы за краем`).toBeLessThanOrEqual(0);
}

/**
 * Раскрытая карточка ОСАГО с блоком по СК в границах раздела «По продуктам»: таблица продуктов помещается, карточка,
 * блок по СК и его таблица не шире своих контейнеров, кнопки «Изменить» и метка «ждёт проверки» видны целиком, на
 * кнопку не наезжает отклонение. Таблица по СК прокручивается внутри своего контейнера, колонка СК при этом на месте
 */
async function skLayout(page: Page) {
  const products = page.locator("#plan-products");
  const card = page.locator("#plan-product-osago");
  const sk = page.getByTestId("plan-sk");
  await fits(page.getByTestId("plan-products-table"), "таблица продуктов");
  await within(card, products, "карточка ОСАГО");
  await within(sk, card, "блок ОСАГО по СК");
  const scroller = sk.getByTestId("plan-sk-scroll");
  await within(scroller, sk, "таблица по СК");
  const waiting = page.getByTestId("plan-waiting-osago");
  if (await waiting.count()) await within(waiting, products, "метка «ждёт проверки»");
  await fits(card.getByTestId("plan-product-table"), "таблица драйверов");
  for (const button of await card.locator('[data-testid^="plan-edit-"]').all()) {
    await within(button, card, `кнопка ${await button.getAttribute("data-testid")}`);
    const row = card.locator("tr", { has: button });
    for (const pill of await row.locator(".sv-delta").all()) expect(overlaps((await button.boundingBox())!, (await pill.boundingBox())!), `кнопка ${await button.getAttribute("data-testid")} наезжает на отклонение`).toBe(false);
  }
  // Колонка СК закреплена: таблица прокручена до конца, а название СК у левого края контейнера (рамка 1 px)
  const first = sk.getByTestId("plan-sk-row").first().locator("td").first();
  await expect(first).toHaveCSS("position", "sticky");
  const scrolled = await scroller.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    return el.scrollLeft;
  });
  // На телефоне колонки не помещаются: прокрутка внутри контейнера, а не страницы
  if (isPhone()) expect(scrolled, "таблица по СК на телефоне прокручивается в своём контейнере").toBeGreaterThan(0);
  const box = (await scroller.boundingBox())!;
  const cell = (await first.boundingBox())!;
  expect(Math.abs(cell.x - box.x), "колонка СК уехала при прокрутке").toBeLessThanOrEqual(1.5);
  await scroller.evaluate((el) => {
    el.scrollLeft = 0;
  });
}

async function clearPlan() {
  for (const table of ["plan_sk_snapshots", "plan_sk_lines", "plan_partner_adjustments", "plan_partner_totals", "plan_partners", "plan_facts", "plan_checks", "plan_pulls", "plan_adjustments", "plan_lines"]) await sql(`DELETE FROM ${table}`);
  await sql(`DELETE FROM settings WHERE key LIKE 'plan.%'`);
}

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
  await clearPlan();
});

// Снимки хаба и план по СК не должны доставаться следующим файлам: иначе в карточке ОСАГО у них появляется лишний раздел
test.afterAll(async () => {
  await clearPlan();
});

async function pull(page: Page) {
  await page.goto("/forecast");
  await page.getByTestId("plan-pull-open").click();
  const drawer = page.getByRole("dialog", { name: "Бюджет и LBE из LRF" });
  await drawer.getByTestId("plan-pull-check").click();
  await expect(drawer.getByTestId("plan-pull-preview").getByText("Всё читается")).toBeVisible();
  await drawer.getByTestId("plan-pull-load").click();
  await expect(page.getByText(/Бюджет и LBE на .* загружены/).first()).toBeVisible();
}

test("владелец загружает хаб, в карточке ОСАГО появляется ранрейт по СК, лидер КАСКО не видит выручку и КВ", async ({ page }) => {
  test.setTimeout(120_000);
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await pull(page);

  // До загрузки хаба раздела по СК нет
  await page.goto("/forecast");
  await expect(page.getByTestId("plan-sk")).toHaveCount(0);
  await page.getByTestId("plan-hub-open").click();
  const drawer = page.getByRole("dialog", { name: "ОСАГО по СК из хаба" });
  await expect(drawer.getByTestId("plan-hub-link")).toBeVisible();
  await expect(drawer.getByTestId("plan-hub-loaded")).toContainText("Факт «Все СК» ещё не загружен. План по СК ещё не загружен.");
  // Этап 59: под заголовком одна строка о результате, устройство загрузки свёрнуто и открывается по ссылке
  await expect(drawer.getByText("Загрузит факт по СК с начала месяца по вчерашний день и план месяца по СК.", { exact: true })).toBeVisible();
  const details = drawer.getByTestId("plan-hub-details");
  await expect(details.getByText(/IMPORTRANGE/)).toBeHidden();
  await details.getByText("Как устроена загрузка").click();
  await expect(details.getByText(/IMPORTRANGE/)).toBeVisible();
  await expect(details).toContainText("Факт и план загружаются независимо");
  await details.getByText("Как устроена загрузка").click();
  await expect(details.getByText(/IMPORTRANGE/)).toBeHidden();
  // «Задать хаб» не выключена серым: без ссылки говорит, чего не хватает
  await expect(drawer.getByTestId("plan-hub-source-save")).toBeEnabled();
  await drawer.getByTestId("plan-hub-source-save").click();
  await expect(drawer.getByText("Вставьте ссылку на Google-таблицу хаба")).toBeVisible();
  // Соответствие названий СК правит владелец в той же панели. Кнопка сохранения появляется после правки и уходит,
  // когда текст вернули как был
  await expect(drawer.getByTestId("plan-hub-aliases")).toBeVisible();
  await expect(drawer.getByTestId("plan-hub-aliases-save")).toHaveCount(0);
  const aliases = drawer.getByLabel("Соответствие названий СК");
  const before = await aliases.inputValue();
  await aliases.fill(`${before}${before ? "\n" : ""}Росгосстрах = РГС`);
  await expect(drawer.getByTestId("plan-hub-aliases-save")).toBeEnabled();
  await aliases.fill(before);
  await expect(drawer.getByTestId("plan-hub-aliases-save")).toHaveCount(0);
  await drawer.getByTestId("plan-hub-check").click();
  const preview = drawer.getByTestId("plan-hub-preview");
  await expect(preview.getByText("Всё читается")).toBeVisible();
  await expect(preview.getByTestId("plan-hub-fact")).toContainText("СК: 4");
  await expect(preview.getByTestId("plan-hub-fact")).toContainText("загрузится");
  await expect(preview.getByTestId("plan-hub-plan")).toContainText("План ОСАГО по СК");
  await shot(page, "hub-drawer");
  await drawer.getByTestId("plan-hub-load").click();
  await expect(page.getByText(/Снимок «Все СК» на .* загружен/).first()).toBeVisible();

  // Карточка ОСАГО: таблица по СК, итог, сверка с LBE, метод
  const sk = page.getByTestId("plan-sk");
  await expect(sk).toBeVisible();
  await expect(sk.getByRole("heading", { name: "ОСАГО по СК: план, факт и ранрейт" })).toBeVisible();
  await expect(sk.getByTestId("plan-sk-row")).toHaveCount(4);
  await expect(sk.getByTestId("plan-sk-total")).toContainText("ИТОГО");
  // Факт в «Все СК» по вчерашний день: 1-го числа факта за месяц ещё нет, ранрейт не считается; 2-го и 3-го факта меньше
  // трёх дней, ранрейт и «К плану» появятся с 4-го числа
  const today = Number(new Date().toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric" }));
  if (today === 1) await expect(sk.getByTestId("plan-sk-tomorrow")).toContainText("появится завтра");
  else if (today <= 3) {
    await expect(sk.getByTestId("plan-sk-early")).toContainText("появятся с 4-го числа");
    await expect(sk.getByTestId("plan-sk-forecast")).toHaveCount(0);
  } else {
    await expect(sk.getByTestId("plan-sk-method")).toContainText("Прогноз линейный по дням");
    await expect(sk.getByTestId("plan-sk-method")).toContainText("14 дней с дневным фактом");
    await expect(sk.getByTestId("plan-sk-forecast")).toHaveCount(5);
  }
  await expect(sk.getByTestId("plan-sk-loaded")).toContainText("Факт загружен");
  await expect(sk.getByTestId("plan-sk-loaded")).toContainText("План загружен");
  await expect(sk.getByTestId("plan-sk-lbe")).toContainText(today <= 3 ? "LBE полисов ОСАГО на месяц" : "против LBE полисов ОСАГО");
  await expect(sk.getByTestId("plan-sk-stale")).toHaveCount(0);
  // Владелец видит выручку и КВ: по ячейкам, их по строке на СК и итог
  await expect(sk.getByTestId("plan-sk-revenue")).toHaveCount(5);
  await expect(sk.getByTestId("plan-sk-kv").first()).toContainText("%");
  await skLayout(page);
  await shot(page, "osago-sk-owner");

  // Лидер КАСКО по личному входу: таблица есть, чувствительных колонок нет
  await page.context().clearCookies();
  await enterByLink(page, "fatyanov");
  await page.goto("/forecast");
  await expect(page.getByTestId("plan-hub-open")).toHaveCount(0);
  const osagoRow = page.getByTestId("plan-products-table").locator("tbody > tr").filter({ hasText: "ОСАГО" }).first();
  if (await osagoRow.count()) await osagoRow.click();
  const skKasko = page.getByTestId("plan-sk");
  await expect(skKasko).toBeVisible();
  await expect(skKasko.getByTestId("plan-sk-row")).toHaveCount(4);
  await expect(skKasko.getByTestId("plan-sk-revenue")).toHaveCount(0);
  await expect(skKasko.getByTestId("plan-sk-kv")).toHaveCount(0);
  await expect(skKasko.getByTestId("plan-sk-total")).toContainText("ИТОГО");
  await skLayout(page);
  await shot(page, "osago-sk-kasko");
});
