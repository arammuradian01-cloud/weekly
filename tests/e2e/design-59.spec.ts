import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterManagement, expectToastAbove, resetDatabase } from "./helpers";

// Этап 59, шаг 1 плана правок дизайна: быстрые исправления текста и вида. Плашка стенда человеческим текстом, смена
// плашки только у владельца; неделя одним форматом в шапке и в переключателе; «Новая задача» в шапке контуром;
// пункт меню под фокусом с клавиатуры виден в обеих темах; тост не ложится на липкую полосу внизу. Ноутбук 1440 и
// телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });
const phone = () => test.info().project.name === "phone";

/** Снимок экрана: всей страницы или только видимой части (там, где важно положение тоста над полосой) */
async function shot(page: Page, name: string, fullPage = true) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-ds59-${name}.png`, fullPage });
}

/** Контраст двух цветов rgb() по WCAG */
function contrast(a: string, b: string): number {
  const rgb = (c: string) => (/rgba?\((\d+), (\d+), (\d+)/.exec(c) ?? []).slice(1, 4).map(Number);
  const lum = (c: string) => {
    const [r, g, bl] = rgb(c).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Пункт меню под фокусом с клавиатуры: фон акцента и полоса слева цвета фокуса, полоса видна на фоне пункта (3:1) */
async function expectKeyboardFocus(page: Page) {
  const item = page.locator('[role="menuitem"]:focus');
  await expect(item).toHaveCount(1);
  const s = await item.evaluate((el) => {
    const cs = getComputedStyle(el);
    const menu = getComputedStyle(el.closest('[role="menu"]')!);
    return { visible: el.matches(":focus-visible"), bg: cs.backgroundColor, shadow: cs.boxShadow, menuBg: menu.backgroundColor };
  });
  expect(s.visible, "фокус с клавиатуры").toBe(true);
  expect(s.shadow, "полоса слева").toMatch(/^rgba?\([^)]+\) 2px 0px 0px 0px inset$/);
  const strip = /^(rgba?\([^)]+\))/.exec(s.shadow)![1]!;
  expect(contrast(strip, s.bg), `полоса ${strip} на фоне пункта ${s.bg}`).toBeGreaterThanOrEqual(3);
  expect(s.bg, "фон пункта отличается от фона меню").not.toBe(s.menuBg);
}

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
});

test("плашка стенда без Bord, неделя одним форматом, «Новая задача» в шапке контуром", async ({ page }) => {
  await enter(page, "Рева Тарас");
  const banner = page.locator(".sv-stand");
  await expect(banner).toContainText("Тестовый стенд. Здесь пробуем Weekly до пилота");
  await expect(banner).not.toContainText("Bord");
  await expect(banner.getByRole("link", { name: "Как работать" })).toHaveAttribute("href", "/help");
  // Сменить плашку может только владелец: у лидера ссылки нет
  await expect(page.getByTestId("stand-switch")).toHaveCount(0);

  if (!phone()) {
    // Неделя в шапке текстом, без рамки переключателя; главной зелёной кнопки в шапке нет
    const week = page.getByTestId("topbar-week");
    await expect(week).toHaveText(/^Неделя \d+, отчётная$/);
    await expect(page.locator(".sv-topbar .sv-week")).toHaveCount(0);
    const create = page.locator(".sv-topbar").getByRole("button", { name: "Новая задача" });
    await expect(create).toHaveClass(/sv-btn--outline/);
    await expect(page.locator(".sv-topbar .sv-btn--primary, .sv-topbar .sv-btn--dark")).toHaveCount(0);
  }

  // Переключатель недели в ленте тем же форматом. Прошлая неделя без «отчётная», возврат действием «К отчётной неделе»
  await page.goto("/weekly");
  const title = page.getByTestId("week-title");
  await expect(title).toHaveText(/^Неделя \d+(, отчётная)?$/);
  if (/отчётная/.test((await title.textContent())!)) {
    await page.getByRole("button", { name: "Предыдущая неделя" }).click();
    await expect(title).toHaveText(/^Неделя \d+$/);
  }
  await expect(page.getByText("Текущая", { exact: true })).toHaveCount(0);
  await shot(page, "week-past");
  await page.getByRole("button", { name: "К отчётной неделе" }).click();
  await expect(title).toHaveText(/^Неделя \d+, отчётная$/);
  await expect(page.getByRole("button", { name: "К отчётной неделе" })).toHaveCount(0);
  if (!phone()) await expect(page.getByTestId("topbar-week")).toHaveText((await title.textContent())!);
  await shot(page, "week-reporting");
});

test("владелец видит ссылку на смену плашки", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await expect(page.getByTestId("stand-switch")).toHaveAttribute("href", "/settings#stand");
  await enterManagement(page, "owner");
  await page.getByTestId("stand-switch").click();
  await expect(page).toHaveURL(/\/settings#stand$/);
  await expect(page.getByRole("radiogroup", { name: "Плашка над страницами" })).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`пункт меню под фокусом с клавиатуры виден: меню профиля и статус задачи, тема ${theme === "dark" ? "тёмная" : "светлая"}`, async ({ page }) => {
    await page.context().addCookies([{ name: "theme", value: theme, url: "http://localhost:3100" }]);
    await enter(page, "Рева Тарас");
    const profile = page.getByRole("button", { name: /^Профиль:/ }).filter({ visible: true }).first();
    await profile.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expectKeyboardFocus(page);
    await shot(page, `menu-focus-${theme}`, false);
    await page.keyboard.press("Escape");

    // Меню статуса в строке очереди «Мне» (InlineSelect дизайн-системы)
    await page.goto("/me");
    const status = page.getByRole("button", { name: /^Статус задачи \d+/ }).filter({ visible: true }).first();
    await status.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expectKeyboardFocus(page);
    await page.keyboard.press("Escape");
  });
}

test("тост встаёт над полосой выбранных задач и не закрывает её кнопки", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/tasks?group=none");
  await page.locator('input[aria-label="Выбрать задачу 13"]:visible').check();
  const bar = page.getByRole("region", { name: "Выбранные задачи" });
  await expect(bar).toBeVisible();
  // Тост при выбранных задачах: сохранённый вид
  await page.getByRole("button", { name: "Сохранить вид" }).click();
  await page.getByLabel("Имя вида").fill("Мой вид");
  await page.getByRole("dialog", { name: "Сохранить вид" }).getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Вид «Мой вид» сохранён").first()).toBeVisible();
  await expect(bar).toBeVisible();
  await expectToastAbove(page, bar, bar.getByRole("button", { name: "Снять выделение" }));
  await shot(page, "toast-bulk", false);
  // Выбор снят: полосы нет, тост возвращается на своё место у низа
  await bar.getByRole("button", { name: "Снять выделение" }).click();
  await expect(bar).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--sticky-bottom"))).toBe("");
});
