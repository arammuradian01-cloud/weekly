import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { currentActor } from "@/lib/action-runner";
import { audienceOf, currentTeam, subjectOf } from "@/lib/org/current";
import { getWeekView } from "@/lib/weekly/service";
import { isWeekKey } from "@/lib/weekly/weeks";
import { weekNumbers } from "@/lib/numbers/service";
import { forecastHistory, forecastSummary, myForecast } from "@/lib/forecast/service";
import { monthPlan } from "@/lib/plan/service";
import { PageHeader } from "@/components/page-header";
import { PageTabs } from "@/components/ui/data";
import { WeekSwitcher } from "@/components/weekly/weekly-feed";
import { ForecastForm } from "@/components/forecast/forecast-form";
import { ForecastHistoryTable } from "@/components/forecast/forecast-history";
import { ForecastSummaryBlock, WeekNumbersBlock } from "@/components/forecast/week-numbers";
import { MonthPlan } from "@/components/plan/month-plan";

export const metadata: Metadata = { title: "Прогноз" };

/**
 * Прогноз: две вкладки. «Прогноз месяца» (этап 32): бюджет и LBE из LRF, команды продуктов корректируют драйверы.
 * «Неделя» (этап 24): цифры недели из недельного отчёта и прогноз лидеров до конца месяца
 */
export default async function ForecastPage({ searchParams }: { searchParams: Promise<{ week?: string; tab?: string; month?: string }> }) {
  const ctx = await requireContext();
  const { week, tab, month } = await searchParams;
  const weekTab = tab === "week" || (!!week && tab !== "month");
  const tabs = (
    <PageTabs
      label="Разделы прогноза"
      tabs={[
        { href: "/forecast", label: "Прогноз месяца", active: !weekTab, testId: "tab-month" },
        { href: "/forecast?tab=week", label: "Цифры недели", active: weekTab, testId: "tab-week" },
      ]}
    />
  );
  const actor = await currentActor();

  if (!weekTab) {
    const plan = await monthPlan(actor, month);
    return (
      <>
        <PageHeader title="Прогноз" description="Бюджет и LBE месяца из LRF. Команда продукта корректирует драйверы с обоснованием, выручка и маржа пересчитываются сразу" tabs={tabs} />
        <MonthPlan key={`${plan.month}:${plan.source.pulledAt ?? ""}`} initial={plan} />
      </>
    );
  }

  const team = await currentTeam(subjectOf(ctx));
  const audience = audienceOf(team);
  const view = await getWeekView(isWeekKey(week) ? week : null, new Date(), audience);
  const key = view.week.key;
  const canForecast = ctx.person.role !== "OBSERVER" && !subjectOf(ctx).limited;
  const [numbers, mine, summary, history] = await Promise.all([weekNumbers(key), canForecast ? myForecast(actor, key) : Promise.resolve(null), forecastSummary(key, audience), forecastHistory(audience, key)]);
  return (
    <>
      <PageHeader title="Прогноз" description="Факт недели из недельного отчёта и прогноз лидеров до конца месяца с причиной отклонения от бюджета" tabs={tabs}>
        <WeekSwitcher view={view} basePath="/forecast" />
      </PageHeader>
      <div className="flex flex-col gap-6">
        <WeekNumbersBlock numbers={numbers} manage={ctx.management?.role === "OWNER"} />
        {mine ? <ForecastForm key={key} initial={mine} /> : null}
        <ForecastSummaryBlock summary={summary} />
        <section aria-labelledby="forecast-history" className="sv-card sv-card--soft px-5 py-4">
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
