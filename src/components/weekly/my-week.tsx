"use client";

import Link from "next/link";
import type { RequestView } from "@/domain/requests";
import { NoRequests, RequestList } from "@/components/requests/request-list";
import { AskColleagueButton } from "@/components/requests/request-dialog";
import { MessageSquare } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { compactName } from "@/domain/people";
import { diffDays, formatShort } from "@/domain/dates";
import { isDueThisWeek, isMine, isOverdue, myTasksOrder, overdueDays } from "@/domain/rules";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button";
import { OverdueNote, StateDot, StatusBadge, WeeklyBadge } from "@/components/ui/task-badges";
import { EmptyState } from "@/components/empty-state";
import { useOpenTask } from "@/components/tasks/task-drawer";
import { SubmissionStrip } from "./submission-strip";
import { AbsentBadge, substituteText } from "./absence";
import { submittedText } from "./weekly-feed";
import type { PersonWeekly } from "@/domain/types";

/** Стартовый экран: мой weekly и срок, мои просроченные и срочные задачи, новые комментарии (раздел 7 ТЗ) */
export function MyWeek({
  deadlineText,
  timeLeft,
  late,
  weekNumber,
  report,
  entriesCount,
  team,
  requests,
}: {
  deadlineText: string;
  timeLeft: string;
  late: boolean;
  weekNumber: number;
  report: PersonWeekly;
  entriesCount: number;
  /** Кто сдал: только в режиме управления */
  team: PersonWeekly[] | null;
  /** Просьбы ко мне и «Жду от коллег» (этап 21) */
  requests: { incoming: RequestView[]; outgoing: RequestView[] };
}) {
  const { data, me } = usePrototype();
  const { open } = useOpenTask();
  const weekly = report;
  const state = report.state;
  const mine = data.tasks.filter((t) => isMine(t, me.slug, me.role) && !t.archived);
  const urgent = myTasksOrder(mine.filter((t) => isOverdue(t, data.today) || isDueThisWeek(t, data.today)), data.today);
  const comments = mine
    .flatMap((t) => t.comments.filter((c) => c.author !== me.slug && diffDays(c.at, data.today) <= 7).map((c) => ({ task: t, comment: c })))
    .sort((a, b) => (a.comment.at + a.comment.time < b.comment.at + b.comment.time ? 1 : -1));
  const submitted = state === "submitted" || state === "late";

  return (
    <>
      <section aria-labelledby="my-weekly" className="rounded-xl bg-surface p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="my-weekly" className="text-title font-semibold text-ink">
                Мой weekly за неделю {weekNumber}
              </h2>
              {weekly.absent && !submitted ? <AbsentBadge /> : <WeeklyBadge state={state} />}
            </div>
            {weekly.absent && !submitted ? (
              <p className="mt-1.5 text-body text-muted">
                На этой неделе вас нет, {substituteText(weekly.absent.substitute)}. Weekly не ждём, но сдать его можно, опозданием это не будет.
              </p>
            ) : (
              <p className="mt-1.5 text-body text-muted">
                {submitted
                  ? `${weekly.submittedAt ? submittedText(weekly.submittedAt).replace(/^с/, "С") : state === "late" ? "Сдан с опозданием" : "Сдан"}. Записей: ${entriesCount}. Правки до закрытия недели разрешены.`
                  : `Срок: ${deadlineText}. ${late ? "Срок прошёл." : `Осталось ${timeLeft}.`}${state === "draft" ? ` В черновике записей: ${entriesCount}.` : ""}`}
              </p>
            )}
          </div>
          <Link href="/weekly/submit" className={cn(buttonClass(submitted ? "secondary" : "primary"), "shrink-0")}>
            {submitted ? "Открыть мой weekly" : state === "draft" ? "Продолжить weekly" : "Сдать weekly"}
          </Link>
        </div>
      </section>

      {team ? <SubmissionStrip reports={team} className="mt-4" /> : null}

      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="my-tasks">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="my-tasks" className="text-title font-semibold text-ink">
              Просроченные и срочные <span className="font-normal text-muted">{urgent.length}</span>
            </h2>
            <Link href="/tasks/mine" className="text-body font-medium text-blue-700 hover:underline">
              Все мои задачи
            </Link>
          </div>
          {urgent.length === 0 ? (
            <EmptyState title="Срочного нет">Просроченных задач и задач со сроком на этой неделе нет.</EmptyState>
          ) : (
            <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
              {urgent.map((t) => {
                const overdue = isOverdue(t, data.today);
                return (
                  <li key={t.number} className={cn("px-4 py-3", overdue && "bg-danger-soft")}>
                    <button type="button" onClick={() => open(t.number)} className="text-left text-body font-medium leading-snug text-ink hover:text-blue-700 hover:underline">
                      <span className="mr-1.5 font-normal tabular-nums text-muted">{t.number}</span>
                      {t.title}
                    </button>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <StatusBadge status={t.status} />
                      <StateDot state={t.state} />
                      <span className={cn("text-caption tabular-nums", overdue ? "font-semibold text-danger-ink" : "text-muted")}>срок {formatShort(t.due)}</span>
                      {overdue ? <OverdueNote days={overdueDays(t, data.today)} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="my-comments">
          <h2 id="my-comments" className="mb-3 text-title font-semibold text-ink">
            Новые комментарии <span className="font-normal text-muted">{comments.length}</span>
          </h2>
          {comments.length === 0 ? (
            <EmptyState title="Новых комментариев нет">Здесь появятся комментарии коллег к вашим задачам.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {comments.map(({ task, comment }) => (
                <li key={comment.id} className="rounded-xl px-4 py-3 ring-1 ring-line">
                  <p className="flex items-center gap-2 text-caption text-muted">
                    <MessageSquare className="h-4 w-4" aria-hidden="true" />
                    <span className="font-semibold text-ink">{compactName(comment.author)}</span>
                    {formatShort(comment.at)}, {comment.time}
                  </p>
                  <p className="mt-1 text-body leading-relaxed text-ink">{comment.text}</p>
                  <button type="button" onClick={() => open(task.number)} className="mt-1 text-left text-small font-medium text-blue-700 hover:underline">
                    Задача {task.number}: {task.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-10 grid gap-8 xl:grid-cols-2">
        <RequestList
          id="my-incoming"
          title="Просьбы ко мне"
          mode="incoming"
          items={requests.incoming.slice(0, 5)}
          action={
            requests.incoming.length > 5 ? (
              <Link href="/me" className="text-body font-medium text-blue-700 hover:underline">
                Все {requests.incoming.length}
              </Link>
            ) : undefined
          }
          empty={<NoRequests title="Просьб к вам нет">Просьбы коллег появятся здесь и в «Мне».</NoRequests>}
        />
        <RequestList
          id="my-waiting"
          title="Жду от коллег"
          mode="outgoing"
          items={requests.outgoing}
          action={<AskColleagueButton size="sm" />}
          empty={<NoRequests title="Вы ничего не ждёте">Попросите коллегу о помощи: адресат увидит просьбу в «Мне», а ответ и срок появятся здесь.</NoRequests>}
        />
      </div>
    </>
  );
}
