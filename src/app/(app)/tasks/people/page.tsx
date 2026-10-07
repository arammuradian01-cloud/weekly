import type { Metadata } from "next";
import { Suspense } from "react";
import { TasksHeader } from "@/components/tasks/tasks-header";
import { TasksNav } from "@/components/tasks/tasks-nav";
import { TaskPeople } from "@/components/tasks/task-people";
import { TaskDrawer } from "@/components/tasks/task-drawer";

export const metadata: Metadata = { title: "Задачи по людям" };

export default function TaskPeoplePage() {
  return (
    <>
      <TasksHeader />
      <TasksNav />
      <Suspense>
        <TaskPeople />
        <TaskDrawer />
      </Suspense>
    </>
  );
}
