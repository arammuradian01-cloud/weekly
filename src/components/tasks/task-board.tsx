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
import { usePrototype } from "@/domain/store";
import { ownerName } from "@/domain/people";
import { STATUSES, type StatusCode } from "@/domain/dictionaries";
import { formatShort } from "@/domain/dates";
import { defaultOrder, isOverdue, overdueDays, permissions } from "@/lib/tasks/rules";
import { useViewer } from "./task-fields";
import type { Task } from "@/domain/types";
import { cn } from "@/lib/cn";
import { OverdueNote, PriorityTag, StateDot, StatusBadge } from "@/components/ui/task-badges";
import { Chip } from "@/components/ui/primitives";
import { useTaskActions } from "./task-actions";
import { useOpenTask } from "./task-drawer";

function CardBody({ task, today }: { task: Task; today: string }) {
  const overdue = isOverdue(task, today);
  return (
    <>
      <p className="text-body font-semibold leading-snug text-ink">
        <span className="mr-1.5 font-normal tabular-nums text-muted">{task.number}</span>
        {task.title}
      </p>
      {/* «Не задан» на доске только шумит: из таблицы задачи приходят без приоритета и состояния */}
      {task.priority !== "unset" || task.state !== "unset" ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {task.priority !== "unset" ? <PriorityTag priority={task.priority} className="text-caption" /> : null}
          {task.state !== "unset" ? <StateDot state={task.state} className="text-caption" /> : null}
        </div>
      ) : null}
      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-caption text-muted">
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
          "sv-card-task select-none",
          overdue && "!bg-[var(--color-row-overdue)]",
          !canMove && "!cursor-pointer",
          isDragging && "is-placeholder",
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
        {overdue ? <span className="sv-card-task__stripe bg-danger" aria-hidden="true" /> : task.state === "at-risk" ? <span className="sv-card-task__stripe sv-card-task__stripe--risk" aria-hidden="true" /> : null}
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
      className={cn("sv-board__col w-[280px] shrink-0 snap-start xl:w-auto xl:min-w-[240px] xl:flex-1", isOver && "is-over")}
    >
      <header className="sv-board__head">
        <StatusBadge status={status} />
        <span className="sv-counter sv-counter--neutral">{tasks.length}</span>
      </header>
      <ul className="flex min-h-24 flex-col gap-2">{children}</ul>
    </section>
  );
}

export function TaskBoard() {
  const { data, me, notify } = usePrototype();
  const viewer = useViewer();
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
    data.teamTasks.filter((t) => !t.archived && (!onlyMine || t.owner === me.slug || t.coExecutors.includes(me.slug))),
    data.today,
  );
  // «Частично», «Не выполнена» и «Отменена» нужны редко: по умолчанию четыре колонки помещаются на ноутбуке без прокрутки
  const columns = STATUSES.filter((s) => showClosed || !["partial", "failed", "cancelled"].includes(s.code));
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
        <p className="text-small text-muted">Перетащите карточку в другую колонку, чтобы сменить статус. На телефоне подержите карточку.</p>
      </div>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
          {columns.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.code);
            return (
              <Column key={col.code} status={col.code} tasks={colTasks}>
                {colTasks.map((t) => (
                  <BoardCard key={t.number} task={t} today={data.today} onOpen={() => open(t.number)} canMove={t.status === "proposed" ? permissions(t, viewer).confirm : permissions(t, viewer).status} />
                ))}
              </Column>
            );
          })}
        </div>
        <DragOverlay>
          {active ? (
            <div className="sv-card-task is-dragging w-[264px]">
              <CardBody task={active} today={data.today} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
