import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterManagement, resetDatabase } from "./helpers";

// Этап 49: тёмная тема в проходе. Ключевые страницы снимаются в тёмной теме на ноутбуке и телефоне, без
// горизонтальной прокрутки; у текста на странице есть контраст с фоном (ловит светлый текст на светлой плашке
// или тёмный на тёмной, когда цвет задан не токеном темы)

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

type Low = { tag: string; text: string; color: string; bg: string; ratio: number };

/** Контраст текста с ближайшим непрозрачным фоном, считается в браузере по WCAG */
async function lowContrast(page: Page, min: number): Promise<Low[]> {
  return page.evaluate((minRatio) => {
    const parse = (c: string): [number, number, number, number] | null => {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c);
      if (!m) return null;
      return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    };
    const lum = ([r, g, b]: [number, number, number, number]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const blend = (top: [number, number, number, number], under: [number, number, number, number]): [number, number, number, number] => {
      const a = top[3];
      return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
    };
    // Фон элемента: поднимаемся по предкам, полупрозрачные слои смешиваем; фон с картинкой или градиентом пропускаем
    const background = (el: Element): [number, number, number, number] | null => {
      let node: Element | null = el;
      const layers: [number, number, number, number][] = [];
      while (node) {
        const cs = getComputedStyle(node);
        if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
        const bg = parse(cs.backgroundColor);
        if (bg && bg[3] > 0) {
          layers.push(bg);
          if (bg[3] >= 1) break;
        }
        node = node.parentElement;
      }
      if (!layers.length) return null;
      let out = layers[layers.length - 1]!;
      if (out[3] < 1) out = blend(out, [255, 255, 255, 1]);
      for (let i = layers.length - 2; i >= 0; i--) out = blend(layers[i]!, out);
      return out;
    };
    const out: Low[] = [];
    const seen = new Set<string>();
    const nodes = Array.from(document.querySelectorAll("h1, h2, h3, p, td, th, dt, dd, a, button, label, span, li")).filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
      const text = (el.textContent ?? "").trim();
      if (!text) return false;
      // Только элементы с собственным текстом, а не обёртки
      return Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim());
    });
    for (const el of nodes) {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.5) continue;
      // Выключенные элементы управления по WCAG контраста не требуют: пропускаем их и текст внутри них
      if (el.closest(":disabled, [aria-disabled='true']")) continue;
      const color = parse(cs.color);
      const bg = background(el);
      if (!color || !bg) continue;
      const fg = color[3] < 1 ? blend(color, bg) : color;
      const l1 = lum(fg);
      const l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (ratio < minRatio) {
        const key = `${el.tagName}:${cs.color}:${cs.backgroundColor}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ tag: el.tagName.toLowerCase(), text: (el.textContent ?? "").trim().slice(0, 60), color: cs.color, bg: `rgb(${bg.slice(0, 3).map(Math.round).join(", ")})`, ratio: Math.round(ratio * 100) / 100 });
      }
    }
    return out;
  }, min);
}

async function shot(page: Page, name: string) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  // Фон страницы тёмный: тема правда применилась, а не только атрибут
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const m = /rgb\((\d+), (\d+), (\d+)/.exec(bg)!;
  expect(Number(m[1]) + Number(m[2]) + Number(m[3]), `фон страницы ${name} не тёмный: ${bg}`).toBeLessThan(200);
  const low = await lowContrast(page, 3);
  expect(low, `текст без контраста на экране ${name}: ${JSON.stringify(low)}`).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-dark-${name}.png`, fullPage: true });
}

test.beforeEach(async ({ page }) => {
  await resetDatabase({ weekly: false });
  // Выбор темы лежит в cookie на устройстве: ставим его до первого захода
  await page.context().addCookies([{ name: "theme", value: "dark", url: "http://localhost:3100" }]);
});

test("тёмная тема: главная, weekly, задачи, карточка задачи, люди, цели", async ({ page }) => {
  test.setTimeout(60_000);
  await enter(page, "Рева Тарас");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot(page, "home");
  await page.goto("/me");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot(page, "me");
  await page.goto("/weekly");
  await expect(page.getByRole("heading", { name: "Weekly", level: 1 })).toBeVisible();
  await shot(page, "weekly");
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".sv-task-rows section, .sv-table tbody tr").filter({ visible: true }).first()).toBeVisible();
  await shot(page, "tasks");
  await page.goto("/tasks/1");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot(page, "task");
  await page.goto("/people");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot(page, "people");
  await page.goto("/goals");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot(page, "goals");
});

test("тёмная тема в режиме управления: отчёт CEO, встреча, прогноз, настройки, синхронизация", async ({ page }) => {
  test.setTimeout(60_000);
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/ceo-report");
  await expect(page.getByRole("heading", { name: "Отчёт CEO", level: 1 })).toBeVisible();
  await shot(page, "ceo");
  await page.goto("/weekly/meeting");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot(page, "meeting");
  await page.goto("/forecast");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot(page, "forecast");
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Настройки", level: 1 })).toBeVisible();
  await shot(page, "settings");
  await page.goto("/sync");
  await expect(page.getByRole("heading", { name: "Синхронизация", level: 1 })).toBeVisible();
  await shot(page, "sync");
});
