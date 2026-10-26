"use client";

// Неделя к плану (этап 81): график по неделям. Столбики факт, линия план выбранной версии; таблица вместо графика
// по кнопке. Основа: WeekChart аналитики

import { WeekChart } from "@/components/analytics/week-chart";
import type { Unit } from "@/lib/weekplan/contract";
import { dmy, isoWeek, num } from "@/lib/weekplan/format";

export function WeekPlanChart({
  title,
  insight,
  weeks,
  fact,
  plan,
  planLabel,
  unit,
  today,
}: {
  title: string;
  insight?: string;
  weeks: string[];
  fact: (number | null)[];
  plan: (number | null)[];
  planLabel: string;
  unit: Unit;
  today: string;
}) {
  const end = (w: string) => new Date(new Date(`${w}T00:00:00Z`).getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
  const chartWeeks = weeks.map((w) => ({ key: w, number: isoWeek(w), current: w <= today && today <= end(w) }));
  const f = (v: number | null) => num(v, unit);
  return (
    <WeekChart
      title={title}
      insight={insight}
      weeks={chartWeeks}
      bars={{ label: "Факт", values: fact }}
      line={{ label: planLabel, values: plan }}
      labelEvery={4}
      fractional={unit !== "шт"}
      format={(v) => (unit === "шт" ? Math.round(v).toLocaleString("ru-RU") : v.toLocaleString("ru-RU", { maximumFractionDigits: 1 }))}
      tip={(i) => [`Неделя ${dmy(weeks[i]!)}`, `Факт: ${f(fact[i] ?? null)}`, `${planLabel}: ${f(plan[i] ?? null)}`]}
      columns={[
        { label: "Начало", value: (i) => dmy(weeks[i]!) },
        { label: "Факт", value: (i) => f(fact[i] ?? null) },
        { label: planLabel, value: (i) => f(plan[i] ?? null) },
      ]}
    />
  );
}
