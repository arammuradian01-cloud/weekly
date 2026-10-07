// История прогноза по неделям (этап 24): строка на линию, колонки недели, отклонение последнего от предыдущего

import type { ForecastHistory } from "@/lib/forecast/types";
import { formatForecast, formatPct, deltaPct, monthLabel } from "@/lib/forecast/codes";
import { compactName } from "@/domain/people";
import { cn } from "@/lib/cn";

export function ForecastHistoryTable({ history, showAuthor = true }: { history: ForecastHistory; showAuthor?: boolean }) {
  if (!history.rows.length) return <p className="text-body text-muted">Прогнозов за эти недели пока нет.</p>;
  // Показываем только недели, где хоть у кого-то есть цифра, но не меньше четырёх последних
  const used = history.weeks.map((_, i) => history.rows.some((r) => r.values[i] !== null));
  const firstUsed = Math.max(0, Math.min(used.indexOf(true) === -1 ? history.weeks.length - 4 : used.indexOf(true), history.weeks.length - 4));
  const weeks = history.weeks.slice(firstUsed);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-small">
        <caption className="sr-only">История прогноза по неделям</caption>
        <thead className="text-caption text-muted">
          <tr>
            <th scope="col" className="py-1.5 pr-3 font-medium">Линия</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">Бюджет</th>
            {weeks.map((w) => (
              <th key={w.key} scope="col" className="py-1.5 pr-3 text-right font-medium tabular-nums">
                нед. {w.number}
              </th>
            ))}
            <th scope="col" className="py-1.5 text-right font-medium">Сдвиг</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {history.rows.map((r, i) => {
            const vals = r.values.slice(firstUsed);
            const present = vals.map((v, j) => [v, j] as const).filter(([v]) => v !== null) as [number, number][];
            const last = present.at(-1);
            const prev = present.at(-2);
            const shift = last && prev ? deltaPct(last[0], prev[0]) : null;
            return (
              <tr key={i} className="align-top">
                <td className="py-2 pr-3 text-ink">
                  <span className="font-medium">{r.directionLabel}</span>, {r.metricLabel.toLowerCase()}
                  <span className="block text-caption text-muted">
                    {monthLabel(r.month)}
                    {showAuthor ? `, ${compactName(r.author)}` : ""}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink">{r.budget !== null ? formatForecast(r.budget, r.unit) : <span className="text-muted">нет</span>}</td>
                {vals.map((v, j) => (
                  <td key={j} className={cn("py-2 pr-3 text-right tabular-nums", v === null ? "text-muted" : "text-ink", last && last[1] === j && "font-semibold")}>
                    {v === null ? "" : formatForecast(v, r.unit)}
                  </td>
                ))}
                <td className={cn("py-2 text-right tabular-nums", shift === null ? "text-muted" : shift < -2 ? "text-danger-ink" : shift > 2 ? "text-green-ink" : "text-ink")}>{shift === null ? "" : formatPct(shift)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
