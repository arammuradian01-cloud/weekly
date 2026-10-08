import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth";
import { teamPanel } from "@/lib/org/panel";
import { ALL_TEAMS, currentTeam, subjectOf } from "@/lib/org/current";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { MyTeams } from "@/components/teams/my-teams";

export const metadata: Metadata = { title: "Мои команды" };

/** Панель руководителя (этап 16): что с задачами и weekly его людей, переход вниз по командам */
export default async function MyTeamsPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const ctx = await requireContext();
  const { team } = await searchParams;
  const subject = subjectOf(ctx);
  const current = team ? null : await currentTeam(subject);
  // Без выбора: команда из переключателя, если человек ею руководит, иначе первая своя команда
  const wanted = team ?? (current?.id && current.id !== ALL_TEAMS && current.scope.leads.includes(current.id) ? current.id : null);
  const panel = await teamPanel({ ...subject, management: !!ctx.management }, wanted);
  return (
    <>
      <PageHeader title="Мои команды" description="Что в работе, что просрочено и что застряло у ваших людей, и кто сдал weekly">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <Link href="/tasks/changes" className="inline-flex h-10 items-center text-body font-medium text-blue-700 hover:underline">
            Изменилось за неделю
          </Link>
          <Link href={panel ? `/analytics?team=${panel.team.id}` : "/analytics"} className="inline-flex h-10 items-center text-body font-medium text-blue-700 hover:underline">
            Аналитика
          </Link>
          <Link href="/goals" className="inline-flex h-10 items-center text-body font-medium text-blue-700 hover:underline">
            Цели
          </Link>
          <Link href="/team" className="inline-flex h-10 items-center text-body font-medium text-blue-700 hover:underline">
            Сводка команды
          </Link>
        </div>
      </PageHeader>
      {panel ? (
        <MyTeams panel={panel} />
      ) : (
        <EmptyState title="Вы пока не в команде">Команды появятся, когда владелец загрузит структуру или добавит вас в команду.</EmptyState>
      )}
    </>
  );
}
