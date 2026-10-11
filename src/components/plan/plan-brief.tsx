// Прогноз месяца в отчёте CEO и на встрече (этап 35): итог по продуктам, отклонения к LBE и бюджету, причины
// корректировок и кто ещё не проверил прогноз после загрузки LBE. Без состояния: подходит и серверу, и клиенту

import Link from "next/link";
import { formatPlan, lcFirst } from "@/lib/plan/format";
import { waitingText, type PlanBrief } from "@/lib/plan/brief";
import { Delta, Module, StatTile, Stats } from "@/components/ui/data";
import { cn } from "@/lib/cn";
import { delta, when } from "./plan-ui";

const HEAD: { key: "revenue" | "promoMargin" | "directMargin"; label: string }[] = [
  { key: "revenue", label: "Выручка" },
  { key: "promoMargin", label: "Промо-маржа" },
  { key: "directMargin", label: "Прямая маржа" },
];

export function PlanBriefBlock({ brief, compact = false, headingLevel = 2 }: { brief: PlanBrief; compact?: boolean; headingLevel?: 2 | 3 }) {
  return (
    <Module
      id="plan-brief"
      headingLevel={headingLevel}
      title={`Прогноз месяца: ${brief.monthLabel}`}
      description="Итог по продуктам после корректировок команд против LBE и бюджета."
      actions={
        <Link href={`/forecast?month=${brief.month}`} className="text-body font-semibold text-link hover:underline">
          Открыть прогноз
        </Link>
      }
      flush
    >
      <div className="px-5 pb-4" data-testid="plan-brief">
        <Stats label="Итог по продуктам" className={cn(compact && "sv-stats--compact")}>
          {HEAD.map((h) => {
            const t = brief.total[h.key];
            return (
              <StatTile
                key={h.key}
                testId={`plan-brief-${h.key}`}
                label={`${h.label}, прогноз`}
                value={formatPlan(t.forecast, "mln")}
                unit="млн ₽"
                compare={[
                  { label: "LBE", deltaLabel: `${h.label} к LBE`, value: formatPlan(t.lbe, "mln"), delta: delta(t.forecast, t.lbe, "mln") },
                  { label: "Бюджет", deltaLabel: `${h.label} к бюджету`, value: formatPlan(t.budget, "mln"), delta: delta(t.forecast, t.budget, "mln") },
                ]}
              />
            );
          })}
        </Stats>
        {brief.partners ? (
          // Этап 35б: партнёрский канал внутри продуктов (их полисы B2B), поэтому строкой под итогом, а не слагаемым
          <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-body" data-testid="plan-brief-partners">
            <span className="font-semibold text-ink">Партнёрский канал, внутри продуктов:</span>
            <span>выручка {formatPlan(brief.partners.revenue.forecast, "mln")} млн</span>
            <Delta value={delta(brief.partners.revenue.forecast, brief.partners.revenue.lbe, "mln")} label="Выручка канала к LBE" />
            <span className="text-text-secondary">к LBE,</span>
            <span>маржа {formatPlan(brief.partners.margin.forecast, "mln")} млн</span>
            <Delta value={delta(brief.partners.margin.forecast, brief.partners.margin.budget, "mln")} label="Маржа канала к бюджету" />
            <span className="text-text-secondary">к бюджету канала</span>
          </p>
        ) : null}
      </div>
      {!compact ? (
        <div className="overflow-x-auto">
          <table className="sv-datatable sv-datatable--stack" data-testid="plan-brief-table">
            <caption className="sr-only">Выручка по продуктам, млн рублей: прогноз и отклонения</caption>
            <thead>
              <tr>
                <th scope="col">Продукт</th>
                <th scope="col" className="is-num">
                  Выручка, прогноз, млн
                </th>
                <th scope="col" className="is-num">
                  К LBE
                </th>
                <th scope="col" className="is-num">
                  К бюджету
                </th>
                <th scope="col">После LBE</th>
              </tr>
            </thead>
            <tbody>
              {brief.rows.map((r) => (
                <tr key={r.code} className={cn(r.kind === "sub" && "sv-datatable__row--sub")}>
                  <td className="is-wide">
                    <span className={cn(r.kind !== "sub" && "sv-datatable__strong")}>{r.label}</span>
                  </td>
                  <td className="is-num" data-label="Прогноз, млн">
                    {formatPlan(r.revenue.forecast, "mln")}
                  </td>
                  <td className="is-num" data-label="К LBE">
                    <Delta value={delta(r.revenue.forecast, r.revenue.lbe, "mln")} label={`${r.label} к LBE`} />
                  </td>
                  <td className="is-num" data-label="К бюджету">
                    <Delta value={delta(r.revenue.forecast, r.revenue.budget, "mln")} label={`${r.label} к бюджету`} />
                  </td>
                  <td data-label="После LBE">
                    {r.review ? (
                      r.review.state === "waiting" ? (
                        <span className="sv-tag sv-tag--risk">ждёт проверки</span>
                      ) : (
                        <span className="text-caption text-text-secondary">{r.review.state === "adjusted" ? "скорректирован" : "проверен"}</span>
                      )
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {brief.reasons.length ? (
        <div className="px-5 py-4">
          <h3 className="mb-2 text-caption font-semibold text-text-secondary">Корректировки команд</h3>
          <ul className="flex flex-col gap-2" data-testid="plan-brief-reasons">
            {brief.reasons.slice(0, compact ? 3 : undefined).map((r) => (
              <li key={`${r.product}:${r.metric}:${r.at}`} className="text-body">
                <span className="font-semibold text-ink">
                  {r.product}, {lcFirst(r.metric)}:
                </span>{" "}
                {r.value} вместо {r.lbe} по LBE. {r.reason}: {r.comment}
                <span className="text-caption text-text-secondary">
                  {" "}
                  ({r.author}, {when(r.at)})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {brief.partnerReasons.length ? (
        <div className="px-5 pb-4">
          <h3 className="mb-2 text-caption font-semibold text-text-secondary">Корректировки партнёрского канала</h3>
          <ul className="flex flex-col gap-2" data-testid="plan-brief-partner-reasons">
            {brief.partnerReasons.slice(0, compact ? 2 : undefined).map((r) => (
              <li key={`${r.product}:${r.metric}:${r.at}`} className="text-body">
                <span className="font-semibold text-ink">
                  {r.product}, {lcFirst(r.metric)}:
                </span>{" "}
                {r.value} вместо {r.lbe} по LBE. {r.reason}: {r.comment}
                <span className="text-caption text-text-secondary">
                  {" "}
                  ({r.author}, {when(r.at)})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {brief.waiting.length ? (
        <p className="px-5 pb-4 text-body" data-testid="plan-brief-waiting">
          {waitingText(brief.waiting)}
        </p>
      ) : null}
    </Module>
  );
}
