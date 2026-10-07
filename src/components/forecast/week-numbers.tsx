// Блок «Цифры недели» и сводка прогноза (этап 24): показываются в отчёте CEO, на встрече и на странице прогноза.
// Данные приходят с сервера, компонент только рисует

import Link from "next/link";
import type { WeekNumbers } from "@/lib/numbers/text";
import type { ForecastSummary } from "@/lib/forecast/types";
import { formatForecast, formatPct } from "@/lib/forecast/codes";
import { compactName } from "@/domain/people";
import { formatShort } from "@/domain/dates";
import { cn } from "@/lib/cn";

/** Искра из последних недель: без библиотек, одна линия */
function Spark({ points }: { points: (number | null)[] }) {
  const nums = points.filter((p): p is number => p !== null);
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const w = 64;
  const h = 20;
  const coords = points.map((p, i) => (p === null ? null : [((i / (points.length - 1)) * (w - 2) + 1).toFixed(1), (h - 2 - ((p - min) / (max - min || 1)) * (h - 4)).toFixed(1)] as const));
  const d = coords.map((c, i) => (c ? `${i === 0 || !coords[i - 1] ? "M" : "L"}${c[0]} ${c[1]}` : "")).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0 text-blue-700">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function WeekNumbersBlock({ numbers, compact = false, manage = false, headingLevel: H = "h2" }: { numbers: WeekNumbers; compact?: boolean; /** Владелец видит ссылку на настройку */ manage?: boolean; headingLevel?: "h2" | "h3" }) {
  const setup = manage ? (
    <Link href="/sync" className="font-medium text-blue-700 hover:underline">
      Синхронизация
    </Link>
  ) : (
    "владелец на странице «Синхронизация»"
  );
  return (
    <section aria-labelledby="week-numbers" className={cn("rounded-xl px-5 py-4", numbers.ready ? "ring-1 ring-line" : "border border-dashed border-line")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <H id="week-numbers" className="text-title-sm font-semibold text-ink">
          Цифры недели
        </H>
        {numbers.ready ? <span className="text-caption text-muted">из недельного отчёта, неделя с {formatShort(numbers.week)}</span> : null}
      </div>
      {!numbers.connected ? (
        <p className="mt-1 text-body text-muted">Недельный отчёт не подключён. Цифры появятся, когда {setup} укажет ссылку на него. Руками факт никто не вводит.</p>
      ) : !numbers.figures.length ? (
        <p className="mt-1 text-body text-muted">Отчёт подключён, но цифры ещё не выбраны: {setup} отмечает строки отчёта.</p>
      ) : !numbers.ready ? (
        <p className="mt-1 text-body text-muted">
          За неделю с {formatShort(numbers.week)} цифр в отчёте ещё нет{numbers.latestWeek ? `, последняя заполненная неделя с ${formatShort(numbers.latestWeek)}` : ""}. Аналитик ставит их к понедельнику 18:00.
        </p>
      ) : (
        <dl className={cn("mt-3 grid gap-x-6 gap-y-3", compact ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4")}>
          {numbers.figures.map((f) => (
            <div key={f.key} className="flex items-start justify-between gap-3 rounded-lg bg-field px-3.5 py-2.5">
              <div className="min-w-0">
                <dt className="truncate text-caption text-muted" title={f.label}>
                  {f.label}
                </dt>
                <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                  <span className={cn("font-semibold tabular-nums text-ink", compact ? "text-body" : "text-headline-sm")}>{f.text}</span>
                  {f.delta ? <span className={cn("text-caption tabular-nums", f.delta.startsWith("+") ? "text-green-ink" : f.delta.startsWith("-") ? "text-danger-ink" : "text-muted")}>{f.delta}</span> : null}
                </dd>
              </div>
              {!compact ? <Spark points={f.history.map((h) => h.value)} /> : null}
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** Сводка прогноза недели по направлениям: бюджет, прогноз, отклонения, причина */
export function ForecastSummaryBlock({ summary, headingLevel: H = "h2", showAuthor = true, compact = false }: { summary: ForecastSummary; headingLevel?: "h2" | "h3"; showAuthor?: boolean; compact?: boolean }) {
  return (
    <section aria-labelledby="forecast-summary" className="rounded-xl px-5 py-4 ring-1 ring-line">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <H id="forecast-summary" className="text-title-sm font-semibold text-ink">
          Прогноз до конца месяца
        </H>
        <Link href="/forecast" className="text-small font-medium text-blue-700 hover:underline">
          Все прогнозы и история
        </Link>
      </div>
      {!summary.lines.length ? (
        <p className="mt-1 text-body text-muted">На этой неделе прогноз никто не обновил.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-small">
            <thead className="text-caption text-muted">
              <tr>
                <th scope="col" className="py-1.5 pr-3 font-medium">Линия и метрика</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Месяц</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">Бюджет</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">Прогноз</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">К бюджету</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">К прошлому</th>
                {!compact ? <th scope="col" className="py-1.5 font-medium">Что поехало</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {summary.groups.flatMap((g) =>
                g.lines.map((l) => (
                  <tr key={l.id} className="align-top">
                    <td className="py-2 pr-3 text-ink">
                      <span className="font-medium">{g.label}</span>, {l.metricLabel.toLowerCase()}
                      {showAuthor ? <span className="block text-caption text-muted">{compactName(l.author)}</span> : null}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-ink">{l.month}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ink">{l.budget !== null ? formatForecast(l.budget, l.unit) : <span className="text-muted">нет</span>}</td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums text-ink">{formatForecast(l.forecast, l.unit)}</td>
                    <td className={cn("py-2 pr-3 text-right tabular-nums", l.toBudgetPct === null ? "text-muted" : l.toBudgetPct < -2 ? "text-danger-ink" : l.toBudgetPct > 2 ? "text-green-ink" : "text-ink")}>{l.toBudgetPct === null ? "" : formatPct(l.toBudgetPct)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ink">
                      {l.previous ? (
                        <>
                          {formatPct(l.toPreviousPct)}
                          <span className="block text-caption text-muted">было {formatForecast(l.previous.forecast, l.unit)}, нед. {l.previous.weekNumber}</span>
                        </>
                      ) : (
                        <span className="text-muted">первый</span>
                      )}
                    </td>
                    {!compact ? (
                      <td className="py-2 text-ink">
                        {l.reasonLabel || <span className="text-muted">нет</span>}
                        {l.comment ? <span className="block text-caption text-muted">{l.comment}</span> : null}
                      </td>
                    ) : null}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
