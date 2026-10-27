import type { Metadata } from "next";
import { Suspense } from "react";
import { requireContext } from "@/lib/auth";
import { ALL_TEAMS, currentTeam, subjectOf } from "@/lib/org/current";
import { roadmapGoals } from "@/lib/goals/roadmap";
import { groupByOf } from "@/lib/tasks/roadmap-goals";
import { PageHeader } from "@/components/page-header";
import { RoadmapBoard } from "@/components/roadmap/roadmap-board";
import { TaskDrawer } from "@/components/tasks/task-drawer";

export const metadata: Metadata = { title: "Roadmap" };

/**
 * Roadmap (этап 56): задачи команды или человека по направлениям и срокам. Этап 68: карта сроков полосами, доска вторым
 * видом. Этап 77: группировка по целям и по целям и задачам вместе (?group=goals|both): цели квартала команды берутся
 * с сервера только для этих группировок, «По задачам» строится из задач на экране, как раньше
 */
export default async function RoadmapPage({ searchParams }: { searchParams: Promise<{ group?: string | string[] }> }) {
  const params = await searchParams;
  const group = groupByOf(Array.isArray(params.group) ? params.group[0] : params.group);
  let goals: Awaited<ReturnType<typeof roadmapGoals>> | null = null;
  if (group !== "tasks") {
    const ctx = await requireContext();
    const subject = subjectOf(ctx);
    const team = await currentTeam(subject);
    const single = team.id && team.id !== ALL_TEAMS ? team.id : null;
    // Свои цели: выбранной команды; в «Все мои команды» всех команд из переключателя
    const own = team.id === ALL_TEAMS ? team.options.map((o) => o.id) : single ? [single] : [];
    goals = await roadmapGoals({ personId: ctx.person.id, role: ctx.person.role, management: ctx.management?.role ?? null, limited: subject.limited }, { team: single, own });
  }
  return (
    <>
      <PageHeader title="Roadmap" description="Открытые задачи команды или человека по срокам" />
      <Suspense>
        <RoadmapBoard goals={goals} />
        <TaskDrawer />
      </Suspense>
    </>
  );
}
