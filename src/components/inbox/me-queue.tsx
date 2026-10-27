"use client";

// Очередь «Ждёт вас» (этап 44 как раздел «Мне», с этапа 76 блок на «Моей неделе»): один список по срочности.
// «Срок прошёл», «Сегодня и завтра», «Ответить», «Прочитать», «Принятые, срок позже». В строке действие сразу: статус
// и состояние задачи (пустое состояние на ноутбуке по наведению, на планшете и телефоне только в карточке), «Перенести
// срок», принять или отклонить просьбу, «Разобрано», «Напомнить». Счётчики над очередью ведут якорем к своей группе.
// Этап 76: в группе пять строк, остальные по кнопке «Показать все»: очередь живёт на главной рядом с weekly и встречей

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import type { InboxItem } from "@/lib/inbox/service";
import type { RequestView } from "@/domain/requests";
import { usePrototype } from "@/domain/store";
import { formatShort } from "@/domain/dates";
import { isOverdue, overdueDays } from "@/domain/rules";
import type { Task } from "@/domain/types";
import { cn } from "@/lib/cn";
import { OverdueNote } from "@/components/ui/task-badges";
import { EmptyState } from "@/components/empty-state";
import { StateSelect, StatusSelect, useTaskPermissions } from "@/components/tasks/task-fields";
import { useTaskActions } from "@/components/tasks/task-actions";
import { useOpenTask } from "@/components/tasks/task-drawer";
import { RequestRow } from "@/components/requests/request-list";
import { InboxEvents } from "./inbox-list";
import { QUEUE_GROUPS, QUEUE_GROUP_LIMIT, hotTasks, splitRequests } from "./me-tasks";
import { GroupTitle, ShowAll, type GroupTone } from "./queue-parts";

export function MeQueue({ incoming, items, snoozed, missed = 0 }: { incoming: RequestView[]; items: InboxItem[]; snoozed: number; /** Несданные weekly за прошлые недели: строка о них стоит выше блока, пустое состояние о них помнит */ missed?: number }) {
  const { data, me } = usePrototype();
  const tasks = hotTasks(data, me);
  const req = splitRequests(incoming, data.today);
  const late = [...tasks.late.map((t) => <TaskRow key={`t${t.number}`} task={t} />), ...req.late.map((r) => <RequestRow key={`r${r.number}`} request={r} mode="incoming" />)];
  const soon = [...tasks.soon.map((t) => <TaskRow key={`t${t.number}`} task={t} />), ...req.soon.map((r) => <RequestRow key={`r${r.number}`} request={r} mode="incoming" />)];
  const answer = req.answer.map((r) => <RequestRow key={`r${r.number}`} request={r} mode="incoming" />);
  const later = req.later.map((r) => <RequestRow key={`r${r.number}`} request={r} mode="incoming" />);
  const empty = !late.length && !soon.length && !answer.length && !items.length && !later.length;

  if (empty) {
    return (
      <div>
        {/* Несданный weekly ждёт человека строкой выше, поэтому «ничего срочного нет» здесь было бы неправдой */}
        {missed ? (
          <EmptyState title="Очередь пуста">
            Просроченных и срочных задач, просьб без ответа и новых событий нет. Остался несданный weekly за прошлую неделю: строка о нём выше.
          </EmptyState>
        ) : (
          <EmptyState title="Всё разобрано" tone="success">
            Просроченных и срочных задач, просьб без ответа и новых событий нет. Новые появятся здесь.
          </EmptyState>
        )}
        {snoozed ? <p className="mt-3 text-caption text-muted">Отложено до напоминания: {snoozed}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {late.length ? <Group id={QUEUE_GROUPS.late} title="Срок прошёл" rows={late} tone="danger" testId="me-late" /> : null}
      {soon.length ? <Group id={QUEUE_GROUPS.soon} title="Сегодня и завтра" rows={soon} tone="warning" testId="me-soon" /> : null}
      {answer.length ? <Group id={QUEUE_GROUPS.answer} title="Ответить" rows={answer} tone="info" hint="Примите со сроком, отклоните с причиной или сделайте задачей" testId="me-answer" /> : null}
      {items.length ? <InboxEvents items={items} /> : null}
      {later.length ? <Group id={QUEUE_GROUPS.later} title="Принятые, срок позже" rows={later} hint="Автор видит их в «Жду от коллег»" testId="me-later" /> : null}
      {snoozed ? <p className="text-caption text-muted">Отложено до напоминания: {snoozed}</p> : null}
    </div>
  );
}

function Group({ id, title, rows, tone, hint, testId }: { id: string; title: string; rows: React.ReactNode[]; tone?: GroupTone; hint?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, QUEUE_GROUP_LIMIT);
  return (
    <section aria-labelledby={id} className="flex flex-col" data-testid={testId}>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <GroupTitle id={id} tone={tone} count={rows.length}>
          {title}
        </GroupTitle>
        {hint ? <span className="sv-section__hint hidden truncate text-small lg:inline">{hint}</span> : null}
      </div>
      <ul id={`${id}-list`} className={cn("sv-queue flex flex-col divide-y divide-line sv-card sv-card--soft", tone === "danger" && "border-danger-ink/30")}>
        {shown}
      </ul>
      <ShowAll total={rows.length} open={open} onToggle={() => setOpen((o) => !o)} controls={`${id}-list`} label={title} />
    </section>
  );
}

/** Строка моей задачи в очереди: статус и состояние меняются здесь же, срок переносится кнопкой, название открывает карточку сбоку */
function TaskRow({ task }: { task: Task }) {
  const { data } = usePrototype();
  const actions = useTaskActions();
  const can = useTaskPermissions(task);
  const { open } = useOpenTask();
  const late = isOverdue(task, data.today) || task.due < data.today;
  return (
    <li className={cn("flex flex-col gap-2 px-4 py-3", late && "bg-[var(--color-row-overdue)]")}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <button type="button" onClick={() => open(task.number)} className="text-left text-body font-semibold leading-snug text-ink hover:text-link">
          <span className="mr-1.5 font-normal tabular-nums text-text-secondary">{task.number}</span>
          {task.title}
        </button>
        <span className="flex shrink-0 items-center gap-2 text-caption">
          <span className={cn("tabular-nums", late ? "font-semibold text-danger-ink" : "text-muted")}>срок {formatShort(task.due)}</span>
          {late ? <OverdueNote days={overdueDays(task, data.today)} /> : <span className="sv-due sv-due--soon">{task.due === data.today ? "сегодня" : "завтра"}</span>}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <StatusSelect task={task} subject={`задачи ${task.number}`} />
        <StateSelect task={task} subject={`задачи ${task.number}`} set />
        {can.due ? (
          <button
            type="button"
            onClick={() => actions.transfer(task)}
            aria-label={`Перенести срок задачи ${task.number}`}
            className="sv-row-action ml-auto text-caption font-semibold text-text-secondary hover:text-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
            Перенести срок
          </button>
        ) : null}
      </div>
    </li>
  );
}
