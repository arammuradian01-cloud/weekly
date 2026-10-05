"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { EmptyState } from "@/components/empty-state";
import { TaskCard } from "./task-card";

export function TaskPage({ number }: { number: number }) {
  const { data } = usePrototype();
  const task = data.tasks.find((t) => t.number === number);
  return (
    <div className="mx-auto max-w-[760px]">
      <Link href="/tasks" className="-ml-2 mb-4 inline-flex h-10 items-center gap-1 rounded-lg px-2 text-[15px] text-blue-700 hover:bg-surface">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Все задачи
      </Link>
      {task ? (
        <>
          <h1 className="mb-6 text-[24px] font-semibold leading-tight text-ink sm:text-[28px]">
            <span className="mr-2 font-normal tabular-nums text-muted">{task.number}</span>
            {task.title}
          </h1>
          <TaskCard key={`${task.number}-${task.where}`} task={task} standalone />
        </>
      ) : (
        <EmptyState title={`Задачи ${number} нет`}>Проверьте номер. Удалённые задачи лежат в архиве, вернуть их может владелец.</EmptyState>
      )}
    </div>
  );
}
