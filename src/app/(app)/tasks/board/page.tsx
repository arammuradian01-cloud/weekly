import type { Metadata } from "next";
import { Suspense } from "react";
import { TasksHeader } from "@/components/tasks/tasks-header";
import { TasksNav } from "@/components/tasks/tasks-nav";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskDrawer } from "@/components/tasks/task-drawer";

export const metadata: Metadata = { title: "Доска задач" };

export default function BoardPage() {
  return (
    <>
      <TasksHeader />
      <TasksNav />
      <Suspense>
        <TaskBoard />
        <TaskDrawer />
      </Suspense>
    </>
  );
}
