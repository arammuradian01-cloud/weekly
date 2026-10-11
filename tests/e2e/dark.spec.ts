import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterManagement, resetDatabase } from "./helpers";

// Этап 49: тёмная тема в проходе. Ключевые страницы снимаются в тёмной теме на ноутбуке и телефоне, без
// горизонтальной прокрутки; у текста на странице есть контраст с фоном (ловит светлый текст на светлой плашке
// или тёмный на тёмной, когда цвет задан не токеном темы)

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

type Low = { tag: string; text: string; color: string; bg: string; ratio: number };
type Report = { low: Low[]; unparsed: string[]; skipped: number };

/** Контраст текста с ближайшим непрозрачным фоном, считается в браузере по WCAG. Цвет любого вида (rgb, oklab из
    color-mix, color(srgb)) переводится в sRGB через canvas: регулярка на rgb() молчала бы ровно там, где прозрачность
    и создаёт слабый контраст. Неразобранные цвета и пропуски из-за фоновых картинок возвращаются отдельно */
async function contrastReport(page: Page, min: number): Promise<Report> {
  return page.evaluate((minRatio) => {
    type Rgba = [number, number, number, number];
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const cache = new Map<string, Rgba | null>();
    const unparsed = new Set<string>();
    const parse = (c: string): Rgba | null => {
      if (cache.has(c)) return cache.get(c)!;
      let out: Rgba | null = null;
      try {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = "#000";
        ctx.fillStyle = c;
        // Цвет не принят: fillStyle остался чёрным, а строка не чёрная
        const accepted = ctx.fillStyle !== "#000000" || /^(#000(000)?|black|rgba?\(0,\s*0,\s*0)/.test(c);
        if (accepted) {
          ctx.fillRect(0, 0, 1, 1);
          const d = ctx.getImageData(0, 0, 1, 1).data;
          out = [d[0]!, d[1]!, d[2]!, d[3]! / 255];
        }
      } catch {
        out = null;
      }
      if (!out) unparsed.add(c);
      cache.set(c, out);
      return out;
    };
    const lum = ([r, g, b]: Rgba) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const blend = (top: Rgba, under: Rgba): Rgba => {
      const a = top[3];
      return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
    };
    const pageBg = parse(getComputedStyle(document.documentElement).backgroundColor) ?? parse(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 1];
    let skipped = 0;
    // Фон элемента: поднимаемся по предкам, полупрозрачные слои смешиваем снизу вверх; фон с картинкой или
    // градиентом пропускаем и считаем пропуски
    const background = (el: Element): Rgba | null => {
      let node: Element | null = el;
      const layers: Rgba[] = [];
      while (node) {
        const cs = getComputedStyle(node);
        if (cs.backgroundImage && cs.backgroundImage !== "none") {
          skipped += 1;
          return null;
        }
        const bg = parse(cs.backgroundColor);
        if (bg && bg[3] > 0) {
          layers.push(bg);
          if (bg[3] >= 1) break;
        }
        node = node.parentElement;
      }
      let out: Rgba = layers.length && layers[layers.length - 1]![3] >= 1 ? layers[layers.length - 1]! : pageBg;
      const start = layers.length && layers[layers.length - 1]![3] >= 1 ? layers.length - 2 : layers.length - 1;
      for (let i = start; i >= 0; i--) out = blend(layers[i]!, out);
      return out;
    };
    // Непрозрачность с учётом предков: текст в полупрозрачной обёртке бледнее, чем говорит его цвет
    const opacityOf = (el: Element): number => {
      let o = 1;
      let node: Element | null = el;
      while (node) {
        o *= Number(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      return o;
    };
    const low: Low[] = [];
    const seen = new Set<string>();
    const nodes = Array.from(document.body.querySelectorAll("*")).filter((el) => {
      if (el.closest("script, style, noscript, template, svg")) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
      // Только элементы с собственным текстом, а не обёртки
      return Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim());
    });
    for (const el of nodes) {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      const opacity = opacityOf(el);
      if (opacity < 0.5) continue;
      // Выключенные элементы управления по WCAG контраста не требуют: пропускаем их и текст внутри них
      if (el.closest(":disabled, [aria-disabled='true']")) continue;
      const color = parse(cs.color);
      const bg = background(el);
      if (!color || !bg) continue;
      const fg = blend([color[0], color[1], color[2], color[3] * opacity], bg);
      const l1 = lum(fg);
      const l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (ratio < minRatio) {
        const key = `${el.tagName}:${cs.color}:${cs.backgroundColor}`;
        if (seen.has(key)) continue;
        seen.add(key);
        low.push({ tag: el.tagName.toLowerCase(), text: (el.textContent ?? "").trim().slice(0, 60), color: cs.color, bg: `rgb(${bg.slice(0, 3).map(Math.round).join(", ")})`, ratio: Math.round(ratio * 100) / 100 });
      }
    }
    return { low, unparsed: [...unparsed], skipped };
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
  // Порог 3:1 это грубый уровень (крупный текст и элементы управления по WCAG): ловит невидимый текст, а не
  // недобор до 4,5:1 у мелкого вторичного текста на цветных строках
  const report = await contrastReport(page, 3);
  expect(report.unparsed, `цвета, которые проверка не разобрала на экране ${name}`).toEqual([]);
  expect(report.low, `текст без контраста на экране ${name}: ${JSON.stringify(report.low)}`).toEqual([]);
  // Курсор в угол: снимок без строки под наведением
  await page.mouse.move(0, 0);
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
