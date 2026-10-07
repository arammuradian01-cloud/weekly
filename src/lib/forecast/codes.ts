// Прогноз до конца месяца (этап 24, модуль М9): справочники без базы, нужны и серверу, и экранам

import type { ForecastSummary } from "./types";
import { ru } from "@/lib/numbers/parse";

export type ForecastMetricCode = "revenue" | "promo-margin" | "direct-margin" | "sales";
export type ForecastReasonCode = "traffic" | "conversion" | "check-kv" | "partner-sk" | "budget-base" | "other";

export const FORECAST_METRICS: { code: ForecastMetricCode; db: "REVENUE" | "PROMO_MARGIN" | "DIRECT_MARGIN" | "SALES"; label: string; unit: "mln" | "count" }[] = [
  { code: "revenue", db: "REVENUE", label: "Выручка", unit: "mln" },
  { code: "promo-margin", db: "PROMO_MARGIN", label: "Промо-маржа", unit: "mln" },
  { code: "direct-margin", db: "DIRECT_MARGIN", label: "Прямая маржа", unit: "mln" },
  { code: "sales", db: "SALES", label: "Продажи, шт.", unit: "count" },
];

export const FORECAST_REASONS: { code: ForecastReasonCode; db: "TRAFFIC" | "CONVERSION" | "CHECK_KV" | "PARTNER_SK" | "BUDGET_BASE" | "OTHER"; label: string }[] = [
  { code: "traffic", db: "TRAFFIC", label: "Трафик" },
  { code: "conversion", db: "CONVERSION", label: "Конверсия" },
  { code: "check-kv", db: "CHECK_KV", label: "Средний чек или КВ" },
  { code: "partner-sk", db: "PARTNER_SK", label: "Партнёр или СК" },
  { code: "budget-base", db: "BUDGET_BASE", label: "Бюджетная база" },
  { code: "other", db: "OTHER", label: "Другое" },
];

export const metricOf = (code: string) => FORECAST_METRICS.find((m) => m.code === code);
export const reasonOf = (code: string | null | undefined) => FORECAST_REASONS.find((r) => r.code === code);
export const metricLabel = (code: string) => metricOf(code)?.label ?? code;
export const reasonLabel = (code: string | null | undefined) => reasonOf(code)?.label ?? "";

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

/** «октябрь 2026» из «2026-10» */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** Месяц даты: «2026-10» */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Число прогноза для экрана: млн с одним знаком, штуки с разделителем */
export function formatForecast(value: number | null | undefined, unit: "mln" | "count"): string {
  if (value === null || value === undefined) return "нет";
  if (unit === "mln") return `${ru(value, 1)} млн`;
  return ru(Math.round(value), 0);
}

/** Отклонение в процентах со знаком: «+4,2%», null, если сравнивать не с чем */
export function deltaPct(value: number | null | undefined, base: number | null | undefined): number | null {
  if (value === null || value === undefined || base === null || base === undefined || base === 0) return null;
  return ((value - base) / Math.abs(base)) * 100;
}

export function formatPct(pct: number | null): string {
  if (pct === null) return "";
  return `${pct > 0 ? "+" : ""}${ru(pct, 1)}%`;
}

/** Нужна ли причина: бюджет задан и прогноз от него отличается больше чем на 2% */
export function reasonNeeded(forecast: number, budget: number | null): boolean {
  if (budget === null || budget === 0) return false;
  return Math.abs(forecast - budget) / Math.abs(budget) > 0.02;
}

/** Текст для отчёта CEO */
export function forecastText(s: ForecastSummary): string[] {
  if (!s.lines.length) return ["Прогноз на эту неделю никто не обновил."];
  const out: string[] = [];
  for (const g of s.groups) {
    for (const l of g.lines) {
      const parts = [`- ${g.label}, ${l.metricLabel.toLowerCase()} за ${l.month}: ${formatForecast(l.forecast, l.unit)}`];
      if (l.budget !== null) parts.push(`бюджет ${formatForecast(l.budget, l.unit)}${l.toBudgetPct !== null ? ` (${formatPct(l.toBudgetPct)})` : ""}`);
      if (l.previous) parts.push(`прошлый прогноз ${formatForecast(l.previous.forecast, l.unit)}`);
      if (l.reasonLabel) parts.push(`что поехало: ${l.reasonLabel.toLowerCase()}`);
      if (l.comment) parts.push(l.comment);
      out.push(parts.join(", "));
    }
  }
  return out;
}
