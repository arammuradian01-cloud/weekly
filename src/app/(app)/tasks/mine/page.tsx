import type { Metadata } from "next";
import { Suspense } from "react";
import { TasksHeader } from "@/components/tasks/tasks-header";
import { TasksNav } from "@/components/tasks/tasks-nav";
import { MyTasks } from "@/components/tasks/my-tasks";
import { TaskDrawer } from "@/components/tasks/task-drawer";

export const metadata: Metadata = { title: "Мои задачи" };

export default function MyTasksPage() {
  return (
    <>
      <TasksHeader />
      <TasksNav />
      <Suspense>
        <MyTasks />
        <TaskDrawer />
      </Suspense>
    </>
  );
}
