// Этап 81: числа и даты экрана «Неделя к плану». Штуки целыми с пробелами, выручка в млн ₽ с одним знаком, проценты со
// знаком, даты ДД.ММ.ГГГГ

import type { Unit } from "./contract";

export type Delta = { text: string; pct: string | null; sign: -1 | 0 | 1 };

const int = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const mln = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pctFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function num(value: number | null | undefined, unit: Unit): string {
  if (value === null || value === undefined) return "—";
  return unit === "шт" ? int.format(Math.round(value)) : mln.format(value);
}

/** Доля как процент со знаком: 0.052 → «+5,2%» */
export function pct(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  const v = Math.round(ratio * 1000) / 10;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${pctFmt.format(Math.abs(v))}%`;
}

/** Выполнение: доля 1.052 → «105,2%» */
export function share(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return `${pctFmt.format(Math.round(ratio * 1000) / 10)}%`;
}

/** Отклонение факта от плана: разница в единицах и в процентах */
export function delta(fact: number | null, plan: number | null, ratio: number | null, unit: Unit): Delta | null {
  if (fact === null || plan === null || ratio === null) return null;
  const d = fact - plan;
  const sign = Math.abs(ratio) < 0.0005 ? 0 : ratio > 0 ? 1 : -1;
  const abs = num(Math.abs(d), unit);
  return { text: `${sign > 0 ? "+" : sign < 0 ? "−" : ""}${abs}`, pct: pct(ratio), sign };
}

/** 2026-10-05 → 05.10.2026 */
export const dmy = (day: string) => day.split("-").reverse().join(".");

/** Неделя подписью: «05.10-11.10.2026» */
export function weekLabel(week: string, end: string): string {
  const a = dmy(week);
  const b = dmy(end);
  return a.slice(6) === b.slice(6) ? `${a.slice(0, 5)}-${b}` : `${a}-${b}`;
}

const monthNames = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
/** 2026-10-01 → «октябрь 2026» */
export const monthName = (month: string) => `${monthNames[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** Номер недели ISO */
export function isoWeek(day: string): number {
  const d = new Date(`${day}T00:00:00Z`);
  const thursday = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * 86_400_000);
  const jan1 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.floor((thursday.getTime() - jan1.getTime()) / 86_400_000 / 7) + 1;
}
