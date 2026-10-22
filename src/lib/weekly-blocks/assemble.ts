// Автосборка weekly по смысловым блокам (этап 66): из того, что уже есть в ресурсе, черновик по блокам шаблона. Чистые
// функции на готовых данных: их считает сервер (src/lib/weekly-blocks/sources.ts собирает данные из базы) и модульные
// тесты на фикстурах. Ничего не выдумываем: нет данных в источнике, значит в блоке честно «нет данных».
//
// Откуда что:
// - «Новости рынка и команды»: новости модуля новостей за неделю (без новостей конкурентов) и записи weekly о команде;
// - «Неделя к неделе»: цифры недели из недельного отчёта (рост или падение в процентах и абсолютных) и продажи по дням;
// - «Месяц»: прогноз месяца из LRF против бюджета (план продаж по продуктам и итог), прошлый месяц и прошлый год только
//   если они есть в LRF, ОСАГО по СК из хаба;
// - «Конкуренты»: новости за неделю, где есть слова из списка конкурентов. Нет новостей: блок скрыт;
// - «Продукты» и «Партнёрский канал»: записи weekly по направлению записи, черновик разбора встречи, закрытые задачи;
// - «Риски»: записи с риском, задачи под риском и заблокированные, цели в риске;
// - «План на неделю»: задачи со сроком на следующей неделе, «что делаем дальше» и записи с типом «План».
// Каждая строка подписана продуктом (направлением), у цифр и задач ссылка на источник.

import { plural } from "@/domain/dates";
import { formatValue, type Unit } from "@/lib/numbers/parse";
import { matchedKeywords } from "@/lib/news/match";
import { repeatsNumbers } from "@/lib/weekly/rules";
import { BLOCK_LIMITS, isStandardKey, safeHref, tidy, uniqueLines, type BlockLine, type ProductRef, type ReportBlock, type TemplateBlock } from "./types";

// ---------- Числа словами ----------

const nf = (v: number, max = 0, min = 0) => v.toLocaleString("ru-RU", { maximumFractionDigits: max, minimumFractionDigits: min }).replace(/[  ]/g, " ");
export const fmtCount = (v: number) => nf(Math.round(v));
export const fmtMln = (v: number) => `${nf(v, 1, Math.abs(v) < 100 ? 1 : 0)} млн`;

/** Изменение в процентах к базе. null: базы нет или она ноль */
export function pctChange(value: number | null, base: number | null): number | null {
  if (value === null || base === null || !Number.isFinite(value) || !Number.isFinite(base) || base === 0) return null;
  return ((value - base) / Math.abs(base)) * 100;
}

/** «+3,0%», «-2,4%» */
export const fmtPct = (p: number) => `${p > 0 ? "+" : ""}${nf(p, 1, 1)}%`;

/**
 * Рост или падение словами: «рост на 7 663 (+1,5%)», «падение на 1,2 млн (-3,4%)», «рост на 0,4 п.п.», «без изменений».
 * Доли сравниваются в процентных пунктах, штуки и деньги в абсолютных и процентах
 */
export function growthText(value: number, prev: number, unit: Unit): string {
  const diff = value - prev;
  if (unit === "pct") {
    const pp = diff * 100;
    if (Math.abs(pp) < 0.05) return "без изменений";
    return `${pp > 0 ? "рост" : "падение"} на ${nf(Math.abs(pp), 1)} п.п.`;
  }
  const abs = unit === "mln" ? fmtMln(Math.abs(diff)) : fmtCount(Math.abs(diff));
  if ((unit === "mln" && Math.abs(diff) < 0.05) || (unit === "count" && Math.round(Math.abs(diff)) === 0)) return "без изменений";
  const p = pctChange(value, prev);
  return `${diff > 0 ? "рост" : "падение"} на ${abs}${p !== null ? ` (${fmtPct(p)})` : ""}`;
}

// ---------- Данные для сборки ----------

export type FigureInput = { label: string; unit: Unit; value: number | null; prev: number | null };

/** Продажи по дням из отчёта аналитиков: сумма за неделю и за прошлую неделю, обе недели целиком */
export type SalesWeek = { product: string; label: string; forms: [string, string, string]; value: number; prev: number; href: string };

export type WowInput = {
  /** У того, кто собирает, нет доступа к цифрам */
  closed?: boolean;
  connected: boolean;
  ready: boolean;
  /** Понедельник недели: «за неделю с 19.10» */
  week: string;
  latestWeek: string | null;
  figures: FigureInput[];
  href: string;
  sales: SalesWeek[];
};

export type Pair = { forecast: number | null; budget: number | null };

export type MonthProduct = {
  product: string;
  label: string;
  /** Формы слова продаж: полис, полиса, полисов */
  forms: [string, string, string];
  units: Pair;
  revenue: Pair;
  prevMonth: { units: number | null; revenue: number | null } | null;
  prevYear: { units: number | null; revenue: number | null } | null;
};

export type HubInput = { mtd: number | null; plan: number | null; forecast: number | null; day: string | null; prevTotal: number | null; href: string };

export type MonthInput = {
  month: string;
  monthLabel: string;
  href: string;
  /** Прогноз на конец прошлой недели: «конец недели 42, 18.10» */
  asOf: string | null;
  products: MonthProduct[];
  total: { revenue: Pair; prevMonth: number | null; prevYear: number | null };
  prevMonthLabel: string;
  prevYearLabel: string;
  hasPrevMonth: boolean;
  hasPrevYear: boolean;
  hub: HubInput | null;
  /** Партнёрский канал: выручка против бюджета канала. Строка уходит в блок «Партнёрский канал» */
  partners: { revenue: Pair; href: string } | null;
};

export type NewsInput = { title: string; url: string; source: string; directions: string[]; summary: string };

export type Competitor = { name: string; keywords: string[] };

export type EntryInput = {
  direction: string;
  block: string;
  type: string;
  /** Блок шаблона команды, по которому сдана запись */
  section: string | null;
  what: string;
  fact: string | null;
  impact: string | null;
  next: string | null;
  link: { url: string; title: string } | null;
};

export type TaskInput = { number: number; title: string; direction: string; due: string; blocked: boolean; note: string | null; rank: number };

export type GoalInput = { code: string | null; title: string; product: string | null; note: string | null };

export type AssembleInput = {
  template: readonly TemplateBlock[];
  products: readonly ProductRef[];
  /** null: цифры недели не собирались */
  wow: WowInput | null;
  /** closed: нет доступа к цифрам; null: прогноза месяца нет */
  month: MonthInput | "closed" | null;
  news: NewsInput[];
  competitors: Competitor[];
  entries: EntryInput[];
  done: TaskInput[];
  atRisk: TaskInput[];
  next: TaskInput[];
  goals: GoalInput[];
  /** Черновик weekly из разбора встречи этой недели */
  notion: ReportBlock[] | null;
  /** Продукты команды: цифры и новости только по ним. null: все */
  focus: string[] | null;
};

export const NEWS_MAX = 6;
export const NEWS_PER_PRODUCT = 2;
export const TASKS_PER_PRODUCT = 3;

const line = (product: string | null, text: string, href: string | null = null, source: string | null = null): BlockLine => ({
  product,
  text: tidy(text, BLOCK_LIMITS.text),
  href: safeHref(href),
  source: href ? tidy(source, BLOCK_LIMITS.source) || null : null,
});

const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const trimEnd = (s: string) => s.trim().replace(/[.\s]+$/, "");

// ---------- Неделя к неделе ----------

/** Продукт цифры по её названию: «Трафик ОСАГО», «TRAFFIC / TOTAL / CASCO» */
export function figureProduct(label: string, products: readonly ProductRef[]): string | null {
  const text = label.toLowerCase();
  const has = (code: string) => products.some((p) => p.code === code);
  const rules: [string, RegExp][] = [
    ["osago", /осаго|osago/],
    ["kasko", /каско|casco|kasko/],
    ["red", /ипотек|mortgage|взр|travel|ифл|property|имуществ|клещ|tick|accident|несчастн|\bred\b/],
    ["deposits", /вклад|депозит|deposit|invest|инвест/],
    ["partners", /партн|partner|b2b/],
  ];
  for (const [code, re] of rules) if (has(code) && re.test(text)) return code;
  return null;
}

export function wowBlock(input: WowInput | null, products: readonly ProductRef[], focus: string[] | null, fallback: string | null): { lines: BlockLine[]; note: string | null } {
  if (!input) return { lines: [], note: "Нет данных: цифры недели не собирались" };
  if (input.closed) return { lines: [], note: "Цифры недели видят те, кому открыт прогноз" };
  const lines: BlockLine[] = [];
  const keep = (p: string | null) => !focus || (p !== null && focus.includes(p));
  for (const s of input.sales) {
    if (!keep(s.product)) continue;
    lines.push(line(s.product, `${s.label}: продажи за неделю ${fmtCount(s.value)} ${plural(Math.round(s.value), ...s.forms)}, ${growthText(s.value, s.prev, "count")} к прошлой неделе`, s.href, "Факт по дням"));
  }
  let note: string | null = null;
  if (!input.connected) note = "Нет данных: недельный отчёт не подключён";
  else if (!input.figures.length) note = "Нет данных: цифры недели не выбраны на странице «Синхронизация»";
  else if (!input.ready) note = `Нет данных: за неделю с ${ddmm(input.week)} цифр в недельном отчёте ещё нет${input.latestWeek ? `, последняя неделя с ${ddmm(input.latestWeek)}` : ""}`;
  else {
    for (const f of input.figures) {
      const product = figureProduct(f.label, products);
      if (focus && !keep(product)) continue;
      const label = tidy(f.label, 120);
      const text =
        f.value === null
          ? `${label}: за неделю в отчёте нет цифры`
          : f.prev === null
            ? `${label}: ${formatValue(f.value, f.unit)}, прошлой недели в отчёте нет`
            : `${label}: ${formatValue(f.value, f.unit)}, ${growthText(f.value, f.prev, f.unit)} к прошлой неделе`;
      lines.push(line(product ?? fallback, text, input.href, "Цифры недели"));
    }
  }
  return { lines, note };
}

// ---------- Месяц ----------

function verdict(p: Pair): string {
  if (p.forecast === null) return "прогноза нет";
  if (p.budget === null) return "плана в бюджете нет";
  const pct = pctChange(p.forecast, p.budget);
  if (pct === null) return p.forecast >= p.budget ? "план выполняем" : "план не выполняем";
  return p.forecast >= p.budget ? `план выполняем (${fmtPct(pct)})` : `план не выполняем (${fmtPct(pct)})`;
}

const vs = (value: number | null, base: number | null | undefined, word: string) => {
  const p = pctChange(value, base ?? null);
  return p === null ? null : `${word} ${fmtPct(p)}`;
};

export function monthBlock(input: MonthInput | "closed" | null, focus: string[] | null, fallback: string | null): { lines: BlockLine[]; note: string | null; partners: BlockLine[] } {
  if (input === "closed") return { lines: [], note: "Прогноз месяца видят те, кому открыт прогноз", partners: [] };
  if (!input) return { lines: [], note: "Нет данных: прогноз месяца ещё не загружен из LRF", partners: [] };
  const lines: BlockLine[] = [];
  const src = `Прогноз, ${input.monthLabel}`;
  for (const p of input.products) {
    if (focus && !focus.includes(p.product)) continue;
    const units =
      p.units.forecast === null
        ? null
        : `продажи ${fmtCount(p.units.forecast)} ${plural(Math.round(p.units.forecast), ...p.forms)}${p.units.budget !== null ? ` при плане ${fmtCount(p.units.budget)}` : ""}, ${verdict(p.units)}`;
    const rp = pctChange(p.revenue.forecast, p.revenue.budget);
    const revenue = p.revenue.forecast === null ? null : `выручка ${fmtMln(p.revenue.forecast)}${p.revenue.budget !== null ? ` при бюджете ${fmtMln(p.revenue.budget)}` : ""}${rp !== null ? ` (${fmtPct(rp)})` : ""}`;
    const prev = [
      p.prevMonth ? vs(p.units.forecast, p.prevMonth.units, "продажи к прошлому месяцу") : null,
      p.prevYear ? vs(p.units.forecast, p.prevYear.units, "к прошлому году") : null,
    ].filter(Boolean);
    const parts = [units, revenue, ...prev].filter(Boolean);
    if (!parts.length) continue;
    lines.push(line(p.product, `${p.label}: ${parts.join("; ")}`, input.href, src));
  }
  if (!focus) {
    const t = input.total;
    if (t.revenue.forecast !== null) {
      const prev = [vs(t.revenue.forecast, t.prevMonth, "к прошлому месяцу"), vs(t.revenue.forecast, t.prevYear, "к прошлому году")].filter(Boolean);
      lines.push(
        line(
          fallback,
          `Итого по продуктам: выручка ${fmtMln(t.revenue.forecast)}${t.revenue.budget !== null ? ` при бюджете ${fmtMln(t.revenue.budget)}` : ""}, ${verdict(t.revenue)}${prev.length ? `; ${prev.join("; ")}` : ""}`,
          input.href,
          src,
        ),
      );
    }
  }
  if (input.hub && (!focus || focus.includes("osago"))) {
    const h = input.hub;
    const parts = [
      h.mtd !== null ? `факт с начала месяца ${fmtCount(h.mtd)} ${plural(Math.round(h.mtd), "полис", "полиса", "полисов")}${h.day ? ` по ${ddmm(h.day)}` : ""}` : null,
      h.forecast !== null ? `ранрейт ${fmtCount(h.forecast)}${h.plan !== null ? ` при плане ${fmtCount(h.plan)}${pctChange(h.forecast, h.plan) !== null ? ` (${fmtPct(pctChange(h.forecast, h.plan)!)})` : ""}` : ""}` : h.plan !== null ? `план месяца ${fmtCount(h.plan)}` : null,
      h.forecast !== null ? vs(h.forecast, h.prevTotal, "к прошлому месяцу") : null,
    ].filter(Boolean);
    if (parts.length) lines.push(line("osago", `ОСАГО по СК: ${parts.join(", ")}`, h.href, "Хаб: ОСАГО по СК"));
  }
  // Прошлый год и прошлый месяц только из источников: нет данных, так и пишем
  const missing = [!input.hasPrevMonth ? `к прошлому месяцу (${input.prevMonthLabel})` : null, !input.hasPrevYear ? `к прошлому году (${input.prevYearLabel})` : null].filter(Boolean);
  if (missing.length) {
    const what = missing.join(" и ");
    lines.push(line(fallback, `${what.charAt(0).toUpperCase()}${what.slice(1)}: нет данных, в LRF ${missing.length > 1 ? "этих месяцев" : "этого месяца"} нет`));
  }
  const partners: BlockLine[] = [];
  if (input.partners && input.partners.revenue.forecast !== null && (!focus || focus.includes("partners"))) {
    const r = input.partners.revenue;
    partners.push(line("partners", `Партнёрский канал: выручка ${fmtMln(r.forecast!)}${r.budget !== null ? ` при бюджете ${fmtMln(r.budget)}` : ""}, ${verdict(r)}`, input.partners.href, `Прогноз: партнёры, ${input.monthLabel}`));
  }
  return { lines, note: input.asOf ? `Прогноз на ${input.asOf}` : null, partners };
}

// ---------- Новости и конкуренты ----------

/** Конкурент новости: первый из списка, чьё слово есть в заголовке или описании */
export function competitorOf(item: Pick<NewsInput, "title" | "summary">, competitors: readonly Competitor[]): Competitor | null {
  const text = `${item.title}\n${item.summary}`;
  return competitors.find((c) => c.keywords.length && matchedKeywords(text, c.keywords).length > 0) ?? null;
}

export function newsLines(items: readonly NewsInput[], products: readonly ProductRef[], focus: string[] | null): BlockLine[] {
  const known = new Set(products.map((p) => p.code));
  const per = new Map<string, number>();
  const out: BlockLine[] = [];
  for (const n of items) {
    const product = n.directions.find((d) => known.has(d) && (!focus || focus.includes(d)));
    if (!product) continue;
    if ((per.get(product) ?? 0) >= NEWS_PER_PRODUCT) continue;
    per.set(product, (per.get(product) ?? 0) + 1);
    out.push(line(product, n.title, n.url, n.source));
    if (out.length >= NEWS_MAX) break;
  }
  return out;
}

export function competitorLines(items: readonly NewsInput[], competitors: readonly Competitor[], products: readonly ProductRef[], fallback: string | null): BlockLine[] {
  const known = new Set(products.map((p) => p.code));
  const out: BlockLine[] = [];
  for (const n of items) {
    const c = competitorOf(n, competitors);
    if (!c) continue;
    out.push(line(n.directions.find((d) => known.has(d)) ?? fallback, `${c.name}: ${n.title}`, n.url, n.source));
    if (out.length >= NEWS_MAX) break;
  }
  return out;
}

// ---------- Записи weekly ----------

/**
 * В какой блок идёт запись: блок шаблона, по которому её сдали; иначе по смыслу: риск в «Риски», план в «План на
 * неделю», «Команда и процессы» в новости команды, партнёрка в «Партнёрский канал», остальное в «Продукты». Такого
 * блока нет в шаблоне: в «Продукты», а без них в первый блок шаблона
 */
export function entryBlockKey(e: Pick<EntryInput, "section" | "type" | "block" | "direction">, keys: readonly string[]): string {
  if (e.section && keys.includes(e.section)) return e.section;
  const want = e.type === "risk" ? "risks" : e.type === "plan" ? "plan" : e.block === "team" ? "news" : e.direction === "partners" ? "partners" : "products";
  if (keys.includes(want)) return want;
  return keys.includes("products") ? "products" : (keys[0] ?? "products");
}

/** Строка записи: что произошло и цифра или факт, если цифра не повторяет текст. Ссылка на первый артефакт записи */
export function entryText(e: Pick<EntryInput, "what" | "fact" | "impact">): string {
  const extra = e.fact ?? e.impact;
  const tail = extra && !repeatsNumbers(extra, e.what) ? `. ${trimEnd(extra)}` : "";
  return `${trimEnd(e.what)}${tail}`;
}

// ---------- Сборка ----------

const capPerProduct = (tasks: readonly TaskInput[]) => {
  const per = new Map<string, number>();
  return [...tasks]
    .sort((a, b) => a.rank - b.rank || a.due.localeCompare(b.due) || a.number - b.number)
    .filter((t) => {
      const n = per.get(t.direction) ?? 0;
      if (n >= TASKS_PER_PRODUCT) return false;
      per.set(t.direction, n + 1);
      return true;
    });
};

const EMPTY_NOTE = "За неделю ничего нет";

/** Черновик по блокам шаблона. Порядок строк внутри блока: записи weekly, разбор встречи, задачи и цели */
export function assembleBlocks(input: AssembleInput): ReportBlock[] {
  const keys = input.template.map((t) => t.key);
  const lines = new Map<string, BlockLine[]>(keys.map((k) => [k, []]));
  const notes = new Map<string, string | null>();
  const add = (key: string, l: BlockLine) => {
    const list = lines.get(key);
    if (list && l.text) list.push(l);
  };
  const fallback = input.products.some((p) => p.code === "department") ? "department" : null;
  const known = new Set(input.products.map((p) => p.code));
  const product = (code: string | null | undefined) => (code && known.has(code) ? code : fallback);

  // Новости рынка (без конкурентов): первыми в блоке новостей
  const market = input.news.filter((n) => !competitorOf(n, input.competitors));
  if (keys.includes("news")) for (const l of newsLines(market, input.products, input.focus)) add("news", l);
  if (keys.includes("competitors")) for (const l of competitorLines(input.news, input.competitors, input.products, fallback)) add("competitors", l);
  if (keys.includes("wow")) {
    const w = wowBlock(input.wow, input.products, input.focus, fallback);
    w.lines.forEach((l) => add("wow", l));
    notes.set("wow", w.note);
  }
  const m = monthBlock(input.month, input.focus, fallback);
  if (keys.includes("month")) {
    m.lines.forEach((l) => add("month", l));
    notes.set("month", m.note);
  }
  if (keys.includes("partners")) m.partners.forEach((l) => add("partners", l));

  // Записи weekly
  for (const e of input.entries) {
    const key = entryBlockKey(e, keys);
    const p = product(e.direction);
    const link = e.link ? safeHref(e.link.url) : null;
    if (key === "plan" && e.type === "plan") {
      add("plan", line(p, e.next ? trimEnd(e.next) : entryText(e), link, e.link?.title || "Артефакт"));
      continue;
    }
    add(key, line(p, entryText(e), link, e.link?.title || "Артефакт"));
    if (e.next && keys.includes("plan") && key !== "plan") add("plan", line(p, trimEnd(e.next)));
  }

  // Черновик разбора встречи по тем же блокам
  for (const b of input.notion ?? []) {
    if (!keys.includes(b.key) || b.key === "wow" || b.key === "month") continue;
    for (const l of b.lines) add(b.key, { ...l, product: l.product && known.has(l.product) ? l.product : fallback });
  }

  // Задачи и цели
  const taskHref = (t: TaskInput) => `/tasks/${t.number}`;
  for (const t of capPerProduct(input.done)) {
    const key = t.direction === "partners" && keys.includes("partners") ? "partners" : "products";
    if (keys.includes(key)) add(key, line(product(t.direction), `Задача ${t.number} выполнена: ${trimEnd(t.title)}`, taskHref(t), `Задача ${t.number}`));
  }
  if (keys.includes("risks")) {
    for (const t of capPerProduct(input.atRisk)) {
      add("risks", line(product(t.direction), `Задача ${t.number} ${t.blocked ? "заблокирована" : "под риском"}: ${trimEnd(t.title)}${t.note ? `. ${trimEnd(t.note)}` : ""}`, taskHref(t), `Задача ${t.number}`));
    }
    for (const g of input.goals) add("risks", line(product(g.product), `Цель ${g.code ? `${g.code} ` : ""}в риске: ${trimEnd(g.title)}${g.note ? `. ${trimEnd(g.note)}` : ""}`, "/goals", "Цели"));
  }
  if (keys.includes("plan")) {
    for (const t of capPerProduct(input.next)) add("plan", line(product(t.direction), `${trimEnd(t.title)}, срок ${ddmm(t.due)}`, taskHref(t), `Задача ${t.number}`));
  }

  return input.template.map((t) => {
    const list = uniqueLines(lines.get(t.key) ?? []).slice(0, BLOCK_LIMITS.lines);
    const competitors = t.key === "competitors";
    const note = notes.has(t.key) ? notes.get(t.key)! : null;
    return {
      key: t.key,
      title: t.title,
      // Конкуренты без новостей скрыты: блок появляется, когда новости по ним есть
      hidden: competitors && !list.length,
      lines: list,
      note: list.length ? (t.key === "month" || t.key === "wow" ? note : null) : (note ?? (competitors ? "Новостей по конкурентам за неделю нет: блок скрыт" : isStandardKey(t.key) ? EMPTY_NOTE : "Записей по этому блоку нет")),
    };
  });
}
