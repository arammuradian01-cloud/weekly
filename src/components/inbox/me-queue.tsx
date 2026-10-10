"use client";

// «Мне» одной очередью (этап 44): не три раздела с плитками, а один список по срочности. «Срок прошёл», «Сегодня и
// завтра», «Ответить», «Прочитать», «Принятые, срок позже». В строке действие сразу: статус и состояние задачи,
// «Перенести срок», принять или отклонить просьбу, «Разобрано». Цифры под заголовком ведут к своей группе

import Link from "next/link";
import { CalendarClock } from "lucide-react";
import type { InboxItem } from "@/lib/inbox/service";
import type { RequestView } from "@/domain/requests";
import { usePrototype } from "@/domain/store";
import { formatShort, plural } from "@/domain/dates";
import { isOverdue, overdueDays } from "@/domain/rules";
import type { Task } from "@/domain/types";
import { cn } from "@/lib/cn";
import { OverdueNote } from "@/components/ui/task-badges";
import { EmptyState } from "@/components/empty-state";
import { StateSelect, StatusSelect, useTaskPermissions } from "@/components/tasks/task-fields";
import { useTaskActions } from "@/components/tasks/task-actions";
import { RequestRow } from "@/components/requests/request-list";
import { AskColleagueButton } from "@/components/requests/request-dialog";
import { InboxEvents } from "./inbox-list";
import { hotTasks, splitRequests } from "./me-tasks";

export function MeQueue({ incoming, items, snoozed }: { incoming: RequestView[]; items: InboxItem[]; snoozed: number }) {
  const { data, me } = usePrototype();
  const tasks = hotTasks(data, me);
  const req = splitRequests(incoming, data.today);
  const lateCount = tasks.late.length + req.late.length;
  const soonCount = tasks.soon.length + req.soon.length;
  const empty = !lateCount && !soonCount && !req.answer.length && !items.length && !req.later.length;

  if (empty) {
    return (
      <div>
        <EmptyState title="Всё разобрано" action={<AskColleagueButton size="sm" />}>
          Здесь появится то, что ждёт вас: просьбы коллег, задачи, которые вам поставили или передали, комментарии и упоминания, реакции, переносы сроков, ваши просроченные задачи и
          задачи со сроком сегодня или завтра.
        </EmptyState>
        {snoozed ? <p className="mt-3 text-caption text-muted">Отложено до напоминания: {snoozed}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {lateCount ? (
        <Group id="me-late" title="Срок прошёл" count={lateCount} tone="danger" testId="me-late">
          {tasks.late.map((t) => (
            <TaskRow key={t.number} task={t} />
          ))}
          {req.late.map((r) => (
            <RequestRow key={r.number} request={r} mode="incoming" />
          ))}
        </Group>
      ) : null}
      {soonCount ? (
        <Group id="me-soon" title="Сегодня и завтра" count={soonCount} tone="warning" testId="me-soon">
          {tasks.soon.map((t) => (
            <TaskRow key={t.number} task={t} />
          ))}
          {req.soon.map((r) => (
            <RequestRow key={r.number} request={r} mode="incoming" />
          ))}
        </Group>
      ) : null}
      {req.answer.length ? (
        <Group id="me-answer" title="Ответить" count={req.answer.length} hint="Просьбы коллег без ответа: примите со сроком, отклоните с причиной или сделайте своей задачей">
          {req.answer.map((r) => (
            <RequestRow key={r.number} request={r} mode="incoming" />
          ))}
        </Group>
      ) : null}
      <InboxEvents items={items} snoozed={snoozed} />
      {req.later.length ? (
        <Group id="me-later" title="Принятые, срок позже" count={req.later.length} hint="Просьбы, которые вы приняли: автор видит их в «Жду от коллег»">
          {req.later.map((r) => (
            <RequestRow key={r.number} request={r} mode="incoming" />
          ))}
        </Group>
      ) : null}
    </div>
  );
}

function Group({ id, title, count, tone, hint, testId, children }: { id: string; title: string; count: number; tone?: "danger" | "warning"; hint?: string; testId?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="sv-section !mt-0" data-testid={testId}>
      <div className="sv-section__head">
        <h2 id={id} className={cn("sv-section__title", tone === "danger" && "text-danger-ink", tone === "warning" && "text-warning-ink")}>
          {title} <span className="sv-section__count">{count}</span>
        </h2>
        {hint ? <span className="sv-section__hint">{hint}</span> : null}
      </div>
      <ul className="flex flex-col divide-y divide-line sv-card sv-card--soft">{children}</ul>
    </section>
  );
}

/** Строка моей задачи в очереди: статус и состояние меняются здесь же, срок переносится кнопкой, название ведёт в карточку */
function TaskRow({ task }: { task: Task }) {
  const { data } = usePrototype();
  const actions = useTaskActions();
  const can = useTaskPermissions(task);
  const late = isOverdue(task, data.today) || task.due < data.today;
  return (
    <li className={cn("flex flex-col gap-2 px-4 py-3", late && "bg-[var(--color-row-overdue)]")}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <Link href={`/tasks/${task.number}`} className="text-body font-semibold leading-snug text-ink hover:text-link">
          <span className="mr-1.5 font-normal tabular-nums text-text-secondary">{task.number}</span>
          {task.title}
        </Link>
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
            className="ml-auto inline-flex min-h-7 items-center gap-1 rounded-md text-caption font-semibold text-text-secondary hover:text-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
            Перенести срок
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** Подписи строки цифр «Мне» */
export function meFigureLabels(n: { late: number; soon: number; answer: number; events: number }) {
  return {
    late: "просрочено",
    soon: plural(n.soon, "срок сегодня или завтра", "срока сегодня или завтра", "сроков сегодня или завтра"),
    answer: plural(n.answer, "просьба ждёт ответа", "просьбы ждут ответа", "просьб ждут ответа"),
    events: plural(n.events, "событие", "события", "событий"),
  };
}
