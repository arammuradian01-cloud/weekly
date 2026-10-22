import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireContext } from "@/lib/auth";
import { currentActor } from "@/lib/action-runner";
import { ALL_TEAMS, currentTeam, subjectOf } from "@/lib/org/current";
import { TOP_TEAM } from "@/domain/teams";
import { currentReportingKey } from "@/lib/weekly/service";
import { isWeekKey, shiftWeek, weekNumberOf } from "@/lib/weekly/weeks";
import { TaskRuleError } from "@/lib/tasks/service";
import { teamReportView, teamTemplateView, type TeamReportView, type TeamTemplateView } from "@/lib/weekly-blocks/team";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { TeamReportScreen } from "@/components/weekly-blocks/team-report";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: "Weekly команды по блокам" };

/**
 * Weekly команды по смысловым блокам (этап 66): шаблон блоков команды, отчёт команды за неделю по ним и отправка своему
 * руководителю. Команда из адреса, иначе выбранная команда. У команды страхования и инвестиций это отчёт CEO
 */
export default async function TeamReportPage({ searchParams }: { searchParams: Promise<{ team?: string; week?: string }> }) {
  const ctx = await requireContext();
  const params = await searchParams;
  const one = (v: unknown) => (Array.isArray(v) ? (v[0] as string | undefined) : (v as string | undefined));
  const reporting = await currentReportingKey();
  const wanted = one(params.week);
  const key = isWeekKey(wanted) && wanted <= reporting ? wanted : reporting;
  const current = await currentTeam(subjectOf(ctx));
  const teamId = one(params.team) || (current.id && current.id !== ALL_TEAMS ? current.id : null);
  const header = (title: string) => <PageHeader title={title} description="Смысловые блоки weekly команды: участники сдают weekly по ним, руководитель собирает отчёт и отправляет своему руководителю" />;

  if (!teamId) {
    return (
      <>
        {header("Weekly команды по блокам")}
        <EmptyState title="Команда не выбрана">Выберите команду в шапке: отчёт по блокам собирается для команды, которой вы руководите.</EmptyState>
      </>
    );
  }
  if (teamId === TOP_TEAM) {
    return (
      <>
        {header("Weekly команды по блокам")}
        <EmptyState title="Отчёт этой команды это отчёт CEO" action={<Link href={`/ceo-report?week=${key}`} className={buttonClass("secondary", "sm")}>Открыть отчёт CEO</Link>}>
          Weekly команды страхования и инвестиций уже собирается по смысловым блокам на странице «Отчёт CEO».
        </EmptyState>
      </>
    );
  }

  const actor = await currentActor();
  let view: TeamReportView;
  let template: TeamTemplateView | null;
  try {
    [view, template] = await Promise.all([teamReportView(actor, teamId, key), teamTemplateView(actor, teamId).catch(() => null)]);
  } catch (error) {
    if (!(error instanceof TaskRuleError)) throw error;
    return (
      <>
        {header("Weekly команды по блокам")}
        <EmptyState title="Отчёт команды недоступен">{error.message}</EmptyState>
      </>
    );
  }
  const prev = shiftWeek(key, -1);
  const next = shiftWeek(key, 1);
  const href = (w: string) => `/weekly/team-report?team=${encodeURIComponent(view.team.id)}&week=${w}`;
  return (
    <>
      {header(`Weekly команды «${view.team.name}»`)}
      <nav aria-label="Неделя отчёта" className="mb-5 flex flex-wrap items-center gap-2">
        <Link href={href(prev)} className={buttonClass("secondary", "sm")} aria-label="Предыдущая неделя">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Неделя {weekNumberOf(prev)}
        </Link>
        <span className="px-2 text-body font-semibold text-ink">Неделя {view.weekNumber}</span>
        {next <= reporting ? (
          <Link href={href(next)} className={buttonClass("secondary", "sm")} aria-label="Следующая неделя">
            Неделя {weekNumberOf(next)}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : null}
      </nav>
      {/* Ключ и по блокам шаблона: шаблон поменяли, редактор собирается заново из новой автосборки */}
      <TeamReportScreen key={`${view.team.id}:${view.week}:${view.template?.map((b) => b.key).join(",") ?? "-"}`} view={view} template={template} />
    </>
  );
}
