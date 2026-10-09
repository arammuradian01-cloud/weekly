// Сводка прогноза месяца (этап 32): из значений LBE, бюджета и корректировок драйверов строки продуктов, итоги групп и
// итог по продуктам. Чистые функции: одна и та же сводка на сервере и на экране, где прогноз пересчитывается сразу по ходу ввода

import { PRODUCTS, groupOf, productOf, topLevel, type MetricKey, type ProductSpec } from "./spec";
import { compute, derive, rollUp, rowsOf } from "./model";
import type { Values } from "./lrf";

export type Drivers = Partial<Record<MetricKey, number>>;

export type PlanInput = {
  products: { code: string; lbe: Values; budget: Values; drivers: Drivers }[];
  groups: { code: string; lbe: Values; budget: Values }[];
};

/** Три версии одного показателя: бюджет, LBE (первая версия прогноза) и прогноз после корректировок */
export type Triple = { budget: number | null; lbe: number | null; forecast: number | null };

export type RowSummary = Triple & { key: MetricKey; kind: "driver" | "result"; adjusted: boolean };

export type ProductSummary = {
  code: string;
  spec: ProductSpec;
  current: Values;
  rows: RowSummary[];
  units: Triple;
  revenue: Triple;
  promoMargin: Triple;
  directMargin: Triple;
  /** Сколько драйверов скорректировано */
  adjusted: number;
};

export type TopSummary = {
  kind: "product" | "group";
  code: string;
  label: string;
  revenue: Triple;
  promoMargin: Triple;
  directMargin: Triple;
  adjusted: number;
  /** Продукты группы */
  parts: string[];
};

export type TotalSummary = Triple & { without: string[] };

export type PlanSummary = {
  products: ProductSummary[];
  top: TopSummary[];
  total: { revenue: TotalSummary; promoMargin: TotalSummary; directMargin: TotalSummary };
};

const num = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? null : x);
const triple = (budget: Values, lbe: Values, current: Values, key: MetricKey): Triple => ({ budget: num(budget[key]), lbe: num(lbe[key]), forecast: num(current[key]) });

/** Корректировка действует, если она отличается от LBE: равная LBE не считается */
export function activeDrivers(lbe: Values, drivers: Drivers): Drivers {
  const L = derive(lbe);
  const out: Drivers = {};
  for (const [k, v] of Object.entries(drivers) as [MetricKey, number][]) {
    if (!Number.isFinite(v)) continue;
    const base = num(L[k]);
    if (base !== null && Math.abs(v - base) <= 1e-9 * Math.max(1, Math.abs(base))) continue;
    out[k] = v;
  }
  return out;
}

export function summarizeProduct(spec: ProductSpec, lbe: Values, budget: Values, drivers: Drivers): ProductSummary {
  const active = activeDrivers(lbe, drivers);
  const L = derive(lbe);
  const B = derive(budget);
  const current = compute(spec, lbe, active);
  const rows = rowsOf(spec).map(({ key, kind }) => ({ key, kind, ...triple(B, L, current, key), adjusted: kind === "driver" && active[key] !== undefined }));
  return {
    code: spec.code,
    spec,
    current,
    rows,
    units: triple(B, L, current, "units"),
    revenue: triple(B, L, current, "revenue"),
    promoMargin: triple(B, L, current, "promoMargin"),
    directMargin: triple(B, L, current, "directMargin"),
    adjusted: Object.keys(active).length,
  };
}

function sumTotal(top: TopSummary[], key: "revenue" | "promoMargin" | "directMargin"): TotalSummary {
  const out: TotalSummary = { budget: null, lbe: null, forecast: null, without: [] };
  for (const t of top) {
    const x = t[key];
    if (x.lbe === null && x.forecast === null) {
      out.without.push(t.label);
      continue;
    }
    for (const v of ["budget", "lbe", "forecast"] as const) if (x[v] !== null) out[v] = (out[v] ?? 0) + x[v]!;
  }
  return out;
}

export function summarize(input: PlanInput): PlanSummary {
  const byCode = new Map(input.products.map((p) => [p.code, p]));
  const products: ProductSummary[] = [];
  for (const spec of PRODUCTS) {
    const p = byCode.get(spec.code);
    if (!p) continue;
    products.push(summarizeProduct(spec, p.lbe, p.budget, p.drivers));
  }
  const summaryOf = new Map(products.map((p) => [p.code, p]));
  const top: TopSummary[] = [];
  for (const t of topLevel()) {
    if (t.kind === "product") {
      const s = summaryOf.get(t.code);
      if (!s) continue;
      top.push({ kind: "product", code: t.code, label: t.label, revenue: s.revenue, promoMargin: s.promoMargin, directMargin: s.directMargin, adjusted: s.adjusted, parts: [] });
      continue;
    }
    const group = input.groups.find((g) => g.code === t.code);
    const parts = PRODUCTS.filter((p) => p.group === t.code && summaryOf.has(p.code));
    if (!group || !parts.length) continue;
    const forecast = rollUp(group.lbe, parts.map((p) => ({ lbe: byCode.get(p.code)!.lbe, current: summaryOf.get(p.code)!.current })));
    top.push({
      kind: "group",
      code: t.code,
      label: groupOf(t.code)?.label ?? t.code,
      revenue: triple(group.budget, group.lbe, forecast, "revenue"),
      promoMargin: triple(group.budget, group.lbe, forecast, "promoMargin"),
      directMargin: triple(group.budget, group.lbe, forecast, "directMargin"),
      adjusted: parts.reduce((s, p) => s + summaryOf.get(p.code)!.adjusted, 0),
      parts: parts.map((p) => p.code),
    });
  }
  return { products, top, total: { revenue: sumTotal(top, "revenue"), promoMargin: sumTotal(top, "promoMargin"), directMargin: sumTotal(top, "directMargin") } };
}

/** Название продукта или группы */
export const planLabel = (code: string) => productOf(code)?.label ?? groupOf(code)?.label ?? code;
