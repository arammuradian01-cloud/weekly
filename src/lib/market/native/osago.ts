// Расчёты «Обзора» ОСАГО (этап 79): чистые функции над наборами пакета рынка. Формулы расчётов o_kpi_monthly,
// o_kpi, o_structure, o_season дашборда, строки «с начала года» из o_sk_v и недобор Сравни из o_sravni_v. «Обзор»
// ОСАГО в дашборде всегда по всей России (фильтра регионов на этой вкладке нет): здесь так же.

import { yearAgo } from "./format";
import type { OsagoMetric } from "./metrics";
import { isNull, lastMonth, monthNum, monthOf, numOrNull, num0, pickGeo, yearNum, ytdRows, type Row } from "./rows";
import { seasonOf, type Season } from "./season";
import { ytdBySk, type SkYtd } from "./period";
import { fin, type YtdMetric } from "./kasko";

export const OSAGO_FLOWS = ["total", "wo_short", "taxi_short", "relevant", "gmv", "avg_check", "agg_cnt", "sravni_policies", "sravni_b2c", "sravni_partners", "sravni_agents", "sravni_quotes_b2c", "sravni_avg_check"] as const;
export const OSAGO_RATIOS = ["pool_share", "wo_share", "eosago_share", "short_share", "agg_share", "sravni_share_rel", "sravni_share_wo", "sravni_in_agg", "quote_cr", "price_gap"] as const;
type OsagoField = (typeof OSAGO_FLOWS)[number] | (typeof OSAGO_RATIOS)[number];

export type OsagoMonth = { month: string } & Record<OsagoField, number | null> & Record<`${OsagoField}_yoy` | `${OsagoField}_mom`, number | null>;

const dv = (a: number | null, b: number | null) => (a !== null && b ? a / b : null);

function monthValues(r: Row | undefined): Record<OsagoField, number | null> | null {
  if (!r) return null;
  const n = (k: string) => numOrNull(r[k]);
  const avg = n("avg_check");
  const srAvg = n("sravni_avg_check");
  return {
    total: n("total"),
    wo_short: n("wo_short"),
    taxi_short: n("taxi_short"),
    relevant: n("relevant"),
    gmv: isNull(r.gmv_wo_short) ? null : Number(r.gmv_wo_short) / 1e3,
    avg_check: avg,
    pool_share: dv(n("pool"), n("wo_short")),
    wo_share: dv(n("wo_short"), n("total")),
    eosago_share: dv(n("e_osago"), n("total")),
    short_share: dv(n("taxi_short"), n("total")),
    agg_cnt: n("aggregators"),
    agg_share: dv(n("aggregators"), n("wo_short")),
    sravni_policies: n("sravni_policies"),
    sravni_b2c: n("sravni_b2c"),
    sravni_partners: n("sravni_partners"),
    sravni_agents: n("sravni_agents"),
    sravni_quotes_b2c: n("sravni_quotes_b2c"),
    sravni_share_rel: dv(n("sravni_policies"), n("relevant")),
    sravni_share_wo: dv(n("sravni_policies"), n("wo_short")),
    sravni_in_agg: dv(n("b2c_partners"), n("aggregators")),
    quote_cr: dv(n("sravni_b2c"), n("sravni_quotes_b2c")),
    sravni_avg_check: srAvg,
    price_gap: srAvg !== null && r.avg_check ? srAvg / Number(r.avg_check) - 1 : null,
  };
}

/** Ключевые цифры ОСАГО по месяцам (o_kpi_monthly). Рост коротких полисов считается, если в базе их от 100 тыс. */
export function osagoMonths(oMonthly: Row[]): OsagoMonth[] {
  const rows = pickGeo(oMonthly, "all")
    .slice()
    .sort((a, b) => monthOf(a).localeCompare(monthOf(b)));
  const by = new Map(rows.map((r) => [monthOf(r), r]));
  return rows.map((r, i) => {
    const v = monthValues(r)!;
    const y = monthValues(by.get(yearAgo(monthOf(r))));
    const p = i ? monthValues(rows[i - 1]) : null;
    const o: Record<string, number | null | string> = { month: monthOf(r) };
    for (const k of OSAGO_FLOWS) {
      const ok = (b: Record<OsagoField, number | null> | null) => !!(b && b[k] && (k !== "taxi_short" || b[k]! >= 100));
      o[`${k}_yoy`] = fin(ok(y) && v[k] !== null ? v[k]! / y![k]! - 1 : null);
      o[`${k}_mom`] = fin(ok(p) && v[k] !== null ? v[k]! / p![k]! - 1 : null);
    }
    for (const k of OSAGO_RATIOS) {
      o[`${k}_yoy`] = fin(y && y[k] !== null && v[k] !== null ? v[k]! - y[k]! : null);
      o[`${k}_mom`] = fin(p && p[k] !== null && v[k] !== null ? v[k]! - p[k]! : null);
    }
    for (const k of Object.keys(v) as OsagoField[]) o[k] = fin(v[k]);
    return o as OsagoMonth;
  });
}

export type OsagoYtd = { year: number; lastMonth: number; metrics: Record<OsagoMetric, YtdMetric> };

const OSAGO_YTD_RATIOS = new Set(["pool_share", "short_share", "agg_share", "sravni_share_rel", "sravni_share_wo", "sravni_in_agg", "quote_cr"]);

/** Главные цифры ОСАГО с начала года против тех же месяцев прошлого года (o_kpi) */
export function osagoYtd(oMonthly: Row[]): OsagoYtd | null {
  const rows = pickGeo(oMonthly, "all");
  const last = lastMonth(rows);
  if (!last) return null;
  const { Y, M } = last;
  const s = (rs: Row[], c: string) => rs.reduce((a, r) => a + num0(r[c]), 0);
  const calc = (rs: Row[]): Record<string, number | null> => {
    const wo = s(rs, "wo_short");
    const sr = s(rs, "sravni_policies");
    const srG = rs.filter((r) => !isNull(r.sravni_gmv));
    const rr = rs.filter((r) => !isNull(r.relevant) && !isNull(r.sravni_policies));
    const rel = s(rr, "relevant");
    return {
      wo_short: wo,
      total: s(rs, "total"),
      taxi_short: s(rs, "taxi_short"),
      relevant: s(rs, "relevant"),
      gmv: s(rs, "gmv_wo_short") / 1e3,
      avg_check: wo ? (s(rs, "gmv_wo_short") * 1e3) / wo : null,
      pool_share: wo ? s(rs, "pool") / wo : null,
      short_share: s(rs, "total") ? s(rs, "taxi_short") / s(rs, "total") : null,
      agg_share: wo ? s(rs, "aggregators") / wo : null,
      sravni_policies: sr,
      sravni_b2c: s(rs, "sravni_b2c"),
      sravni_share_rel: rel ? s(rr, "sravni_policies") / rel : null,
      sravni_share_wo: wo ? sr / wo : null,
      sravni_in_agg: s(rs, "aggregators") ? s(rs, "b2c_partners") / s(rs, "aggregators") : null,
      quote_cr: s(rs, "sravni_quotes_b2c") ? s(rs, "sravni_b2c") / s(rs, "sravni_quotes_b2c") : null,
      sravni_avg_check: srG.length === rs.length && s(srG, "sravni_policies") ? (s(srG, "sravni_gmv") * 1e3) / s(srG, "sravni_policies") : null,
    };
  };
  const cur = calc(ytdRows(rows, Y, M));
  const prev = calc(ytdRows(rows, Y - 1, M));
  const metrics = {} as OsagoYtd["metrics"];
  for (const k of Object.keys(cur) as OsagoMetric[]) {
    const c = cur[k] ?? null;
    const p = prev[k] ?? null;
    const ratio = OSAGO_YTD_RATIOS.has(k);
    metrics[k] = { value: fin(c), prev: fin(p), change: fin(c === null || p === null || (!ratio && !p) ? null : ratio ? c - p : c / p - 1) };
  }
  return { year: Y, lastMonth: M, metrics };
}

export type OsagoShareRow = { key: string; label: string; cur: number; prev: number; share: number | null; change: number | null };

const OSAGO_STEPS: [string, string][] = [
  ["total", "Весь рынок ОСАГО"],
  ["taxi_short", "Короткие полисы такси"],
  ["wo_short", "Рынок без коротких"],
  ["pool", "Пул"],
  ["relevant", "Доступный рынок (A и B)"],
  ["aggregators", "Продажи агрегаторов"],
  ["sravni_policies", "Сравни"],
];

/** Из чего состоит рынок ОСАГО с начала года, тыс. полисов (o_structure) */
export function osagoStructure(oMonthly: Row[]): OsagoShareRow[] {
  const rows = pickGeo(oMonthly, "all");
  const last = lastMonth(rows);
  if (!last) return [];
  const cur = ytdRows(rows, last.Y, last.M);
  const prev = ytdRows(rows, last.Y - 1, last.M);
  const s = (rs: Row[], c: string) => rs.reduce((a, r) => a + num0(r[c]), 0);
  const tot = s(cur, "total");
  return OSAGO_STEPS.map(([key, label]) => {
    const c = s(cur, key);
    const p = s(prev, key);
    return { key, label, cur: c, prev: p, share: fin(tot ? c / tot : null), change: fin(p ? c / p - 1 : null) };
  });
}

export const OSAGO_SEASON_METRICS = ["wo_short", "relevant", "total", "taxi_short", "gmv", "avg_check", "sravni_policies"] as const;
export type OsagoSeasonMetric = (typeof OSAGO_SEASON_METRICS)[number];

const OSAGO_SEASON_FN: Record<OsagoSeasonMetric, (r: Row) => number | null> = {
  wo_short: (r) => numOrNull(r.wo_short),
  relevant: (r) => numOrNull(r.relevant),
  total: (r) => numOrNull(r.total),
  taxi_short: (r) => numOrNull(r.taxi_short),
  gmv: (r) => (isNull(r.gmv_wo_short) ? null : Number(r.gmv_wo_short) / 1e3),
  avg_check: (r) => numOrNull(r.avg_check),
  sravni_policies: (r) => numOrNull(r.sravni_policies),
};
const OSAGO_NO_LBE = new Set<OsagoSeasonMetric>(["avg_check", "taxi_short", "total"]);

/** Сезонность ОСАГО (o_season): у среднего чека, коротких полисов и всего рынка оценки года нет */
export function osagoSeason(oMonthly: Row[], metric: OsagoSeasonMetric): Season {
  return seasonOf(pickGeo(oMonthly, "all"), OSAGO_SEASON_FN[metric], !OSAGO_NO_LBE.has(metric));
}

/** Страховые доступного рынка ОСАГО с начала года (строки ytd из o_sk_v): cnt в наборе в тысячах */
export function osagoSkYtd(oSkM: Row[]): SkYtd | null {
  return ytdBySk(oSkM, { segment: null, cntMul: 1e3 });
}

export type SravniGap = { item: string; gap: number; srCnt: number; skCnt: number };

/**
 * Недобор Сравни по страховым с начала года (o_sravni_v, по всей России): сколько полисов Сравни продал бы в СК
 * при своей средней доле по всем СК, минус фактические продажи, тыс. СК без продаж Сравни тоже в списке.
 * null: периода с начала года нет
 */
export function osagoSravniGaps(oSravniSk: Row[], oSkM: Row[]): SravniGap[] | null {
  const sr = pickGeo(oSravniSk, "all");
  const sk = pickGeo(oSkM, "all");
  const months = [...new Set(sr.map(monthOf))].sort();
  const last = months.at(-1);
  if (!last || !/^\d{4}-\d{2}$/.test(last)) return null;
  const Y = yearNum(last);
  const M = monthNum(last);
  if (M >= 12) return null;
  const ms = new Set(months.filter((m) => yearNum(m) === Y && monthNum(m) <= M));
  const ALL = "Все СК";
  // Полисы Сравни по СК за период (в порядке месяцев, как в дашборде) и СК рынка без продаж Сравни
  const pol = new Map<string, number>();
  for (const m of [...ms].sort())
    for (const r of sr) {
      if (monthOf(r) !== m) continue;
      const v = Number(r.policies);
      const item = String(r.sk ?? "");
      pol.set(item, (pol.get(item) ?? 0) + v);
      pol.set(ALL, (pol.get(ALL) ?? 0) + v);
    }
  for (const m of [...ms].sort())
    for (const r of sk) {
      const item = String(r.sk ?? "");
      if (monthOf(r) === m && !pol.has(item) && Number(r.cnt) > 0) pol.set(item, 0);
    }
  // Рынок СК по месяцам, в штуках
  const mk = new Map<string, number>();
  for (const r of sk) {
    const k = `${monthOf(r)}|${String(r.sk ?? "")}`;
    mk.set(k, (mk.get(k) ?? 0) + Number(r.cnt) * 1e3);
    const t = `${monthOf(r)}|${ALL}`;
    mk.set(t, (mk.get(t) ?? 0) + Number(r.cnt) * 1e3);
  }
  const skc = (item: string) => [...ms].reduce((s, m) => s + (mk.get(`${m}|${item}`) || 0), 0);
  const totPol = pol.get(ALL) ?? 0;
  const totSk = skc(ALL);
  const inSk = totSk ? totPol / totSk : null;
  if (inSk === null || !pol.has(ALL)) return [];
  const out: SravniGap[] = [];
  for (const [item, p] of pol) {
    if (item === ALL) continue;
    const skCnt = skc(item) / 1e3;
    const srCnt = p / 1e3;
    out.push({ item, gap: Math.max(0, inSk * skCnt - srCnt), srCnt, skCnt });
  }
  return out;
}
