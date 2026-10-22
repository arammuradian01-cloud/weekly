import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth";
import { teamPanel } from "@/lib/org/panel";
import { ALL_TEAMS, currentTeam, subjectOf } from "@/lib/org/current";
import { Section } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { MyTeams } from "@/components/teams/my-teams";

export const metadata: Metadata = { title: "Люди: руководителю" };

/** Панель руководителя (этап 16): что с задачами и weekly его людей, переход вниз по командам */
export default async function MyTeamsPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const ctx = await requireContext();
  const { team } = await searchParams;
  const subject = subjectOf(ctx);
  const scope = await currentTeam(subject);
  // Панель открыта руководителям команд, владельцу и администраторам, под общим логином тоже (видят топ-команду)
  const leader = scope.scope.leads.length > 0 || ctx.person.role === "OWNER" || ctx.person.role === "ADMIN";
  if (!leader) {
    return (
      <Section title="Руководителю" hint="Что в работе, что просрочено и что застряло у людей команды">
        <EmptyState title="Панель открыта руководителям команд">Здесь руководитель видит задачи и weekly своих людей и команд ниже. Остальным доступны вкладки «Команда» и «Структура».</EmptyState>
      </Section>
    );
  }
  const current = team ? null : scope;
  // Без выбора: команда из переключателя, если человек ею руководит, иначе первая своя команда
  const wanted = team ?? (current?.id && current.id !== ALL_TEAMS && current.scope.leads.includes(current.id) ? current.id : null);
  const panel = await teamPanel({ ...subject, management: !!ctx.management }, wanted);
  return (
    <Section
      title="Руководителю"
      hint="Что в работе, просрочено и застряло, у кого сдан weekly"
      actions={
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <Link href="/tasks/changes" className="inline-flex h-10 items-center text-body font-medium text-blue-700 hover:underline">
            Изменилось за неделю
          </Link>
          <Link href="/goals" className="inline-flex h-10 items-center text-body font-medium text-blue-700 hover:underline">
            Цели
          </Link>
        </div>
      }
    >
      {panel ? (
        <MyTeams panel={panel} />
      ) : (
        <EmptyState title="Вы пока не в команде">Команды появятся, когда владелец загрузит структуру или добавит вас в команду.</EmptyState>
      )}
    </Section>
  );
}
