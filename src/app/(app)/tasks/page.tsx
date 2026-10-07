import type { Metadata } from "next";
import { Suspense } from "react";
import { requireContext } from "@/lib/auth";
import { listViews } from "@/lib/views/service";
import { TasksHeader } from "@/components/tasks/tasks-header";
import { TasksNav } from "@/components/tasks/tasks-nav";
import { TaskList } from "@/components/tasks/task-list";
import { TaskDrawer } from "@/components/tasks/task-drawer";

export const metadata: Metadata = { title: "Задачи" };

export default async function TasksPage() {
  const ctx = await requireContext();
  // Сохранённые виды (этап 25): личные, при общем логине их нет
  const views = ctx.via === "TEAM" && !ctx.management ? [] : await listViews(ctx.person.id, "/tasks");
  return (
    <>
      <TasksHeader />
      <TasksNav />
      <Suspense>
        <TaskList views={views} />
        <TaskDrawer />
      </Suspense>
    </>
  );
}
