import type { Metadata } from "next";
import { Suspense } from "react";
import { TasksHeader } from "@/components/tasks/tasks-header";
import { TasksNav } from "@/components/tasks/tasks-nav";
import { TaskList } from "@/components/tasks/task-list";
import { TaskDrawer } from "@/components/tasks/task-drawer";

export const metadata: Metadata = { title: "Задачи" };

export default function TasksPage() {
  return (
    <>
      <TasksHeader />
      <TasksNav />
      <Suspense>
        <TaskList />
        <TaskDrawer />
      </Suspense>
    </>
  );
}
