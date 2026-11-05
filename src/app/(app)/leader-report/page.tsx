import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { currentActor } from "@/lib/action-runner";
import { TaskRuleError } from "@/lib/tasks/service";
import { leaderReportView } from "@/lib/leader-report/service";
import { reportHref } from "@/lib/leader-report/rules";
import { blocksMeta } from "@/lib/weekly-blocks/sources";
import { weekEndOf, weekNumberOf } from "@/lib/weekly/weeks";
import { formatLong } from "@/domain/dates";
import { PageHeader } from "@/components/page-header";
import { PageTabs } from "@/components/ui/data";
import { EmptyState } from "@/components/empty-state";
import { buttonClass } from "@/components/ui/button";
import { SentReportsView } from "@/components/leader-report/sent-view";
import { ReceivedReportsView } from "@/components/leader-report/received-view";

export const metadata: Metadata = { title: "Отчёт руководителю" };

const DESCRIPTION = "Отчёт, который руководитель собирает для своего руководителя: что вы отправили и что отправили вам. У полученного отчёта можно оставить комментарий";

/**
 * Отчёт руководителю (этап 73+81). Решения Арама 01.11: отдельный пункт меню, внутри две вкладки, «Отправленные» и
 * «Полученные»; у полученного отчёта руководитель оставляет комментарий. Собирают и отправляют отчёт там же, где
 * раньше: «Отчёт CEO» у команды страхования и инвестиций, «Weekly команды» у остальных
 */
export default async function LeaderReportPage({ searchParams }: { searchParams: Promise<{ week?: string; team?: string; tab?: string }> }) {
  const params = await searchParams;
  const one = (v: unknown) => (Array.isArray(v) ? (v[0] as string | undefined) : (v as string | undefined));
  let view: Awaited<ReturnType<typeof leaderReportView>>;
  try {
    view = await leaderReportView(await currentActor(), { week: one(params.week), team: one(params.team), tab: one(params.tab) });
  } catch (error) {
    if (!(error instanceof TaskRuleError)) throw error;
    return (
      <>
        <PageHeader title="Отчёт руководителю" description={DESCRIPTION} />
        <EmptyState title="Раздел недоступен">{error.message}</EmptyState>
      </>
    );
  }
  const meta = await blocksMeta();
  const tabs = [
    { href: reportHref("sent", { week: view.key }), label: "Отправленные", active: view.tab === "sent", testId: "tab-sent" },
    { href: reportHref("received", { week: view.key, team: view.team?.id }), label: "Полученные", active: view.tab === "received", testId: "tab-received" },
  ];
  const href = (week: string) => reportHref(view.tab, { week, team: view.team?.id });
  return (
    <>
      <PageHeader title="Отчёт руководителю" description={DESCRIPTION} tabs={<PageTabs label="Вкладки отчёта руководителю" tabs={tabs} />} />
      {/* Переключатель недель: прошлые недели листаются без ограничения, дальше отчётной нельзя */}
      <nav aria-label="Неделя отчёта" className="mb-5 flex flex-wrap items-center gap-2">
        <Link href={href(view.prev)} className={buttonClass("secondary", "sm")} aria-label={`Предыдущая неделя, ${weekNumberOf(view.prev)}`}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Неделя {weekNumberOf(view.prev)}
        </Link>
        <span className="px-1 text-body font-semibold text-ink" data-testid="leader-report-week">
          Неделя {view.number}: {formatLong(view.key)} - {formatLong(weekEndOf(view.key))}
          {view.key === view.reporting ? " (отчётная)" : ""}
        </span>
        {view.next ? (
          <Link href={href(view.next)} className={buttonClass("secondary", "sm")} aria-label={`Следующая неделя, ${weekNumberOf(view.next)}`}>
            Неделя {weekNumberOf(view.next)}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : null}
        {view.key !== view.reporting ? (
          <Link href={href(view.reporting)} className={buttonClass("ghost", "sm")}>
            Отчётная неделя
          </Link>
        ) : null}
      </nav>
      {view.tab === "sent" ? <SentReportsView view={view} labels={meta.labels} order={meta.order} /> : <ReceivedReportsView view={view} labels={meta.labels} order={meta.order} />}
      {view.weeks.length ? (
        <p className="mt-6 text-small text-muted">
          Отчёты есть за недели: {view.weeks.slice(0, 12).map((w) => w.number).join(", ")}.
        </p>
      ) : null}
    </>
  );
}
