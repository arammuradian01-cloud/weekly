// Прогноз до конца месяца (этап 24): типы экранов без базы

import type { PersonSlug, WeekKey } from "@/domain/types";
import type { ForecastMetricCode, ForecastReasonCode } from "./codes";

export type ForecastLineInput = {
  direction: string;
  metric: ForecastMetricCode;
  month: string;
  budget: number | null;
  forecast: number;
  reason: ForecastReasonCode | null;
  comment?: string | null;
};

export type ForecastLineView = ForecastLineInput & {
  id: string;
  week: WeekKey;
  weekNumber: number;
  author: PersonSlug;
  team: string;
  directionLabel: string;
  metricLabel: string;
  reasonLabel: string;
  unit: "mln" | "count";
  /** Прошлый прогноз той же линии: последняя неделя раньше этой */
  previous: { week: WeekKey; weekNumber: number; forecast: number } | null;
  /** Отклонение от бюджета и от прошлого прогноза, проценты */
  toBudgetPct: number | null;
  toPreviousPct: number | null;
};
export type MyForecast = {
  week: WeekKey;
  weekNumber: number;
  closed: boolean;
  /** Месяц по умолчанию: месяц понедельника недели */
  month: string;
  lines: ForecastLineView[];
  /** Линии с прошлых недель, которых ещё нет на этой: подставляются как черновик */
  carry: ForecastLineView[];
};
export type ForecastSummary = {
  week: WeekKey;
  lines: ForecastLineView[];
  /** По направлениям, в порядке справочника */
  groups: { direction: string; label: string; lines: ForecastLineView[] }[];
};
export type ForecastHistory = {
  weeks: { key: WeekKey; number: number }[];
  rows: { author: PersonSlug; direction: string; directionLabel: string; metric: ForecastMetricCode; metricLabel: string; unit: "mln" | "count"; month: string; budget: number | null; values: (number | null)[] }[];
};
