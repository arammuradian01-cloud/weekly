import type { Metadata } from "next";
import { Suspense } from "react";
import { requireContext } from "@/lib/auth";
import { ALL_TEAMS, currentTeam, subjectOf } from "@/lib/org/current";
import { recentChanges } from "@/lib/tasks/changes";
import { TasksHeader } from "@/components/tasks/tasks-header";
import { TasksNav } from "@/components/tasks/tasks-nav";
import { TaskChanges } from "@/components/tasks/task-changes";
import { TaskDrawer } from "@/components/tasks/task-drawer";

export const metadata: Metadata = { title: "Изменилось за неделю" };

/** Изменилось за неделю (этап 16): новые, закрытые, перенесённые и сменившие статус задачи выбранной команды */
export default async function TaskChangesPage() {
  const ctx = await requireContext();
  const subject = subjectOf(ctx);
  const team = await currentTeam(subject);
  const teamIds = team.id === ALL_TEAMS ? null : team.id ? [team.id] : [];
  const { since, changes } = await recentChanges({ personId: ctx.person.id, role: ctx.person.role, limited: subject.limited, management: !!ctx.management }, teamIds);
  return (
    <>
      <TasksHeader />
      <TasksNav />
      <Suspense>
        <TaskChanges since={since} changes={changes} />
        <TaskDrawer />
      </Suspense>
    </>
  );
}
