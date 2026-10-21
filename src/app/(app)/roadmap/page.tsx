import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { RoadmapBoard } from "@/components/roadmap/roadmap-board";
import { TaskDrawer } from "@/components/tasks/task-drawer";

export const metadata: Metadata = { title: "Roadmap" };

/** Roadmap (этап 56): задачи команды или человека по направлениям и срокам, важные со звёздочками */
export default function RoadmapPage() {
  return (
    <>
      <PageHeader title="Roadmap" description="Что предстоит команде или человеку: открытые задачи по направлениям и месяцам. Звёздочки отмечают важные задачи" />
      <Suspense>
        <RoadmapBoard />
        <TaskDrawer />
      </Suspense>
    </>
  );
}
