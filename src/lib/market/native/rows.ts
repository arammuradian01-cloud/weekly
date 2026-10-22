// Строки наборов пакета рынка для расчётов новой версии (этап 79). Наборы приходят из базы как есть (проверены при
// загрузке: текст, число, да или нет, пусто), поэтому каждое поле читается осторожно: Number() как в дашборде.

import type { MarketRow, MarketValue } from "../bundle";

export type Row = MarketRow;

/** Срез регионов: вся Россия, Москва, МО, СПб и ЛО, остальные регионы */
export type Geo = "all" | "top4" | "rest";
export const GEOS: readonly Geo[] = ["all", "top4", "rest"];
export const geoOf = (v: unknown): Geo => (v === "top4" || v === "rest" ? v : "all");

/** Наборы, которые нужны «Обзору» КАСКО и ОСАГО */
export const NATIVE_DATASETS = ["monthly", "k_sk_m", "k_wk", "o_monthly", "o_sk_m", "o_sravni_sk"] as const;
export type NativeDataset = (typeof NATIVE_DATASETS)[number];
export type NativeSets = Record<NativeDataset, Row[]>;

/** Число поля, пустое как ноль: Number(x || 0) */
export const num0 = (v: MarketValue | undefined): number => Number(v || 0);
/** Число поля или null, если поле пустое: x == null ? null : Number(x) */
export const numOrNull = (v: MarketValue | undefined): number | null => (v === null || v === undefined ? null : Number(v));
/** Поле пустое или его нет */
export const isNull = (v: MarketValue | undefined) => v === null || v === undefined;

/** Строки среза: строки без поля geo общие для всех срезов */
export const pickGeo = (rows: Row[], g: Geo) => rows.filter((r) => isNull(r.geo) || r.geo === g);

/** Месяц строки «2026-09» и год, номер месяца */
export const monthOf = (r: Row) => String(r.month ?? "");
export const yearNum = (m: string) => Number(m.slice(0, 4));
export const monthNum = (m: string) => Number(m.slice(5, 7));

/** Сумма полей по строкам, пустое как ноль */
export function sumCols(rows: Row[], cols: readonly string[]): number {
  let s = 0;
  for (const r of rows) for (const c of cols) s += num0(r[c]);
  return s;
}

/** Последний месяц набора и его год и номер; null, если месяцев нет */
export function lastMonth(rows: Row[]): { month: string; Y: number; M: number } | null {
  let last = "";
  for (const r of rows) {
    const m = monthOf(r);
    if (m > last) last = m;
  }
  if (!/^\d{4}-\d{2}$/.test(last)) return null;
  return { month: last, Y: yearNum(last), M: monthNum(last) };
}

/** Строки года y с января по месяц M включительно */
export const ytdRows = (rows: Row[], y: number, M: number) =>
  rows.filter((r) => {
    const m = monthOf(r);
    return yearNum(m) === y && monthNum(m) <= M;
  });

/** Строки по месяцу, по возрастанию месяцев */
export const byMonthSorted = (rows: Row[]) => rows.slice().sort((a, b) => monthOf(a).localeCompare(monthOf(b)));
