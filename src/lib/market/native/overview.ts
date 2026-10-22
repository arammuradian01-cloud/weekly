// Модели вкладок «Обзор» КАСКО и ОСАГО для новой версии раздела «Рынок» (этап 79). Сервер считает их один раз на
// версию пакета и срез регионов и отдаёт странице готовыми: плитки, тексты «Главное», подписи и небольшие ряды для
// графиков и таблиц. Тексты те же по смыслу, что в дашборде, но без стрелок и сокращений вроде «г/г».

import { MON, MONF, dayShort, monthShort, n0, n1, n2, p1, p2, pct, pp, signed, yearAgo, FORMATS } from "./format";
import { KASKO_METRICS, OSAGO_METRICS, tone, type KaskoMetric, type OsagoMetric } from "./metrics";
import {
  KASKO_SEASON_METRICS,
  kaskoAges,
  kaskoDrivers,
  kaskoMix,
  kaskoMonths,
  kaskoSeason,
  kaskoSkYtd,
  kaskoStructure,
  kaskoWeeks,
  kaskoYtd,
  WEEK_SEGMENTS,
  type DriverMonth,
  type KaskoMonth,
  type KaskoSeasonMetric,
  type KaskoWeek,
  type MixMonth,
  type ShareRow,
  type WeekSegment,
} from "./kasko";
import { OSAGO_SEASON_METRICS, osagoMonths, osagoSeason, osagoSkYtd, osagoSravniGaps, osagoStructure, osagoYtd, type OsagoMonth, type OsagoSeasonMetric } from "./osago";
import { seasonPeaks, type Season } from "./season";
import type { Geo, NativeSets } from "./rows";

export type Tone = "good" | "bad" | "flat";
export type Tile = {
  key: string;
  label: string;
  value: string;
  unit?: string;
  delta: { text: string; tone: Tone };
  /** Последние 12 месяцев показателя для мини-графика */
  spark: number[];
};

export type Period = { year: number; lastMonth: number; /** «янв-сен 2026» */ label: string; /** «январь-сентябрь 2026» */ long: string; prevLabel: string };

const periodOf = (year: number, M: number): Period => ({
  year,
  lastMonth: M,
  label: `янв-${MON[M - 1]} ${year}`,
  long: M === 1 ? `январь ${year}` : `январь-${MONF[M - 1]} ${year}`,
  prevLabel: `янв-${MON[M - 1]} ${year - 1}`,
});

const spark = (rows: object[], key: string): number[] =>
  rows
    .map((r) => (r as Record<string, unknown>)[key])
    .filter((v): v is number => typeof v === "number")
    .slice(-12);

// ---------- КАСКО ----------

export const GEO_LABELS: Record<Geo, string> = { all: "Вся Россия", top4: "Топ-4 региона", rest: "Остальные регионы" };
const GEO_TITLE: Record<Geo, string> = { all: "", top4: ": топ-4 региона", rest: ": остальные регионы" };
const GEO_NOTE: Record<Geo, string | null> = {
  all: null,
  top4: "Москва, Московская область, Санкт-Петербург, Ленинградская область. Доля Сравни считается только по всей России.",
  rest: "Все регионы, кроме Москвы, Московской области, Санкт-Петербурга и Ленинградской области. Доля Сравни считается только по всей России.",
};

export const KASKO_MATRIX: KaskoMetric[] = ["fl_cnt", "fl_prem", "fl_avg", "core_cnt", "new_share", "top4_share", "mini_share", "sravni_deals", "sravni_share", "sravni_reach", "sravni_cr"];
export const KASKO_COMPARE: KaskoMetric[] = ["fl_cnt", "fl_prem", "fl_avg", "core_cnt", "new_share", "top4_share", "mini_share", "sravni_deals", "sravni_leads", "sravni_share", "sravni_reach", "sravni_cr"];
/** Не по всей России: без доли топ-4 и цифр Сравни (их нет по регионам) */
export const forGeo = (list: KaskoMetric[], geo: Geo) => (geo === "all" ? list : list.filter((k) => k !== "top4_share" && !k.startsWith("sravni")));

export const KASKO_SEASON_UNITS: Record<KaskoSeasonMetric, { label: string; format: "n0" | "n1"; unit: string }> = {
  full_fl: { label: "Полное КАСКО ФЛ, договоры", format: "n1", unit: "тыс. договоров" },
  prem_fl: { label: "Полное КАСКО ФЛ, премии", format: "n1", unit: "млрд руб" },
  avg_fl: { label: "Полное КАСКО ФЛ, средняя премия", format: "n1", unit: "тыс. руб" },
  mini_fl: { label: "Мини-КАСКО ФЛ", format: "n0", unit: "тыс. договоров" },
  full_jl: { label: "Полное КАСКО ЮЛ", format: "n1", unit: "тыс. договоров" },
  all: { label: "Всё КАСКО", format: "n0", unit: "тыс. договоров" },
  sravni_deals: { label: "Сделки Сравни", format: "n0", unit: "сделок" },
};

export const OSAGO_SEASON_UNITS: Record<OsagoSeasonMetric, { label: string; format: "n0" | "n1"; unit: string }> = {
  wo_short: { label: "Рынок без коротких", format: "n0", unit: "тыс. полисов" },
  relevant: { label: "Доступный рынок", format: "n0", unit: "тыс. полисов" },
  total: { label: "Весь рынок с короткими", format: "n0", unit: "тыс. полисов" },
  taxi_short: { label: "Короткие полисы такси", format: "n0", unit: "тыс. полисов" },
  gmv: { label: "Премии без коротких", format: "n1", unit: "млрд руб" },
  avg_check: { label: "Средний чек", format: "n0", unit: "руб" },
  sravni_policies: { label: "Полисы Сравни", format: "n0", unit: "тыс. полисов" },
};

export const WEEK_LABELS: Record<Exclude<WeekSegment, "mini_jl">, string> = { full_fl: "Полное ФЛ", mini_fl: "Мини ФЛ", full_jl: "Полное ЮЛ", dsago: "ДСАГО" };

export type SeasonBlock = { season: Season; note: string };

/** Подпись сезонности: пик и спад по среднему индексу и оценка года по сезонности */
export function seasonNote(s: Season, format: "n0" | "n1", unit: string): string {
  const parts: string[] = [];
  const peaks = seasonPeaks(s);
  if (peaks) parts.push(`Пик сезона: ${MONF[peaks.peak.m - 1]} (индекс ${n2(peaks.peak.idx)}), спад: ${MONF[peaks.low.m - 1]} (${n2(peaks.low.idx)}).`);
  const lbe = s.lbe[0];
  if (lbe && lbe.lbe !== null) parts.push(`Оценка ${lbe.year} года по сезонности: ${FORMATS[format](lbe.lbe)} ${unit} (${pct(lbe.growth)} к ${lbe.year - 1} году).`);
  return parts.join(" ");
}

export type KaskoOverview = {
  geo: Geo;
  title: string;
  geoNote: string | null;
  period: Period | null;
  tiles: Tile[];
  insights: string[];
  months: KaskoMonth[];
  matrix: KaskoMetric[];
  compare: KaskoMetric[];
  seasons: Record<KaskoSeasonMetric, SeasonBlock>;
  weeks: { rows: KaskoWeek[]; notes: Record<string, string> };
  drivers: { rows: DriverMonth[]; note: string | null };
  mix: MixMonth[];
  structure: ShareRow[];
  ages: ShareRow[];
};

const KASKO_TILES: { key: KaskoMetric; label: string; unit?: string; f: (v: number | null) => string }[] = [
  { key: "fl_cnt", label: "Полное КАСКО ФЛ", unit: "тыс.", f: n1 },
  { key: "fl_prem", label: "Премии", unit: "млрд руб", f: n1 },
  { key: "fl_avg", label: "Средняя премия", unit: "тыс. руб", f: n1 },
  { key: "core_cnt", label: "Машины от 1 года", unit: "тыс.", f: n1 },
  { key: "mini_share", label: "Доля мини-КАСКО", f: p1 },
  { key: "sravni_share", label: "Доля Сравни", f: p2 },
];
const KASKO_TILE_RATIOS = new Set(["mini_share", "sravni_share", "sravni_reach", "sravni_cr"]);

export function kaskoOverview(sets: NativeSets, geo: Geo): KaskoOverview {
  const ytd = kaskoYtd(sets.monthly, geo);
  const months = kaskoMonths(sets.monthly, geo);
  const period = ytd ? periodOf(ytd.year, ytd.lastMonth) : null;
  const tiles: Tile[] = ytd
    ? KASKO_TILES.map((t) => {
        const m = ytd.metrics[t.key];
        const regional = geo !== "all" && t.key.startsWith("sravni");
        if (regional) return { key: t.key, label: t.label, unit: undefined, value: "-", delta: { text: "только по всей России", tone: "flat" as Tone }, spark: [] };
        const change = m.change;
        const text = change === null ? "-" : `${KASKO_TILE_RATIOS.has(t.key) ? pp(change, t.key === "sravni_share") : pct(change)} к ${period!.prevLabel}`;
        return { key: t.key, label: t.label, unit: t.unit, value: m.value === null ? "-" : t.f(m.value), delta: { text, tone: tone(change, t.key !== "mini_share") }, spark: spark(months, t.key) };
      })
    : [];
  const sk = kaskoSkYtd(sets.k_sk_m, geo);
  const weeksAll = kaskoWeeks(sets.k_wk, geo);
  const insights: string[] = [];
  if (ytd) {
    const k = ytd.metrics;
    insights.push(`Полное КАСКО ФЛ: ${n0(k.fl_cnt.value)} тыс. договоров (${pct(k.fl_cnt.change)}), премии ${n1(k.fl_prem.value)} млрд руб (${pct(k.fl_prem.change)}).`);
    const total = sk?.rows.find((r) => r.total);
    if (total && total.rate_y !== null) {
      const tariffOnly = total.avgss_y !== null && total.avg_y !== null && Math.abs(total.avgss_y) < Math.abs(total.avg_y) / 3;
      insights.push(`Цена: тариф ${p2(total.rate)} (${pp(total.rate_y, true)}), страховая сумма ${pct(total.avgss_y)}${tariffOnly ? ": дорожает тариф, а не машины" : ""}.`);
    }
    if (sk) {
      const items = sk.rows.filter((r) => !r.total && r.dcnt_y !== null && !/^Прочие/.test(r.item));
      const up = items
        .slice()
        .sort((a, b) => b.dcnt_y! - a.dcnt_y!)
        .slice(0, 3);
      const down = items
        .slice()
        .sort((a, b) => a.dcnt_y! - b.dcnt_y!)
        .filter((r) => r.dcnt_y! < 0)
        .slice(0, 2);
      if (up.length) insights.push(`Рост: ${up.map((r) => `${r.item} ${signed(r.dcnt_y, 1)}`).join(", ")} тыс. договоров.${down.length ? ` Минус: ${down.map((r) => `${r.item} ${signed(r.dcnt_y, 1)}`).join(", ")} тыс.` : ""}`);
    }
    const lastFull = weeksAll.filter((w) => !w.partial).at(-1);
    if (lastFull && lastFull.seg.full_fl.r3 !== null) insights.push(`Последние три недели: ${pct(lastFull.seg.full_fl.r3)} к тем же неделям прошлого года, с начала года ${pct(k.fl_cnt.change)}.`);
    if (geo === "all") insights.push(`Сравни: ${p2(k.sravni_share.value)} рынка, охват лидами ${p1(k.sravni_reach.value)}, конверсия лида в сделку ${p1(k.sravni_cr.value)}.`);
  }

  const seasons = {} as KaskoOverview["seasons"];
  for (const m of KASKO_SEASON_METRICS) {
    const s = kaskoSeason(sets.monthly, geo, m);
    seasons[m] = { season: s, note: seasonNote(s, KASKO_SEASON_UNITS[m].format, KASKO_SEASON_UNITS[m].unit) };
  }

  const notes: Record<string, string> = {};
  const lastFull = weeksAll.filter((w) => !w.partial).at(-1);
  if (lastFull) {
    for (const s of WEEK_SEGMENTS) {
      const r3 = lastFull.seg[s].r3;
      const yoy = lastFull.seg[s].yoy;
      notes[s] = `Последние три полные недели (по неделю с ${dayShort(lastFull.start)}): ${r3 === null ? "сравнить не с чем" : `${pct(r3)} к тем же неделям прошлого года`}; последняя полная неделя: ${yoy === null ? "-" : `${pct(yoy)} к той же неделе прошлого года`}.`;
    }
  }

  let driverNote: string | null = null;
  const total = sk?.rows.find((r) => r.total);
  if (sk && total && total.rate !== null && total.rate_y !== null) {
    const tariffOnly = total.avgss_y !== null && total.avg_y !== null && Math.abs(total.avgss_y) < Math.abs(total.avg_y) / 3;
    driverNote = `${sk.label}: средняя премия ${pct(total.avg_y)}, тариф был ${p2(total.rate - total.rate_y)}, стал ${p2(total.rate)} (${pp(total.rate_y, true)}), средняя страховая сумма ${pct(total.avgss_y)}.${tariffOnly ? " Премия растёт за счёт тарифа, а не за счёт дорожания машин." : ""}`;
  }

  return {
    geo,
    title: `Рынок КАСКО${GEO_TITLE[geo]}`,
    geoNote: GEO_NOTE[geo],
    period,
    tiles,
    insights,
    months,
    matrix: forGeo(KASKO_MATRIX, geo),
    compare: forGeo(KASKO_COMPARE, geo),
    seasons,
    weeks: { rows: weeksAll.slice(-18), notes },
    drivers: { rows: kaskoDrivers(sets.k_sk_m, geo), note: driverNote },
    mix: kaskoMix(sets.monthly, geo),
    structure: kaskoStructure(sets.monthly, geo),
    ages: kaskoAges(sets.monthly, geo),
  };
}

// ---------- ОСАГО ----------

export const OSAGO_MATRIX: OsagoMetric[] = ["wo_short", "relevant", "taxi_short", "avg_check", "gmv", "pool_share", "agg_share", "sravni_policies", "sravni_share_rel", "sravni_in_agg", "quote_cr", "price_gap"];
export const OSAGO_COMPARE: OsagoMetric[] = ["wo_short", "relevant", "taxi_short", "total", "avg_check", "gmv", "pool_share", "agg_share", "sravni_policies", "sravni_b2c", "sravni_partners", "sravni_share_rel", "sravni_in_agg", "quote_cr", "sravni_avg_check", "price_gap"];

export type OsagoOverview = {
  period: Period | null;
  tiles: Tile[];
  insights: string[];
  months: OsagoMonth[];
  matrix: OsagoMetric[];
  compare: OsagoMetric[];
  seasons: Record<OsagoSeasonMetric, SeasonBlock>;
  structure: { key: string; label: string; cur: number; prev: number; share: number | null; change: number | null }[];
};

const OSAGO_TILES: { key: OsagoMetric; label: string; unit?: string; f: (v: number | null) => string }[] = [
  { key: "wo_short", label: "Рынок без коротких", unit: "тыс.", f: n0 },
  { key: "avg_check", label: "Средний чек", unit: "руб", f: n0 },
  { key: "gmv", label: "Премии", unit: "млрд руб", f: n1 },
  { key: "pool_share", label: "Доля пула", f: p1 },
  { key: "taxi_short", label: "Короткие такси", unit: "тыс.", f: n0 },
  { key: "sravni_share_rel", label: "Доля Сравни", f: p1 },
];
const OSAGO_TILE_RATIOS = new Set(["pool_share", "short_share", "agg_share", "sravni_share_rel", "sravni_share_wo", "sravni_in_agg", "quote_cr"]);

export function osagoOverview(sets: NativeSets): OsagoOverview {
  const ytd = osagoYtd(sets.o_monthly);
  const months = osagoMonths(sets.o_monthly);
  const period = ytd ? periodOf(ytd.year, ytd.lastMonth) : null;
  const tiles: Tile[] = ytd
    ? OSAGO_TILES.map((t) => {
        const m = ytd.metrics[t.key];
        const change = m.change;
        const text = change === null ? "-" : `${OSAGO_TILE_RATIOS.has(t.key) ? pp(change) : pct(change)} к ${period!.prevLabel}`;
        return { key: t.key, label: t.label, unit: t.unit, value: m.value === null ? "-" : t.f(m.value), delta: { text, tone: tone(change, t.key !== "pool_share") }, spark: spark(months, t.key) };
      })
    : [];
  const insights: string[] = [];
  const sk = osagoSkYtd(sets.o_sk_m);
  if (ytd) {
    const o = ytd.metrics;
    insights.push(`Без коротких: ${n0(o.wo_short.value)} тыс. полисов (${pct(o.wo_short.change)}), средний чек ${n0(o.avg_check.value)} руб (${pct(o.avg_check.change)}). Короткие полисы такси: ${n0(o.taxi_short.value)} тыс., ${p1(o.short_share.value)} всех полисов.`);
    const items = (sk?.rows ?? []).filter((r) => !r.total && r.dcnt_y !== null);
    const plus = items
      .slice()
      .sort((a, b) => b.dcnt_y! - a.dcnt_y!)
      .slice(0, 2);
    const minus = items
      .slice()
      .sort((a, b) => a.dcnt_y! - b.dcnt_y!)
      .slice(0, 3);
    if (minus.length || plus.length) insights.push(`Минус: ${minus.map((r) => `${r.item} ${signed(r.dcnt_y, 0)}`).join(", ")} тыс. полисов. Плюс: ${plus.map((r) => `${r.item} ${signed(r.dcnt_y, 0)}`).join(", ")} тыс.`);
    insights.push(`Сравни: ${n0(o.sravni_policies.value)} тыс. полисов (${pct(o.sravni_policies.change)}), доля в доступном рынке ${p1(o.sravni_share_rel.value)} (${pp(o.sravni_share_rel.change)}).`);
    const last = months.at(-1);
    const before = last ? months.find((r) => r.month === yearAgo(last.month)) : undefined;
    if (last && before && last.price_gap !== null && before.price_gap !== null)
      insights.push(
        `Риск: чек Сравни к рыночному в ${monthShort(before.month)} был ${pct(before.price_gap)}, в ${monthShort(last.month)} стал ${pct(last.price_gap)}; конверсия котировки в полис была ${p1(before.quote_cr)}, стала ${p1(last.quote_cr)}.`,
      );
    const gaps = osagoSravniGaps(sets.o_sravni_sk, sets.o_sk_m);
    const top = (gaps ?? [])
      .filter((g) => g.gap > 0)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 3);
    if (top.length) insights.push(`Недобор Сравни при его средней доле по всем страховым: ${top.map((g) => `${g.item} ${n0(g.gap)}`).join(", ")} тыс. полисов.`);
  }
  const seasons = {} as OsagoOverview["seasons"];
  for (const m of OSAGO_SEASON_METRICS) {
    const s = osagoSeason(sets.o_monthly, m);
    seasons[m] = { season: s, note: seasonNote(s, OSAGO_SEASON_UNITS[m].format, OSAGO_SEASON_UNITS[m].unit) };
  }
  return { period, tiles, insights, months, matrix: OSAGO_MATRIX, compare: OSAGO_COMPARE, seasons, structure: osagoStructure(sets.o_monthly) };
}

export { KASKO_METRICS, OSAGO_METRICS };
