import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { currentActor } from "@/lib/action-runner";
import { audienceOf, currentTeam, subjectOf } from "@/lib/org/current";
import { getWeekView } from "@/lib/weekly/service";
import { isWeekKey } from "@/lib/weekly/weeks";
import { weekNumbers } from "@/lib/numbers/service";
import { forecastHistory, forecastSummary, myForecast } from "@/lib/forecast/service";
import { PageHeader } from "@/components/page-header";
import { WeekSwitcher } from "@/components/weekly/weekly-feed";
import { ForecastForm } from "@/components/forecast/forecast-form";
import { ForecastHistoryTable } from "@/components/forecast/forecast-history";
import { ForecastSummaryBlock, WeekNumbersBlock } from "@/components/forecast/week-numbers";

export const metadata: Metadata = { title: "Прогноз" };

/** Цифры недели и прогноз до конца месяца (этап 24, модуль М9) */
export default async function ForecastPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const ctx = await requireContext();
  const { week } = await searchParams;
  const team = await currentTeam(subjectOf(ctx));
  const audience = audienceOf(team);
  const view = await getWeekView(isWeekKey(week) ? week : null, new Date(), audience);
  const key = view.week.key;
  const actor = await currentActor();
  const canForecast = ctx.person.role !== "OBSERVER" && !subjectOf(ctx).limited;
  const [numbers, mine, summary, history] = await Promise.all([weekNumbers(key), canForecast ? myForecast(actor, key) : Promise.resolve(null), forecastSummary(key, audience), forecastHistory(audience, key)]);
  return (
    <>
      <PageHeader title="Цифры и прогноз" description="Факт недели из недельного отчёта и прогноз лидеров до конца месяца с причиной отклонения от бюджета">
        <WeekSwitcher view={view} basePath="/forecast" />
      </PageHeader>
      <div className="flex flex-col gap-6">
        <WeekNumbersBlock numbers={numbers} manage={ctx.management?.role === "OWNER"} />
        {mine ? <ForecastForm key={key} initial={mine} /> : null}
        <ForecastSummaryBlock summary={summary} />
        <section aria-labelledby="forecast-history" className="rounded-xl px-5 py-4 ring-1 ring-line">
          <h2 id="forecast-history" className="text-title-sm font-semibold text-ink">
            История прогноза по неделям
          </h2>
          <p className="mb-3 mt-1 text-body text-muted">Как менялся прогноз от недели к неделе. Последняя цифра выделена, сдвиг считается к предыдущей.</p>
          <ForecastHistoryTable history={history} />
        </section>
      </div>
    </>
  );
}
