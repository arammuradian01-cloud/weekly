"use client";

// Факт месяца по дням в карточке продукта (этап 35): факт с начала месяца, прогноз на дату при равномерном темпе,
// выполнение и месяц при текущем темпе против прогноза. График: факт за день столбиками и прогноз в день линией, одна шкала

import { FACT_METRICS, daysInMonth, pace, type FactMetric } from "@/lib/plan/facts";
import { formatPlan } from "@/lib/plan/format";
import type { ProductFacts } from "@/lib/plan/types";
import type { ProductSummary } from "@/lib/plan/summary";
import { Delta } from "@/components/ui/data";
import { WeekChart } from "@/components/analytics/week-chart";
import { delta, when } from "./plan-ui";

const forecastOf = (s: ProductSummary, m: FactMetric) => (m === "units" ? s.units.forecast : m === "revenue" ? s.revenue.forecast : s.promoMargin.forecast);
const pctText = (x: number | null) => (x === null ? "нет" : `${(x * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`);

export function PlanFacts({ month, facts, summary, label }: { month: string; facts: ProductFacts; summary: ProductSummary; label: string }) {
  const rows = FACT_METRICS.map((m) => ({ m, p: pace(facts.daily[m.key] ?? [], month, forecastOf(summary, m.key)) })).filter((x) => x.p !== null);
  if (!rows.length) return null;
  const first = rows[0]!.p!;
  // График по выручке, а если её нет в факте, по первому показателю
  const chartMetric = rows.find((r) => r.m.key === "revenue") ?? rows[0]!;
  const days = daysInMonth(month);
  const daily = new Map((facts.daily[chartMetric.m.key] ?? []).filter((d) => d.day.startsWith(month)).map((d) => [Number(d.day.slice(8, 10)), d.value]));
  const forecast = forecastOf(summary, chartMetric.m.key);
  const perDay = forecast === null ? null : forecast / days;
  const round = (v: number) => (chartMetric.m.unit === "count" ? Math.round(v) : Math.round(v * 10) / 10);
  const weeks = Array.from({ length: days }, (_, i) => ({ key: `${month}-${String(i + 1).padStart(2, "0")}`, number: i + 1, current: false }));
  const bars = weeks.map((w) => (daily.has(w.number) ? round(daily.get(w.number)!) : null));
  const line = perDay === null ? undefined : { label: "Прогноз в день при равномерном темпе", values: weeks.map(() => round(perDay)) };
  const unitWord = chartMetric.m.unit === "count" ? "" : " млн";

  return (
    <section className="sv-plan-facts" aria-labelledby={`facts-${summary.code}`} data-testid="plan-facts">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={`facts-${summary.code}`} className="text-body font-semibold text-ink">
          Факт месяца: {label}
        </h3>
        <p className="text-caption text-text-secondary">
          По {first.elapsed} число, дней с фактом {first.withData} из {first.elapsed}. Загружено {when(facts.loadedAt)}, {facts.loadedBy}
        </p>
      </div>
      <dl className="sv-plan-facts__grid">
        {rows.map(({ m, p }) => (
          <div key={m.key} className="sv-plan-facts__item" data-testid={`plan-fact-${m.key}`}>
            <dt className="sv-plan-facts__label">{m.label}</dt>
            <dd className="sv-plan-facts__value">{formatPlan(p!.toDate, m.unit)}</dd>
            <dd className="sv-plan-facts__line">
              <span>Прогноз на дату {formatPlan(p!.planToDate, m.unit)}</span>
              <span className="font-semibold text-ink">выполнение {pctText(p!.execution)}</span>
            </dd>
            <dd className="sv-plan-facts__line">
              <span>Месяц при этом темпе {formatPlan(p!.runRate, m.unit)}</span>
              <Delta value={delta(p!.runRate, forecastOf(summary, m.key), m.unit)} label={`${m.label}: темп к прогнозу`} />
            </dd>
          </div>
        ))}
      </dl>
      <WeekChart
        title={`${chartMetric.m.label} по дням`}
        weeks={weeks}
        bars={{ label: "Факт за день", values: bars }}
        line={line}
        labelEvery={5}
        dots={false}
        format={(v) => formatPlan(v, chartMetric.m.unit)}
        period={{ header: "День", tip: (w) => `${w.number} число` }}
        tip={(i) => [`Факт: ${bars[i] === null ? "нет данных" : `${formatPlan(bars[i], chartMetric.m.unit)}${unitWord}`}`, ...(line ? [`Прогноз в день: ${formatPlan(line.values[i], chartMetric.m.unit)}${unitWord}`] : [])]}
        columns={[
          { label: "Факт за день", value: (i) => (bars[i] === null ? "нет" : formatPlan(bars[i], chartMetric.m.unit)) },
          ...(line ? [{ label: "Прогноз в день", value: (i: number) => formatPlan(line.values[i], chartMetric.m.unit) }] : []),
        ]}
        insight="Темп считается равномерно по дням месяца: выходные и сезонность он не учитывает."
      />
    </section>
  );
}
