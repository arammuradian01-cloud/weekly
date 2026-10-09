// Чтение листов LRF для прогноза месяца (этап 32): чистые функции без базы.
//
// Шапка листа в первых строках: строка версий (Act, LBE, BUD) и строка месяцев (Oct_2026). Колонка версии месяца это
// первая колонка, где версия и месяц совпали. Название строки: первая текстовая ячейка в первых десяти колонках
// (у КАСКО оно в восьмой колонке)

import { GROUPS, PRODUCTS, lrfMonth, type GroupSpec, type MetricKey, type ProductSpec } from "./spec";

export type Cell = string | number | null | undefined;
export type Grid = Cell[][];
export type Version = "LBE" | "BUD";
export type Values = Partial<Record<MetricKey, number | null>>;

export type ParsedSheet = { columns: Partial<Record<Version, number>>; problem: string | null };

const text = (c: Cell) => (c === null || c === undefined ? "" : String(c).replace(/ /g, " ").trim());

/** Колонки версий месяца: LBE и BUD */
export function findColumns(grid: Grid, month: string): ParsedSheet {
  const target = lrfMonth(month).toLowerCase();
  const head = grid.slice(0, 8);
  const columns: ParsedSheet["columns"] = {};
  for (let r = 0; r < head.length; r++) {
    const row = head[r] ?? [];
    for (let j = 0; j < row.length; j++) {
      if (text(row[j]).toLowerCase() !== target) continue;
      // Версия: в одной из строк выше или ниже в той же колонке
      for (let k = 0; k < head.length; k++) {
        const v = text(head[k]?.[j]).toUpperCase();
        if ((v === "LBE" || v === "BUD") && columns[v] === undefined) columns[v] = j;
      }
    }
  }
  const missing = (["LBE", "BUD"] as const).filter((v) => columns[v] === undefined);
  return { columns, problem: missing.length ? `Нет колонки ${missing.map((v) => `${v} ${lrfMonth(month)}`).join(" и ")}` : null };
}

/** Название строки: первая текстовая ячейка в первых десяти колонках */
export function rowLabel(row: Cell[] | undefined): string {
  if (!row) return "";
  for (let j = 0; j < Math.min(10, row.length); j++) {
    const c = row[j];
    if (typeof c === "string" && c.trim() && !/^-?[\d\s.,%]+$/.test(c.trim())) return text(c).replace(/\s+/g, " ");
  }
  return "";
}

/** Число из ячейки: число, текст с пробелами и запятой, проценты; пусто: null */
export function cellNumber(c: Cell): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const t = text(c).replace(/[\s ]/g, "");
  if (!t || t === "-" || /^#/.test(t)) return null;
  const pct = t.endsWith("%");
  const n = Number(t.replace("%", "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

/** Строки раздела: от строки start до первой из end */
function section(grid: Grid, start: RegExp, end?: RegExp[]): { from: number; to: number } | null {
  const from = grid.findIndex((row) => start.test(rowLabel(row)));
  if (from < 0) return null;
  let to = grid.length;
  for (let i = from + 1; i < grid.length; i++) {
    const label = rowLabel(grid[i]);
    if (label && end?.some((e) => e.test(label))) {
      to = i;
      break;
    }
  }
  return { from, to };
}

export type Extracted = { values: Record<Version, Values>; missing: MetricKey[]; problem: string | null };

/** Значения показателей продукта или группы по версиям */
export function extract(grid: Grid, spec: Pick<ProductSpec | GroupSpec, "start" | "end" | "find" | "label">, columns: ParsedSheet["columns"]): Extracted {
  const values: Record<Version, Values> = { LBE: {}, BUD: {} };
  const range = section(grid, spec.start, spec.end);
  if (!range) return { values, missing: Object.keys(spec.find) as MetricKey[], problem: `Не найден раздел «${spec.label}»` };
  const missing: MetricKey[] = [];
  for (const [key, find] of Object.entries(spec.find) as [MetricKey, { label: RegExp; after?: RegExp }][]) {
    let i = range.from;
    if (find.after) {
      const anchor = grid.slice(range.from, range.to).findIndex((row) => find.after!.test(rowLabel(row)));
      if (anchor < 0) {
        missing.push(key);
        continue;
      }
      i = range.from + anchor + 1;
    }
    let found = -1;
    for (; i < range.to; i++) {
      if (find.label.test(rowLabel(grid[i]))) {
        found = i;
        break;
      }
    }
    if (found < 0) {
      missing.push(key);
      continue;
    }
    for (const v of ["LBE", "BUD"] as const) {
      const col = columns[v];
      values[v][key] = col === undefined ? null : cellNumber(grid[found]?.[col]);
    }
  }
  return { values, missing, problem: null };
}

const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance * Math.max(Math.abs(a), Math.abs(b), 1e-9);

/**
 * Проверка, что строки найдены правильно: трафик × конверсия дают продажи B2C, B2C и B2B дают продажи всего, продажи ×
 * выручка на продажу близки к выручке от продаж. Если нет, строки в LRF переехали или переименованы: показываем владельцу.
 * Проверяется только LBE: от него считается прогноз. В бюджете конверсии продуктов RED бывают не заполнены, а выручка на
 * продажу у B2B ниже, чем у B2C, поэтому допуск по выручке широкий
 */
export function checkValues(spec: Pick<ProductSpec, "model" | "label">, values: Record<Version, Values>): string[] {
  const out: string[] = [];
  const x = values.LBE;
  const say = (what: string) => out.push(`${spec.label}: ${what} в LBE`);
  if (spec.model === "funnel" && x.trafficWeb != null && x.crWeb != null && x.unitsB2c != null) {
    const b2c = x.trafficWeb * x.crWeb + (x.trafficApp ?? 0) * (x.crApp ?? 0);
    if (!near(b2c, x.unitsB2c, 0.02)) say("трафик и конверсия не дают продажи B2C");
  }
  if (spec.model === "funnel" && x.units != null && x.unitsB2c != null && !near(x.unitsB2c + (x.unitsB2b ?? 0), x.units, 0.02)) say("B2C и B2B не сходятся с продажами всего");
  if (x.units != null && x.rpu != null && x.revenueCore != null && x.units > 0 && !near((x.units * x.rpu) / 1e6, x.revenueCore, 0.25)) say("продажи и выручка на продажу не дают выручку от продаж");
  if (x.revenue != null && x.revenueCore != null && x.revenueCore > x.revenue * 1.001 + 1e-9) say("выручка от продаж больше всей выручки");
  if (x.revenue == null) say("нет выручки");
  return out;
}

type Read = { code: string; label: string; values: Record<Version, Values>; missing: MetricKey[]; problem: string | null };

export type PullResult = {
  products: (Read & { warnings: string[] })[];
  groups: Read[];
  problems: string[];
};

/** Все продукты и группы из листов LRF. sheets: имя листа и его сетка */
export function readLrf(sheets: Record<string, Grid | undefined>, month: string): PullResult {
  const problems: string[] = [];
  const cols = new Map<string, ParsedSheet>();
  for (const name of new Set([...PRODUCTS.map((p) => p.sheet), ...GROUPS.map((g) => g.sheet)])) {
    const grid = sheets[name];
    if (!grid) {
      problems.push(`Нет листа «${name}»`);
      continue;
    }
    const c = findColumns(grid, month);
    if (c.problem) problems.push(`Лист «${name}»: ${c.problem}`);
    cols.set(name, c);
  }
  const one = (spec: ProductSpec | GroupSpec): Read => {
    const grid = sheets[spec.sheet];
    const c = cols.get(spec.sheet);
    if (!grid || !c) return { code: spec.code, label: spec.label, values: { LBE: {}, BUD: {} }, missing: Object.keys(spec.find) as MetricKey[], problem: `Нет листа «${spec.sheet}»` };
    return { code: spec.code, label: spec.label, ...extract(grid, spec, c.columns) };
  };
  const products = PRODUCTS.map((spec) => {
    const read = one(spec);
    return { ...read, warnings: read.problem ? [] : checkValues(spec, read.values) };
  });
  return { products, groups: GROUPS.map(one), problems };
}
