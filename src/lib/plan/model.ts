// Пересчёт прогноза месяца по драйверам (этап 32): чистые функции без базы.
//
// Пересчёт идёт от значений LBE через отношения и разницы драйверов, поэтому без корректировок прогноз совпадает с LBE
// до копейки, даже если формулы LRF сложнее модели (пул, апсейл, кросс):
// - продажи B2C = продажи B2C по LBE + (трафик × конверсия - то же по LBE), отдельно сайт и приложение;
// - продажи всего = по LBE + изменение B2C + изменение B2B;
// - выручка от продаж = по LBE × (продажи / продажи по LBE) × (выручка на продажу / она же по LBE);
// - выручка = выручка от продаж + прочая выручка (по LBE это выручка минус выручка от продаж);
// - промо-маржа = выручка - расходы на продвижение (по LBE это выручка минус промо-маржа);
// - прямая маржа = по LBE + изменение промо-маржи.
// Итог группы (RED) и департамента: значение по LBE плюс сумма изменений продуктов

import { DRIVERS, RESULTS, type MetricKey, type ProductSpec } from "./spec";
import type { Values } from "./lrf";

/** Достроить производные показатели: прочая выручка и расходы на продвижение */
export function derive(v: Values): Values {
  const out: Values = { ...v };
  const revenue = v.revenue ?? null;
  let core = v.revenueCore ?? null;
  if (core === null && v.units != null && v.rpu != null) core = (v.units * v.rpu) / 1e6;
  out.revenueCore = core;
  out.otherRevenue = revenue !== null && core !== null ? revenue - core : null;
  out.promoCosts = revenue !== null && v.promoMargin != null ? revenue - v.promoMargin : null;
  if (out.unitsB2c == null && v.trafficWeb != null && v.crWeb != null) out.unitsB2c = v.trafficWeb * v.crWeb + (v.trafficApp ?? 0) * (v.crApp ?? 0);
  if (out.units == null && out.unitsB2c != null) out.units = out.unitsB2c + (v.unitsB2b ?? 0);
  return out;
}

const n = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? null : x);

/** Значения продукта после корректировок драйверов. lbe: значения LBE, drivers: новые значения драйверов */
export function compute(spec: Pick<ProductSpec, "model">, lbe: Values, drivers: Partial<Record<MetricKey, number>>): Values {
  const L = derive(lbe);
  const d = (k: MetricKey) => (drivers[k] !== undefined && Number.isFinite(drivers[k]) ? drivers[k]! : n(L[k]));
  const out: Values = { ...L };
  for (const k of DRIVERS[spec.model]) out[k] = d(k);
  let units: number | null;
  if (spec.model === "funnel") {
    const part = (t: MetricKey, c: MetricKey, src: (k: MetricKey) => number | null) => {
      const tt = src(t);
      const cc = src(c);
      return tt === null || cc === null ? null : tt * cc;
    };
    const lbeOf = (k: MetricKey) => n(L[k]);
    const webL = part("trafficWeb", "crWeb", lbeOf);
    const appL = part("trafficApp", "crApp", lbeOf);
    const web = part("trafficWeb", "crWeb", d);
    const app = part("trafficApp", "crApp", d);
    const b2cL = n(L.unitsB2c) ?? (webL ?? 0) + (appL ?? 0);
    const b2c = b2cL + (web !== null && webL !== null ? web - webL : 0) + (app !== null && appL !== null ? app - appL : 0);
    const b2bL = n(L.unitsB2b) ?? 0;
    const b2b = d("unitsB2b") ?? b2bL;
    const unitsL = n(L.units) ?? b2cL + b2bL;
    units = unitsL + (b2c - b2cL) + (b2b - b2bL);
    out.unitsB2c = b2c;
    out.unitsB2b = b2b;
    out.units = units;
  } else {
    units = d("units");
    out.units = units;
  }
  const unitsL = n(L.units);
  const rpuL = n(L.rpu);
  const rpu = d("rpu");
  const coreL = n(L.revenueCore);
  let core: number | null = coreL;
  if (coreL !== null && units !== null && rpu !== null) {
    if (unitsL && rpuL) core = coreL * (units / unitsL) * (rpu / rpuL);
    else core = (units * rpu) / 1e6;
  }
  out.revenueCore = core;
  const other = d("otherRevenue");
  const revenue = core !== null ? core + (other ?? 0) : n(L.revenue);
  out.revenue = revenue;
  const costs = d("promoCosts");
  const pm = revenue !== null && costs !== null ? revenue - costs : n(L.promoMargin);
  out.promoMargin = pm;
  const pmL = n(L.promoMargin);
  out.directMargin = L.directMargin == null ? null : L.directMargin + (pm !== null && pmL !== null ? pm - pmL : 0);
  return out;
}

/** Итог группы: значения группы по LBE плюс сумма изменений продуктов */
export function rollUp(groupLbe: Values, parts: { lbe: Values; current: Values }[]): Values {
  const out: Values = { ...groupLbe };
  for (const k of ["units", "revenue", "promoMargin", "directMargin"] as const) {
    const base = n(groupLbe[k]);
    if (base === null) continue;
    let delta = 0;
    for (const p of parts) {
      // Прямой маржи у продуктов группы нет: она меняется на изменение промо-маржи
      const key = k === "directMargin" ? "promoMargin" : k;
      const a = n(p.current[key]);
      const b = n(derive(p.lbe)[key]);
      if (a !== null && b !== null) delta += a - b;
    }
    out[k] = base + delta;
  }
  return out;
}

/** Отклонение в процентах: null, если сравнивать не с чем */
export function deltaPct(value: number | null | undefined, base: number | null | undefined): number | null {
  if (value == null || base == null || base === 0 || !Number.isFinite(value) || !Number.isFinite(base)) return null;
  return ((value - base) / Math.abs(base)) * 100;
}

/** Показатели продукта на экране: сначала драйверы, потом результаты */
export function rowsOf(spec: Pick<ProductSpec, "model" | "find">): { key: MetricKey; kind: "driver" | "result" }[] {
  const has = (k: MetricKey) => k in spec.find || k === "otherRevenue" || k === "promoCosts" || (k === "unitsB2c" && spec.model === "funnel");
  return [
    ...DRIVERS[spec.model].filter(has).map((key) => ({ key, kind: "driver" as const })),
    ...RESULTS[spec.model].filter(has).map((key) => ({ key, kind: "result" as const })),
  ];
}
