// Сезонность (этап 79): индекс месяца к среднему месяцу своего года, средний индекс по полным годам и оценка
// неполного года по сезонности. Формулы расчётов k_season и o_season дашборда: для неполного года индекс считается
// к среднему тех же месяцев, оценка года: с начала года, делённое на долю этих месяцев в году по полным годам.

import { monthNum, monthOf, yearNum, type Row } from "./rows";

export type SeasonYear = {
  year: number;
  full: boolean;
  /** Значения по месяцам 1..12 (индекс 0 = январь), пусто: месяца нет */
  values: (number | null)[];
  idx: (number | null)[];
};
export type SeasonLbe = { year: number; ytd: number; lbe: number | null; prevFull: number; growth: number | null; months: number };
export type Season = {
  years: SeasonYear[];
  /** Средний индекс месяца по полным годам */
  avgIdx: (number | null)[];
  /** Оценки неполных лет по сезонности, по годам (дашборд в подписи берёт первую) */
  lbe: SeasonLbe[];
};

const fin = (v: number | null | undefined): number | null => (v === null || v === undefined || !Number.isFinite(v) ? null : v);
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

/** withLbe: показатель-поток, для него есть оценка года (у среднего чека и средней премии её нет) */
export function seasonOf(rows: Row[], value: (r: Row) => number | null, withLbe: boolean): Season {
  const pts = rows
    .map((r) => {
      const v = value(r);
      return { y: yearNum(monthOf(r)), m: monthNum(monthOf(r)), v: v === null ? null : Number(v) };
    })
    .filter((p): p is { y: number; m: number; v: number } => p.v !== null);
  const years = [...new Set(pts.map((p) => p.y))].sort((a, b) => a - b);
  const of = (y: number) => pts.filter((p) => p.y === y);
  const full = years.filter((y) => of(y).length === 12);
  const idxFull = new Map<string, number>();
  for (const y of full) {
    const mu = mean(of(y).map((p) => p.v));
    if (mu) for (const p of of(y)) idxFull.set(`${y}|${p.m}`, p.v / mu);
  }
  const avgIdx = (m: number): number | null => {
    const a = full.map((y) => idxFull.get(`${y}|${m}`)).filter((v): v is number => v !== undefined && v !== null);
    return a.length ? mean(a) : null;
  };
  const out: Season = { years: [], avgIdx: Array.from({ length: 12 }, (_, i) => fin(avgIdx(i + 1))), lbe: [] };
  for (const y of years) {
    const yr = of(y);
    const isFull = full.includes(y);
    let norm: number | null = null;
    if (!isFull && full.length) {
      const ai = yr.map((p) => avgIdx(p.m)).filter((v): v is number => v !== null);
      norm = mean(yr.map((p) => p.v)) / mean(ai);
    }
    const values: (number | null)[] = Array(12).fill(null);
    const idx: (number | null)[] = Array(12).fill(null);
    const seen = new Set<number>();
    for (const p of yr) {
      // Как в дашборде: на месяц берётся первая строка
      if (p.m < 1 || p.m > 12 || seen.has(p.m)) continue;
      seen.add(p.m);
      values[p.m - 1] = p.v;
      idx[p.m - 1] = fin(isFull ? (idxFull.get(`${y}|${p.m}`) ?? null) : norm ? p.v / norm : null);
    }
    out.years.push({ year: y, full: isFull, values, idx });
    if (!isFull && full.length && withLbe) {
      const share = yr.reduce((s, p) => s + (avgIdx(p.m) || 0), 0) / 12;
      const ytd = yr.reduce((s, p) => s + p.v, 0);
      const prevFull = of(full.at(-1)!).reduce((s, p) => s + p.v, 0);
      out.lbe.push({ year: y, ytd, lbe: fin(share ? ytd / share : null), prevFull, growth: fin(share && prevFull ? ytd / share / prevFull - 1 : null), months: yr.length });
    }
  }
  return out;
}

/** Пик и спад по среднему индексу: месяц 1..12 и индекс */
export function seasonPeaks(s: Season): { peak: { m: number; idx: number }; low: { m: number; idx: number } } | null {
  const list = s.avgIdx.map((idx, i) => ({ m: i + 1, idx })).filter((x): x is { m: number; idx: number } => x.idx !== null);
  if (!list.length) return null;
  const sorted = list.slice().sort((a, b) => b.idx - a.idx);
  return { peak: sorted[0]!, low: sorted.at(-1)! };
}
