"use client";

import Link from "next/link";
import type { RequestView } from "@/domain/requests";
import { NoRequests, RequestList, RequestRow } from "@/components/requests/request-list";
import { AskColleagueButton } from "@/components/requests/request-dialog";
import { CalendarClock, FileText, Hand, Inbox, MessageSquare, PenLine, Presentation } from "lucide-react";
import { IconCircle } from "@/components/ui/tile";
import { hotTasks } from "@/components/inbox/me-tasks";
import { plural } from "@/domain/dates";
import { usePrototype } from "@/domain/store";
import { compactName } from "@/domain/people";
import { diffDays, formatShort } from "@/domain/dates";
import { isMine, isOverdue, overdueDays } from "@/domain/rules";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button";
import { OverdueNote, WeeklyBadge } from "@/components/ui/task-badges";
import { EmptyState } from "@/components/empty-state";
import { useOpenTask } from "@/components/tasks/task-drawer";
import { StateSelect, StatusSelect } from "@/components/tasks/task-fields";
import { SubmissionStrip } from "./submission-strip";
import { AbsentBadge, substituteText } from "./absence";
import { submittedText } from "./weekly-feed";
import type { PersonWeekly } from "@/domain/types";
import type { PromiseHistory } from "@/lib/weekly/promise-service";
import { PromiseStats } from "./promise-stats";

/**
 * Стартовый экран (раздел 7 ТЗ). Этап 44: сетка 2:1. Слева «Сейчас» (мой weekly, срок, одна кнопка) и «Требует
 * внимания» одним списком: просроченные и срочные задачи, просьбы без ответа, новые события. Справа встреча,
 * обещания (когда есть данные), «Жду от коллег» и новые комментарии. Четыре плитки одного веса ушли
 */
export function MyWeek({
  timeLeft,
  late,
  weekNumber,
  report,
  entriesCount,
  team,
  requests,
  events,
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
  /** Новые события в «Мне» без просьб, которые уже в списке (этап 44) */
  events: number;
  /** «Обещал и сделал» за 8 недель (этап 22): видит только сам человек */
  promiseStats?: PromiseHistory;
  /** «Встреча во вторник, 13 октября» */
  meetingText: string;
}) {
  const { data, me } = usePrototype();
  const { open } = useOpenTask();
  const weekly = report;
  const state = report.state;
  const mine = data.tasks.filter((t) => isMine(t, me.slug, me.role) && !t.archived);
  // Одно правило с «Мне»: просроченные и срок сегодня или завтра. Срок на этой неделе: по ссылке «Все мои задачи»
  const hot = hotTasks(data, me);
  const urgent = [...hot.late, ...hot.soon];
  const comments = mine
    .flatMap((t) => t.comments.filter((c) => c.author !== me.slug && diffDays(c.at, data.today) <= 7).map((c) => ({ task: t, comment: c })))
    .sort((a, b) => (a.comment.at + a.comment.time < b.comment.at + b.comment.time ? 1 : -1));
  const submitted = state === "submitted" || state === "late";
  const answer = requests.incoming.filter((r) => r.status === "open");
  const attention = urgent.length + answer.length + events;
  const weeklySub = weekly.absent && !submitted
    ? `На этой неделе вас нет, ${substituteText(weekly.absent.substitute)}`
    : submitted
      ? (weekly.submittedAt ? submittedText(weekly.submittedAt).replace(/^с/, "С") : state === "late" ? "Сдан с опозданием" : "Сдан")
      : late
        ? "Срок прошёл"
        : `Осталось ${timeLeft}`;

  return (
    <div className="sv-page--overview">
      <div className="flex min-w-0 flex-col gap-8">
        {/* Сейчас: мой weekly и одна кнопка. Зелёная кнопка только здесь, в шапке её больше нет */}
        <section aria-labelledby="my-weekly" className={cn("sv-card sv-card--soft flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between", !submitted && !weekly.absent && "sv-card--now")}>
          <div className="flex min-w-0 items-start gap-4">
            <IconCircle icon={FileText} tone={submitted ? "success" : "accent"} size={48} className="hidden sm:inline-flex" />
            <div className="min-w-0">
              <h2 id="my-weekly" className="text-title-sm font-semibold text-ink">
                Мой weekly за неделю {weekNumber}
              </h2>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-text-secondary">
                {weekly.absent && !submitted ? <AbsentBadge /> : <WeeklyBadge state={state} />}
                <span className={cn(late && !submitted && "font-semibold text-danger-ink")}>{weeklySub}</span>
                <span className="tabular-nums">
                  {entriesCount} {plural(entriesCount, "запись", "записи", "записей")}
                </span>
              </p>
            </div>
          </div>
          <Link href="/weekly/submit" className={cn(buttonClass(submitted ? "secondary" : "primary"), "shrink-0")}>
            <PenLine className="h-4 w-4" aria-hidden="true" />
            {submitted ? "Открыть мой weekly" : state === "draft" ? "Продолжить weekly" : "Сдать weekly"}
          </Link>
        </section>

        {team ? <SubmissionStrip reports={team} /> : null}

        {/* Требует внимания: один список группами, а не три плитки */}
        <section aria-labelledby="my-attention" className="sv-section !mt-0">
          <div className="sv-section__head">
            <h2 id="my-attention" className="sv-section__title">
              Требует внимания {attention ? <span className="sv-section__count">{attention}</span> : null}
            </h2>
            <Link href="/me" className="sv-section__link">
              Открыть «Мне»
            </Link>
          </div>
          {attention === 0 ? (
            <EmptyState title="Ничего не ждёт" tone="success">
              Просроченных и срочных задач, просьб без ответа и новых событий нет.
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-5">
              {urgent.length ? (
                <AttentionGroup id="my-tasks" title="Просроченные и срочные задачи" count={urgent.length} icon={CalendarClock} tone="danger" link={{ href: "/tasks/mine", label: "Все мои задачи" }}>
                  <ul className="sv-queue sv-card sv-card--soft divide-y divide-line">
                    {urgent.map((t) => {
                      const overdue = isOverdue(t, data.today);
                      return (
                        <li key={t.number} className={cn("px-4 py-3", overdue && "bg-[var(--color-row-overdue)]")}>
                          <button type="button" onClick={() => open(t.number)} className="text-left text-body font-semibold leading-snug text-ink hover:text-link">
                            <span className="mr-1.5 font-normal tabular-nums text-text-secondary">{t.number}</span>
                            {t.title}
                          </button>
                          {/* Статус и состояние меняются прямо здесь (этап 26): с телефона это два нажатия с главной */}
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                            <StatusSelect task={t} subject={`задачи ${t.number}`} />
                            <StateSelect task={t} subject={`задачи ${t.number}`} set />
                            <span className={cn("sv-due", overdue && "!font-semibold !text-danger-ink")}>срок {formatShort(t.due)}</span>
                            {overdue ? <OverdueNote days={overdueDays(t, data.today)} /> : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </AttentionGroup>
              ) : null}
              {answer.length ? (
                <AttentionGroup id="my-incoming" title="Просьбы без ответа" count={answer.length} icon={Hand} tone="info" link={requests.incoming.length > answer.length ? { href: "/me", label: `Все просьбы ко мне: ${requests.incoming.length}` } : undefined}>
                  <ul className="flex flex-col divide-y divide-line sv-card sv-card--soft">
                    {answer.slice(0, 5).map((r) => (
                      <RequestRow key={r.number} request={r} mode="incoming" />
                    ))}
                  </ul>
                  {answer.length > 5 ? (
                    <Link href="/me" className="mt-2 inline-block text-small font-semibold text-link hover:underline">
                      Ещё {answer.length - 5} в «Мне»
                    </Link>
                  ) : null}
                </AttentionGroup>
              ) : null}
              {events ? (
                <AttentionGroup id="my-events" title="Новые события" count={events} icon={Inbox} tone="accent">
                  <Link href="/me#me-read" className="sv-card sv-card--soft flex items-center justify-between gap-3 px-4 py-3 text-body text-ink hover:bg-row-hover">
                    <span>
                      {events} {plural(events, "событие ждёт", "события ждут", "событий ждут")} прочтения: комментарии, упоминания, реакции, переносы сроков
                    </span>
                    <span className="shrink-0 font-semibold text-link">Открыть</span>
                  </Link>
                </AttentionGroup>
              ) : null}
            </div>
          )}
        </section>
      </div>

      <aside className="flex min-w-0 flex-col gap-6" aria-label="Встреча, обещания, просьбы и комментарии">
        {/* Встреча: дата, что внутри, кнопка подготовки */}
        <section aria-labelledby="my-meeting" className="sv-card sv-card--soft p-5">
          <div className="flex items-start gap-3">
            <IconCircle icon={Presentation} tone="neutral" size={40} />
            <div className="min-w-0">
              <h2 id="my-meeting" className="text-title-sm font-semibold text-ink">
                {meetingText}
              </h2>
              <p id="my-meeting-sub" className="mt-1 text-body text-text-secondary">Повестка, решения недели и разбор задач</p>
            </div>
          </div>
          <Link href="/weekly/meeting" className={cn(buttonClass("secondary", "sm"), "mt-4 w-full")} aria-describedby="my-meeting-sub">
            Открыть подготовку к встрече
          </Link>
        </section>

        {/* Обещания только когда статистика уже есть: заглушка «наберётся 6 недель» никому не нужна каждый день */}
        {promiseStats?.enabled ? <PromiseStats stats={promiseStats} /> : null}

        <RequestList
          id="my-waiting"
          title="Жду от коллег"
          mode="outgoing"
          items={requests.outgoing}
          action={<AskColleagueButton size="sm" variant="ghost" />}
          empty={<NoRequests title="Вы ничего не ждёте">Попросите коллегу о помощи: адресат увидит просьбу в «Мне», а ответ и срок появятся здесь.</NoRequests>}
        />

        <section aria-labelledby="my-comments" className="sv-section !mt-0">
          <div className="sv-section__head">
            <h2 id="my-comments" className="sv-section__title">
              Новые комментарии {comments.length ? <span className="sv-section__count">{comments.length}</span> : null}
            </h2>
          </div>
          {comments.length === 0 ? (
            <EmptyState title="Новых комментариев нет" icon={MessageSquare}>Здесь появятся комментарии коллег к вашим задачам.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {comments.slice(0, 5).map(({ task, comment }) => (
                <li key={comment.id} className="sv-card sv-card--soft px-4 py-3">
                  <p className="flex items-center gap-2 text-caption text-muted">
                    <MessageSquare className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                    <span className="font-semibold text-ink">{compactName(comment.author)}</span>
                    {formatShort(comment.at)}, {comment.time}
                  </p>
                  {/* Этап 36: длинный комментарий не превращает главную в стену текста, целиком он в карточке задачи */}
                  <p className="mt-1 line-clamp-3 text-body leading-relaxed text-ink [overflow-wrap:anywhere]">{comment.text}</p>
                  <button type="button" onClick={() => open(task.number)} className="mt-1 text-left text-small font-semibold text-link hover:underline">
                    Задача {task.number}: {task.title}
                  </button>
                </li>
              ))}
              {comments.length > 5 ? (
                <li className="text-small text-muted">
                  Ещё {comments.length - 5}: целиком в карточках задач,{" "}
                  <Link href="/tasks/mine" className="font-semibold text-link hover:underline">
                    мои задачи
                  </Link>
                </li>
              ) : null}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}

/** Группа в списке «Требует внимания»: подзаголовок с иконкой и числом, справа ссылка «Все» */
function AttentionGroup({
  id,
  title,
  count,
  icon,
  tone,
  link,
  children,
}: {
  id: string;
  title: string;
  count: number;
  icon: typeof Hand;
  tone: "danger" | "info" | "accent";
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <IconCircle icon={icon} tone={tone} size={28} />
        <h3 id={id} className="text-body font-semibold text-ink">
          {title} <span className="font-normal text-muted">{count}</span>
        </h3>
        {link ? (
          <Link href={link.href} className="ml-auto text-small font-semibold text-link hover:underline">
            {link.label}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}
