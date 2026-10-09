// Прогноз месяца (этап 32): мелочи для экранов. Какие показатели в сводке, хорошее направление изменения, дата правки

import type { MetricKey } from "@/lib/plan/spec";
import type { ForecastReasonCode } from "@/lib/forecast/codes";
import { formatPlanDelta } from "@/lib/plan/format";
import type { PlanUnit } from "@/lib/plan/spec";
import type { DeltaValue } from "@/components/ui/data";

export type Headline = "revenue" | "promoMargin" | "directMargin";

export const HEADLINES: { key: Headline; label: string }[] = [
  { key: "revenue", label: "Выручка" },
  { key: "promoMargin", label: "Промо-маржа" },
  { key: "directMargin", label: "Прямая маржа" },
];

/** Рост хорош для всего, кроме расходов на продвижение */
export const betterOf = (key: MetricKey): "up" | "down" => (key === "promoCosts" ? "down" : "up");

/** Причина по умолчанию для драйвера: человеку остаётся проверить */
export function defaultReason(key: MetricKey): ForecastReasonCode {
  if (key === "trafficWeb" || key === "trafficApp") return "traffic";
  if (key === "crWeb" || key === "crApp") return "conversion";
  if (key === "rpu") return "check-kv";
  if (key === "unitsB2b") return "partner-sk";
  return "other";
}

export function delta(value: number | null | undefined, base: number | null | undefined, unit: PlanUnit): DeltaValue | null {
  return formatPlanDelta(value, base, unit);
}

const dateFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long" });
const timeFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });

/** «9 октября в 12:40» по Москве */
export function when(iso: string): string {
  const d = new Date(iso);
  return `${dateFmt.format(d)} в ${timeFmt.format(d)}`;
}

/** Фамилия и инициал: «Головкин В.» */
export function shortName(full: string): string {
  const [last, first] = full.split(/\s+/);
  return first ? `${last} ${first.charAt(0)}.` : full;
}
