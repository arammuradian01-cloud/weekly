"use client";

import Link from "next/link";
import type { RequestView } from "@/domain/requests";
import { NoRequests, RequestList } from "@/components/requests/request-list";
import { AskColleagueButton } from "@/components/requests/request-dialog";
import { CircleAlert, FileText, Hand, Inbox, MessageSquare, Presentation } from "lucide-react";
import { Tile, Tiles } from "@/components/ui/tile";
import { useInboxCount } from "@/components/inbox/inbox-count";
import { plural } from "@/domain/dates";
import { usePrototype } from "@/domain/store";
import { compactName } from "@/domain/people";
import { diffDays, formatShort } from "@/domain/dates";
import { isClosed, isDueThisWeek, isMine, isOverdue, myTasksOrder, overdueDays } from "@/domain/rules";
import { cn } from "@/lib/cn";
import { OverdueNote, StateDot, StatusBadge, WeeklyBadge } from "@/components/ui/task-badges";
import { EmptyState } from "@/components/empty-state";
import { useOpenTask } from "@/components/tasks/task-drawer";
import { SubmissionStrip } from "./submission-strip";
import { AbsentBadge, substituteText } from "./absence";
import { submittedText } from "./weekly-feed";
import type { PersonWeekly } from "@/domain/types";
import type { PromiseHistory } from "@/lib/weekly/promise-service";
import { PromiseStats } from "./promise-stats";

/** Стартовый экран: мой weekly и срок, мои просроченные и срочные задачи, новые комментарии (раздел 7 ТЗ) */
export function MyWeek({
  timeLeft,
  late,
  weekNumber,
  report,
  entriesCount,
  team,
  requests,
  promiseStats,
  meetingText,
}: {
  /** Срок словами: показывается в заголовке страницы */
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
  /** «Обещал и сделал» за 8 недель (этап 22): видит только сам человек */
  promiseStats?: PromiseHistory;
  /** «Встреча во вторник, 13 октября» */
  meetingText: string;
}) {
  const { data, me } = usePrototype();
  const inbox = useInboxCount();
  const { open } = useOpenTask();
  const weekly = report;
  const state = report.state;
  const mine = data.tasks.filter((t) => isMine(t, me.slug, me.role) && !t.archived);
  const urgent = myTasksOrder(mine.filter((t) => isOverdue(t, data.today) || isDueThisWeek(t, data.today)), data.today);
  const comments = mine
    .flatMap((t) => t.comments.filter((c) => c.author !== me.slug && diffDays(c.at, data.today) <= 7).map((c) => ({ task: t, comment: c })))
    .sort((a, b) => (a.comment.at + a.comment.time < b.comment.at + b.comment.time ? 1 : -1));
  const submitted = state === "submitted" || state === "late";

  const openMine = mine.filter((t) => !isClosed(t));
  const overdueCount = openMine.filter((t) => isOverdue(t, data.today)).length;
  const waiting = requests.outgoing.filter((r) => r.status === "open").length;
  const weeklySub = weekly.absent && !submitted
    ? `Вас нет на этой неделе, ${substituteText(weekly.absent.substitute)}`
    : submitted
      ? (weekly.submittedAt ? submittedText(weekly.submittedAt).replace(/^с/, "С") : state === "late" ? "Сдан с опозданием" : "Сдан")
      : late
        ? "Срок прошёл"
        : `Осталось ${timeLeft}`;

  return (
    <>
      {/* Плитки как на главной сайта (дизайн-система, layout/Tile.jsx) */}
      <Tiles>
        <Tile
          href="/weekly/submit"
          tone={submitted ? undefined : "primary"}
          title={<span id="my-weekly">Мой weekly за неделю {weekNumber}</span>}
          sub={weeklySub}
          icon={FileText}
          value={entriesCount}
          unit={plural(entriesCount, "запись", "записи", "записей")}
        >
          {weekly.absent && !submitted ? <AbsentBadge /> : <WeeklyBadge state={state} />}
        </Tile>
        <Tile href="/me" title="Мне" sub="Новых событий" icon={Inbox} value={inbox} unit={inbox ? "ждут ответа или прочтения" : "всё прочитано"} />
        <Tile
          href="/tasks/mine"
          title="Просрочено"
          sub="Моих задач"
          icon={CircleAlert}
          iconTone={overdueCount ? "danger" : "neutral"}
          value={overdueCount}
          unit={`из ${openMine.length} ${plural(openMine.length, "открытой", "открытых", "открытых")}`}
        />
        <Tile href="/#my-waiting" title="Жду от коллег" sub="Просьбы без ответа" icon={Hand} iconTone="info" value={waiting} />
        <Tile href="/weekly/meeting" tone="brand" wide title={meetingText} sub="Повестка, решения недели и разбор задач" icon={Presentation}>
          <span className="text-caption opacity-80">Открыть подготовку к встрече</span>
        </Tile>
      </Tiles>

      {team ? <SubmissionStrip reports={team} className="mt-4" /> : null}

      {promiseStats?.active ? (
        <div className="mt-4">
          <PromiseStats stats={promiseStats} />
        </div>
      ) : null}

      <div className="sv-columns mt-8">
        <section aria-labelledby="my-tasks" className="sv-section">
          <div className="sv-section__head">
            <h2 id="my-tasks" className="sv-section__title">
              Просроченные и срочные <span className="sv-section__count">{urgent.length}</span>
            </h2>
            <Link href="/tasks/mine" className="sv-section__link">
              Все мои задачи
            </Link>
          </div>
          {urgent.length === 0 ? (
            <EmptyState title="Срочного нет">Просроченных задач и задач со сроком на этой неделе нет.</EmptyState>
          ) : (
            <ul className="sv-table-wrap divide-y divide-line">
              {urgent.map((t) => {
                const overdue = isOverdue(t, data.today);
                return (
                  <li key={t.number} className={cn("px-4 py-3", overdue && "bg-[var(--color-row-overdue)]")}>
                    <button type="button" onClick={() => open(t.number)} className="text-left text-body font-semibold leading-snug text-ink hover:text-link">
                      <span className="mr-1.5 font-normal tabular-nums text-text-secondary">{t.number}</span>
                      {t.title}
                    </button>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <StatusBadge status={t.status} />
                      <StateDot state={t.state} />
                      <span className={cn("sv-due", overdue && "!font-semibold !text-danger-ink")}>срок {formatShort(t.due)}</span>
                      {overdue ? <OverdueNote days={overdueDays(t, data.today)} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="my-comments" className="sv-section">
          <div className="sv-section__head">
            <h2 id="my-comments" className="sv-section__title">
              Новые комментарии <span className="sv-section__count">{comments.length}</span>
            </h2>
          </div>
          {comments.length === 0 ? (
            <EmptyState title="Новых комментариев нет" icon={MessageSquare}>Здесь появятся комментарии коллег к вашим задачам.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {comments.map(({ task, comment }) => (
                <li key={comment.id} className="sv-card sv-card--soft px-4 py-3">
                  <p className="flex items-center gap-2 text-caption text-muted">
                    <MessageSquare className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                    <span className="font-semibold text-ink">{compactName(comment.author)}</span>
                    {formatShort(comment.at)}, {comment.time}
                  </p>
                  <p className="mt-1 text-body leading-relaxed text-ink">{comment.text}</p>
                  <button type="button" onClick={() => open(task.number)} className="mt-1 text-left text-small font-semibold text-link hover:underline">
                    Задача {task.number}: {task.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="sv-columns sv-columns--even mt-8">
        <RequestList
          id="my-incoming"
          title="Просьбы ко мне"
          mode="incoming"
          items={requests.incoming.slice(0, 5)}
          total={requests.incoming.length}
          action={
            requests.incoming.length > 5 ? (
              <Link href="/me" className="sv-section__link">
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
