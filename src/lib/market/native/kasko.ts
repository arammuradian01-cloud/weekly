// Расчёты «Обзора» КАСКО (этап 79): чистые функции над наборами пакета рынка, по одному срезу регионов за раз.
// Формулы перенесены из кода дашборда (расчёты kpi_monthly, kpi, structure, age_mix, k_drivers, k_mix, k_weeks,
// k_season и строка «с начала года» из k_sk_v): те же поля, те же правила пустых значений. Где дашборд получал бы
// NaN или бесконечность (деление на ноль), здесь пусто: на экране и там и там «-».

import type { KaskoMetric } from "./metrics";
import { byMonthSorted, isNull, lastMonth, monthOf, num0, pickGeo, sumCols, ytdRows, type Geo, type Row } from "./rows";
import { yearAgo } from "./format";
import { seasonOf, type Season } from "./season";
import { ytdBySk, type SkYtd } from "./period";

/** Конечное число или null */
export const fin = (v: number | null | undefined): number | null => (v === null || v === undefined || !Number.isFinite(v) ? null : v);

const ALL_COLS = ["full_fl", "full_fl_park", "full_jl", "full_jl_park", "mini_fl", "mini_jl"] as const;
const CORE_COLS = ["age_1", "age_2_3", "age_4_7", "age_8_10", "age_11"] as const;
const TOP4_COLS = ["reg_msk", "reg_mo", "reg_spb", "reg_lo"] as const;

export const KASKO_FLOWS = ["fl_cnt", "fl_prem", "fl_avg", "core_cnt", "sravni_deals", "sravni_leads"] as const;
export const KASKO_RATIOS = ["new_share", "mini_share", "top4_share", "sravni_share", "sravni_reach", "sravni_cr"] as const;

export type KaskoValues = Record<KaskoMetric, number | null>;
/** Месяц: значения показателей и их изменение к тому же месяцу прошлого года (_yoy) и к прошлому месяцу (_mom) */
export type KaskoMonth = { month: string } & KaskoValues & Record<`${KaskoMetric}_yoy` | `${KaskoMetric}_mom`, number | null>;

function monthValues(r: Row | undefined): KaskoValues | null {
  if (!r) return null;
  const fl = num0(r.full_fl);
  const all = sumCols([r], ALL_COLS);
  return {
    fl_cnt: fl / 1e3,
    fl_prem: num0(r.prem_full_fl),
    fl_avg: fl ? (num0(r.prem_full_fl) * 1e3) / fl : null,
    core_cnt: sumCols([r], CORE_COLS) / 1e3,
    new_share: fl ? num0(r.age_new) / fl : null,
    mini_share: all ? (num0(r.mini_fl) + num0(r.mini_jl)) / all : null,
    top4_share: fl ? sumCols([r], TOP4_COLS) / fl : null,
    sravni_deals: isNull(r.sravni_deals) ? null : num0(r.sravni_deals),
    sravni_share: !isNull(r.sravni_deals) && fl ? num0(r.sravni_deals) / fl : null,
    sravni_reach: !isNull(r.sravni_leads) && fl ? num0(r.sravni_leads) / fl : null,
    sravni_leads: isNull(r.sravni_leads) ? null : num0(r.sravni_leads),
    sravni_cr: r.sravni_leads ? num0(r.sravni_deals) / num0(r.sravni_leads) : null,
  };
}

/** Ключевые цифры по месяцам (kpi_monthly) */
export function kaskoMonths(monthly: Row[], geo: Geo): KaskoMonth[] {
  const rows = pickGeo(monthly, geo)
    .slice()
    .sort((a, b) => monthOf(a).localeCompare(monthOf(b)));
  const by = new Map(rows.map((r) => [monthOf(r), r]));
  return rows.map((r, i) => {
    const v = monthValues(r)!;
    const y = monthValues(by.get(yearAgo(monthOf(r))));
    const p = i ? monthValues(rows[i - 1]) : null;
    const o: Record<string, number | null | string> = { month: monthOf(r), ...v };
    for (const k of KASKO_FLOWS) {
      o[`${k}_yoy`] = fin(y && y[k] && v[k] !== null ? v[k]! / y[k]! - 1 : null);
      o[`${k}_mom`] = fin(p && p[k] && v[k] !== null ? v[k]! / p[k]! - 1 : null);
    }
    for (const k of KASKO_RATIOS) {
      o[`${k}_yoy`] = fin(y && y[k] !== null && v[k] !== null ? v[k]! - y[k]! : null);
      o[`${k}_mom`] = fin(p && p[k] !== null && v[k] !== null ? v[k]! - p[k]! : null);
    }
    for (const k of Object.keys(v) as KaskoMetric[]) o[k] = fin(v[k]);
    return o as KaskoMonth;
  });
}

export type YtdMetric = { value: number | null; prev: number | null; change: number | null };
export type KaskoYtd = { year: number; lastMonth: number; metrics: Record<KaskoMetric | "all_cnt", YtdMetric> };

const KASKO_YTD_RATIOS = new Set(["new_share", "top4_share", "mini_share", "sravni_share", "sravni_reach", "sravni_cr"]);

/** Главные цифры с начала года против тех же месяцев прошлого года (kpi) */
export function kaskoYtd(monthly: Row[], geo: Geo): KaskoYtd | null {
  const rows = pickGeo(monthly, geo);
  const last = lastMonth(rows);
  if (!last) return null;
  const { Y, M } = last;
  const calc = (rs: Row[]): Record<string, number | null> => {
    const all = sumCols(rs, ALL_COLS);
    const fl = sumCols(rs, ["full_fl"]);
    const prem = sumCols(rs, ["prem_full_fl"]);
    const sr = rs.filter((r) => !isNull(r.sravni_deals));
    const flS = sumCols(sr, ["full_fl"]);
    const deals = sumCols(sr, ["sravni_deals"]);
    const leads = sumCols(sr, ["sravni_leads"]);
    return {
      fl_cnt: fl / 1e3,
      fl_prem: prem / 1e3,
      fl_avg: fl ? (prem * 1e3) / fl : null,
      core_cnt: sumCols(rs, CORE_COLS) / 1e3,
      new_share: fl ? sumCols(rs, ["age_new"]) / fl : null,
      top4_share: fl ? sumCols(rs, TOP4_COLS) / fl : null,
      mini_share: all ? sumCols(rs, ["mini_fl", "mini_jl"]) / all : null,
      all_cnt: all / 1e3,
      sravni_deals: deals,
      sravni_share: flS ? deals / flS : null,
      sravni_reach: flS ? leads / flS : null,
      sravni_cr: leads ? deals / leads : null,
      sravni_leads: leads,
    };
  };
  const cur = calc(ytdRows(rows, Y, M));
  const prev = calc(ytdRows(rows, Y - 1, M));
  const metrics = {} as KaskoYtd["metrics"];
  for (const k of Object.keys(cur) as (KaskoMetric | "all_cnt")[]) {
    const c = cur[k] ?? null;
    const p = prev[k] ?? null;
    metrics[k] = { value: fin(c), prev: fin(p), change: fin(c === null || p === null ? null : KASKO_YTD_RATIOS.has(k) ? c - p : c / p - 1) };
  }
  return { year: Y, lastMonth: M, metrics };
}

export type ShareRow = { key: string; label: string; cur: number; prev: number; share: number | null; prevShare?: number | null; change: number | null };

const STRUCTURE_STEPS: [string, string, readonly string[]][] = [
  ["all", "Всё КАСКО", ALL_COLS],
  ["mini", "Мини-КАСКО (кроссы)", ["mini_fl", "mini_jl"]],
  ["full", "Полное КАСКО", ["full_fl", "full_fl_park", "full_jl", "full_jl_park"]],
  ["full_jl", "Полное КАСКО ЮЛ и парки", ["full_fl_park", "full_jl", "full_jl_park"]],
  ["full_fl", "Полное КАСКО ФЛ", ["full_fl"]],
  ["core", "Машины от 1 года", CORE_COLS],
];

/** Из чего состоит рынок с начала года, тыс. договоров (structure) */
export function kaskoStructure(monthly: Row[], geo: Geo): ShareRow[] {
  const rows = pickGeo(monthly, geo);
  const last = lastMonth(rows);
  if (!last) return [];
  const cur = ytdRows(rows, last.Y, last.M);
  const prev = ytdRows(rows, last.Y - 1, last.M);
  const tot = sumCols(cur, STRUCTURE_STEPS[0]![2]) / 1e3;
  return STRUCTURE_STEPS.map(([key, label, cols]) => {
    const c = sumCols(cur, cols) / 1e3;
    const p = sumCols(prev, cols) / 1e3;
    return { key, label, cur: c, prev: p, share: fin(c / tot), change: fin(p ? c / p - 1 : null) };
  });
}

const AGES: [string, string][] = [
  ["age_new", "Новые"],
  ["age_1", "1 год"],
  ["age_2_3", "2-3 года"],
  ["age_4_7", "4-7 лет"],
  ["age_8_10", "8-10 лет"],
  ["age_11", "11 лет и старше"],
];

/** Полное КАСКО ФЛ по возрасту машины с начала года, тыс. договоров (age_mix) */
export function kaskoAges(monthly: Row[], geo: Geo): ShareRow[] {
  const rows = pickGeo(monthly, geo);
  const last = lastMonth(rows);
  if (!last) return [];
  const cur = ytdRows(rows, last.Y, last.M);
  const prev = ytdRows(rows, last.Y - 1, last.M);
  const tc = AGES.reduce((a, [c]) => a + sumCols(cur, [c]) / 1e3, 0);
  const tp = AGES.reduce((a, [c]) => a + sumCols(prev, [c]) / 1e3, 0);
  return AGES.map(([key, label]) => {
    const c = sumCols(cur, [key]) / 1e3;
    const p = sumCols(prev, [key]) / 1e3;
    return { key, label, cur: c, prev: p, share: fin(c / tc), prevShare: fin(p / tp), change: fin(p ? c / p - 1 : null) };
  });
}

export type DriverMonth = {
  month: string;
  cnt: number;
  prem: number;
  avg: number | null;
  avg_ss: number | null;
  rate: number | null;
  avg_yoy: number | null;
  avg_ss_yoy: number | null;
  rate_yoy: number | null;
  /** Рост премий к тому же месяцу прошлого года и его разложение: договоры, стоимость машин, тариф, прочее */
  g_prem: number | null;
  c_vol: number | null;
  c_ss: number | null;
  c_rate: number | null;
  c_other: number | null;
};

/** Откуда рост премий полного КАСКО ФЛ (k_drivers) */
export function kaskoDrivers(kSkM: Row[], geo: Geo): DriverMonth[] {
  type Acc = { cnt: number; prem: number; ss: number; cs: number; ps: number };
  const by = new Map<string, Acc>();
  for (const r of pickGeo(kSkM, geo)) {
    if (r.segment !== "Полное КАСКО ФЛ") continue;
    const m = monthOf(r);
    const a = by.get(m) ?? { cnt: 0, prem: 0, ss: 0, cs: 0, ps: 0 };
    a.cnt += Number(r.cnt);
    a.prem += Number(r.prem);
    a.ss += num0(r.ss);
    a.cs += num0(r.cnt_ss);
    a.ps += num0(r.prem_ss);
    by.set(m, a);
  }
  const months = [...by.keys()].sort();
  const val = (a: Acc | undefined) => (a ? { cnt: a.cnt / 1e3, prem: a.prem, avg: a.cnt ? (a.prem * 1e6) / a.cnt : null, avg_ss: a.cs ? a.ss / a.cs : null, rate: a.ss ? a.ps / a.ss : null } : null);
  return months.map((m) => {
    const v = val(by.get(m))!;
    const y = val(by.get(yearAgo(m)));
    const ratio = (k: "avg" | "avg_ss") => fin(y && y[k] && v[k] !== null ? v[k]! / y[k]! - 1 : null);
    const o: DriverMonth = {
      month: m,
      cnt: v.cnt,
      prem: v.prem,
      avg: fin(v.avg),
      avg_ss: fin(v.avg_ss),
      rate: fin(v.rate),
      avg_yoy: ratio("avg"),
      avg_ss_yoy: ratio("avg_ss"),
      rate_yoy: fin(y && y.rate !== null && v.rate !== null ? v.rate - y.rate : null),
      g_prem: null,
      c_vol: null,
      c_ss: null,
      c_rate: null,
      c_other: null,
    };
    if (y && y.prem && y.cnt && y.avg_ss && y.rate && v.avg_ss && v.rate) {
      const g = v.prem / y.prem - 1;
      const L = Math.log(v.prem / y.prem);
      const lv = Math.log(v.cnt / y.cnt);
      const ls = Math.log(v.avg_ss / y.avg_ss);
      const lr = Math.log(v.rate / y.rate);
      const f = L ? g / L : 0;
      o.g_prem = fin(g);
      o.c_vol = fin(lv * f);
      o.c_ss = fin(ls * f);
      o.c_rate = fin(lr * f);
      o.c_other = fin((L - lv - ls - lr) * f);
    }
    return o;
  });
}

export type MixMonth = { month: string; all: number; parts: Record<string, number>; shares: Record<string, number | null> };

/** Доля каждого сегмента во всех договорах КАСКО за месяц (k_mix) */
export function kaskoMix(monthly: Row[], geo: Geo): MixMonth[] {
  return byMonthSorted(pickGeo(monthly, geo)).map((r) => {
    const raw = { full_fl: num0(r.full_fl), full_jl: num0(r.full_fl_park) + num0(r.full_jl) + num0(r.full_jl_park), mini_fl: num0(r.mini_fl), mini_jl: num0(r.mini_jl) };
    const all = Object.values(raw).reduce((a, b) => a + b, 0);
    const parts: Record<string, number> = {};
    const shares: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(raw)) {
      parts[k] = v / 1e3;
      shares[k] = all ? v / all : null;
    }
    return { month: monthOf(r), all: all / 1e3, parts, shares };
  });
}

export const WEEK_SEGMENTS = ["full_fl", "mini_fl", "full_jl", "mini_jl", "dsago"] as const;
export type WeekSegment = (typeof WEEK_SEGMENTS)[number];
export type KaskoWeek = {
  key: string;
  year: number;
  wk: number;
  start: string;
  /** Последняя неделя неполная: данные до даты выгрузки */
  partial: boolean;
  seg: Record<WeekSegment, { value: number; py: number | null; yoy: number | null; r3: number | null }>;
};

/** Свежие недели текущего года по сегментам, рост к той же неделе прошлого года (k_weeks) */
export function kaskoWeeks(kWk: Row[], geo: Geo): KaskoWeek[] {
  const rows = pickGeo(kWk, geo);
  if (!rows.length) return [];
  const key = (fy: number, wk: number) => `${fy}|${wk}`;
  const idx = new Map(rows.map((r) => [key(Number(r.fy), Number(r.wk)), r]));
  const Y = Math.max(...rows.map((r) => Number(r.fy)));
  const lastWk = Math.max(...rows.filter((r) => Number(r.fy) === Y).map((r) => Number(r.wk)));
  return rows
    .filter((r) => Number(r.fy) === Y)
    .sort((a, b) => Number(a.wk) - Number(b.wk))
    .map((r) => {
      const wk = Number(r.wk);
      const py = idx.get(key(Y - 1, wk));
      const seg = {} as KaskoWeek["seg"];
      for (const s of WEEK_SEGMENTS) {
        const w3 = [wk - 2, wk - 1, wk];
        const c3 = w3.map((w) => idx.get(key(Y, w)));
        const p3 = w3.map((w) => idx.get(key(Y - 1, w)));
        const sumP = p3.reduce((a, q) => a + (q ? num0(q[s]) : 0), 0);
        const sumC = c3.reduce((a, q) => a + (q ? num0(q[s]) : 0), 0);
        seg[s] = {
          value: num0(r[s]) / 1e3,
          py: py ? num0(py[s]) / 1e3 : null,
          yoy: fin(py && py[s] && wk !== lastWk ? num0(r[s]) / Number(py[s]) - 1 : null),
          r3: fin(wk !== lastWk && c3.every(Boolean) && p3.every(Boolean) && sumP ? sumC / sumP - 1 : null),
        };
      }
      return { key: key(Y, wk), year: Y, wk, start: String(r.start ?? ""), partial: wk === lastWk, seg };
    });
}

export const KASKO_SEASON_METRICS = ["full_fl", "prem_fl", "avg_fl", "mini_fl", "full_jl", "all", "sravni_deals"] as const;
export type KaskoSeasonMetric = (typeof KASKO_SEASON_METRICS)[number];

const KASKO_SEASON_FN: Record<KaskoSeasonMetric, (r: Row) => number | null> = {
  full_fl: (r) => num0(r.full_fl) / 1e3,
  prem_fl: (r) => num0(r.prem_full_fl) / 1e3,
  avg_fl: (r) => (r.full_fl ? (Number(r.prem_full_fl) * 1e3) / Number(r.full_fl) : null),
  mini_fl: (r) => num0(r.mini_fl) / 1e3,
  full_jl: (r) => (num0(r.full_jl) + num0(r.full_jl_park) + num0(r.full_fl_park)) / 1e3,
  all: (r) => sumCols([r], ALL_COLS) / 1e3,
  sravni_deals: (r) => (isNull(r.sravni_deals) ? null : Number(r.sravni_deals)),
};

/** Сезонность выбранного показателя (k_season): у средней премии оценки года нет */
export function kaskoSeason(monthly: Row[], geo: Geo, metric: KaskoSeasonMetric): Season {
  return seasonOf(pickGeo(monthly, geo), KASKO_SEASON_FN[metric], metric !== "avg_fl");
}

/** Страховые полного КАСКО ФЛ с начала года против тех же месяцев прошлого года (строки ytd из k_sk_v) */
export function kaskoSkYtd(kSkM: Row[], geo: Geo): SkYtd | null {
  return ytdBySk(pickGeo(kSkM, geo), { segment: "Полное КАСКО ФЛ", cntMul: 1 });
}

