import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { RoadmapBoard } from "@/components/roadmap/roadmap-board";
import { TaskDrawer } from "@/components/tasks/task-drawer";

export const metadata: Metadata = { title: "Roadmap" };

/** Roadmap (этап 56): задачи команды или человека по направлениям и срокам. Этап 68: карта сроков полосами, доска вторым видом */
export default function RoadmapPage() {
  return (
    <>
      <PageHeader title="Roadmap" description="Открытые задачи команды или человека по срокам" />
      <Suspense>
        <RoadmapBoard />
        <TaskDrawer />
      </Suspense>
    </>
  );
}
