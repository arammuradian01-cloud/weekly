"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { usePrototype } from "@/prototype/store";
import { ownerName } from "@/prototype/people";
import { STATUSES, type StatusCode } from "@/prototype/dictionaries";
import { formatShort } from "@/prototype/dates";
import { defaultOrder, isOverdue, overdueDays, permissions } from "@/prototype/rules";
import type { Task } from "@/prototype/types";
import { cn } from "@/lib/cn";
import { OverdueNote, PriorityTag, StateDot, StatusBadge } from "@/components/ui/task-badges";
import { Chip } from "@/components/ui/primitives";
import { useTaskActions } from "./task-actions";
import { useOpenTask } from "./task-drawer";

function CardBody({ task, today }: { task: Task; today: string }) {
  const overdue = isOverdue(task, today);
  return (
    <>
      <p className="text-[15px] font-medium leading-snug text-ink">
        <span className="mr-1.5 font-normal tabular-nums text-muted">{task.number}</span>
        {task.title}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <PriorityTag priority={task.priority} className="text-[13px]" />
        <StateDot state={task.state} className="text-[13px]" />
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
        <span>{ownerName(task.owner, true)}</span>
        <span className={cn("tabular-nums", overdue && "font-semibold text-danger-ink")}>
          {task.closedAt ? `закрыта ${formatShort(task.closedAt)}` : `до ${formatShort(task.due)}`}
        </span>
        {overdue ? <OverdueNote days={overdueDays(task, today)} /> : null}
      </p>
    </>
  );
}

function BoardCard({ task, today, onOpen, canMove }: { task: Task; today: string; onOpen: () => void; canMove: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.number, disabled: !canMove });
  const overdue = isOverdue(task, today);
  return (
    <li>
      <div
        ref={setNodeRef}
        className={cn(
          "rounded-lg border bg-white p-3 transition-shadow",
          overdue ? "border-l-4 border-[#f3c4c6] border-l-danger bg-danger-soft" : "border-line",
          canMove && "cursor-grab active:cursor-grabbing",
          isDragging && "opacity-40",
        )}
        {...attributes}
        {...listeners}
        role="button"
        aria-roledescription={canMove ? "перетаскиваемая карточка" : "карточка"}
        aria-label={`Задача ${task.number}: ${task.title}`}
        onClick={onOpen}
        onKeyDown={(e) => {
          listeners?.onKeyDown?.(e);
          if (e.key === "Enter" && !e.defaultPrevented) onOpen();
        }}
      >
        <CardBody task={task} today={today} />
      </div>
    </li>
  );
}

function Column({ status, tasks, children }: { status: StatusCode; tasks: Task[]; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${STATUSES.find((s) => s.code === status)!.label}: ${tasks.length}`}
      className={cn("flex w-[280px] shrink-0 snap-start flex-col rounded-xl bg-surface p-2 transition-colors xl:w-auto xl:min-w-[240px] xl:flex-1", isOver && "bg-blue-soft ring-2 ring-blue")}
    >
      <header className="flex items-center justify-between px-1.5 pb-2 pt-1">
        <StatusBadge status={status} />
        <span className="text-[13px] tabular-nums text-muted">{tasks.length}</span>
      </header>
      <ul className="flex min-h-24 flex-col gap-2">{children}</ul>
    </section>
  );
}

export function TaskBoard() {
  const { data, me, manage, notify } = usePrototype();
  const actions = useTaskActions();
  const { open } = useOpenTask();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const tasks = defaultOrder(
    data.tasks.filter((t) => !t.archived && (!onlyMine || t.owner === me.slug || t.coExecutors.includes(me.slug))),
    data.today,
  );
  // «Не выполнена» и «Отменена» нужны редко: по умолчанию четыре колонки помещаются на ноутбуке без прокрутки
  const columns = STATUSES.filter((s) => showClosed || !["failed", "cancelled"].includes(s.code));
  const active = activeId ? data.tasks.find((t) => t.number === activeId) : undefined;

  const onDragStart = (e: DragStartEvent) => setActiveId(Number(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const task = data.tasks.find((t) => t.number === Number(e.active.id));
    const next = e.over?.id as StatusCode | undefined;
    if (!task || !next || next === task.status) return;
    if (next === "proposed") return notify("В «Предложена» задачу переносит только система");
    actions.changeStatus(task, next);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Chip active={onlyMine} onClick={() => setOnlyMine((v) => !v)}>
          Только мои
        </Chip>
        <Chip active={showClosed} onClick={() => setShowClosed((v) => !v)}>
          Не выполненные и отменённые
        </Chip>
        <p className="text-[14px] text-muted">Перетащите карточку в другую колонку, чтобы сменить статус. На телефоне подержите карточку.</p>
      </div>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
          {columns.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.code);
            return (
              <Column key={col.code} status={col.code} tasks={colTasks}>
                {colTasks.map((t) => (
                  <BoardCard key={t.number} task={t} today={data.today} onOpen={() => open(t.number)} canMove={permissions(t, me.slug, manage).status} />
                ))}
              </Column>
            );
          })}
        </div>
        <DragOverlay>
          {active ? (
            <div className="w-[264px] rotate-2 rounded-lg border border-line bg-white p-3 shadow-[0_16px_40px_-16px_rgba(0,42,58,0.5)]">
              <CardBody task={active} today={data.today} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
