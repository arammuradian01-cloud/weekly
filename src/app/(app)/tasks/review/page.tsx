import type { Metadata } from "next";
import { Suspense } from "react";
import { TasksHeader } from "@/components/tasks/tasks-header";
import { TasksNav } from "@/components/tasks/tasks-nav";
import { MeetingReview } from "@/components/tasks/meeting-review";
import { TaskDrawer } from "@/components/tasks/task-drawer";

export const metadata: Metadata = { title: "Разбор на встрече" };

export default function ReviewPage() {
  return (
    <>
      <TasksHeader />
      <TasksNav />
      <Suspense>
        <MeetingReview />
        <TaskDrawer />
      </Suspense>
    </>
  );
}
