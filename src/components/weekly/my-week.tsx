"use client";

import Link from "next/link";
import type { RequestView } from "@/domain/requests";
import type { InboxItem } from "@/lib/inbox/service";
import { NoRequests, RequestList } from "@/components/requests/request-list";
import { AskColleagueButton } from "@/components/requests/request-dialog";
import { FileText, MessageSquare, PenLine, Presentation, TriangleAlert } from "lucide-react";
import { IconCircle } from "@/components/ui/tile";
import { hotTasks, queueCounts, queueFigures, splitRequests } from "@/components/inbox/me-tasks";
import { MeQueue } from "@/components/inbox/me-queue";
import { diffDays, formatShort, plural, toCalendar, weekdayShort, type IsoDate } from "@/domain/dates";
import { usePrototype } from "@/domain/store";
import { compactName } from "@/domain/people";
import { isMine } from "@/domain/rules";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button";
import { WeeklyBadge } from "@/components/ui/task-badges";
import { EmptyState } from "@/components/empty-state";
import { useOpenTask } from "@/components/tasks/task-drawer";
import { SubmissionStrip } from "./submission-strip";
import { AbsentBadge, substituteText } from "./absence";
import { submittedText } from "./weekly-feed";
import type { PersonWeekly, WeekKey } from "@/domain/types";
import type { PromiseHistory } from "@/lib/weekly/promise-service";
import { PromiseStats } from "./promise-stats";
import { submitWeekHref } from "@/lib/weekly/weeks";

/** Прошлая неделя без сданного weekly (этап 76): номер, понедельник для ссылки и даты словами */
export type MissedWeekLine = { key: WeekKey; number: number; range: string };

/**
 * Стартовый экран (раздел 7 ТЗ). Этап 76: раздел «Мне» влит сюда блоком «Ждёт вас», порядок от действия к обзору.
 * Слева сверху вниз: несданные weekly за прошлые недели (если есть), «Сейчас» (мой weekly за отчётную неделю, срок
 * и одна кнопка), «Ждёт вас» (счётчики якорями к группам и вся очередь: задачи со сроком, просьбы, события с
 * «Разобрано» и «Напомнить», принятые просьбы). Справа: у руководителя «Кто сдал weekly», встреча, обещания, «Жду от
 * коллег», новые комментарии. На телефоне правая колонка идёт после левой, поэтому действия всегда первыми.
 *
 * История: этап 44 сетка 2:1, этап 68 крупный срок, счётчики и плитка встречи
 */
export function MyWeek({
  timeLeft,
  late,
  weekNumber,
  report,
  entriesCount,
  team,
  requests,
  items,
  events,
  snoozed,
  missed,
  promiseStats,
  meetingText,
  meetingDay,
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
  /** События очереди без просьб, которые уже в ней своей строкой (этап 76, раньше на странице «Мне») */
  items: InboxItem[];
  /** Сколько из них не тихие: для счётчиков «Ждёт вас» (этап 44) */
  events: number;
  /** Сколько предметов отложено до напоминания */
  snoozed: number;
  /** Прошлые открытые недели без сданного weekly, свежие сверху, не больше четырёх (этап 76) */
  missed: MissedWeekLine[];
  /** «Обещал и сделал» за 8 недель (этап 22): видит только сам человек */
  promiseStats?: PromiseHistory;
  /** «Встреча во вторник, 13 октября» */
  meetingText: string;
  /** День встречи для плитки даты (этап 68) */
  meetingDay?: IsoDate;
}) {
  const { data, me } = usePrototype();
  const { open } = useOpenTask();
  const weekly = report;
  const state = report.state;
  const mine = data.tasks.filter((t) => isMine(t, me.slug, me.role) && !t.archived);
  // Одни правила с очередью: числа счётчиков совпадают со строками групп ниже
  const counts = queueCounts(hotTasks(data, me), splitRequests(requests.incoming, data.today), events);
  const figures = queueFigures(counts);
  const comments = mine
    .flatMap((t) => t.comments.filter((c) => c.author !== me.slug && diffDays(c.at, data.today) <= 7).map((c) => ({ task: t, comment: c })))
    .sort((a, b) => (a.comment.at + a.comment.time < b.comment.at + b.comment.time ? 1 : -1));
  const submitted = state === "submitted" || state === "late";
  const attention = counts.late + counts.soon + counts.answer + counts.events;
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
        {/* Этап 76: прошлые недели без сданного weekly первыми: срок прошёл, а неделя ещё открыта */}
        {missed.length ? (
          <section aria-labelledby="my-missed" className="sv-card sv-card--soft border-danger-ink/30 px-5 py-3" data-testid="my-missed-weekly">
            <h2 id="my-missed" className="sr-only">
              Несданные weekly за прошлые недели
            </h2>
            <ul className="m-0 flex list-none flex-col p-0">
              {missed.map((w) => (
                <li key={w.key} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1">
                  <TriangleAlert className="h-4 w-4 shrink-0 text-danger-ink" strokeWidth={1.5} aria-hidden="true" />
                  <Link href={submitWeekHref(w.key)} className="inline-flex min-h-11 items-center text-body font-semibold text-danger-ink hover:underline sm:min-h-8">
                    Не сдан weekly за неделю {w.number}
                  </Link>
                  <span className="text-caption text-text-secondary">{w.range}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Сейчас: мой weekly и одна кнопка. Зелёная кнопка только здесь, в шапке её больше нет */}
        <section aria-labelledby="my-weekly" className={cn("sv-card sv-card--soft flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between", !submitted && !weekly.absent && "sv-card--now")}>
          <div className="flex min-w-0 items-center gap-5">
            {/* Этап 68: до сдачи срок крупно: главное на странице видно с первого взгляда */}
            {!submitted && !weekly.absent ? (
              // Срок прошёл: подпись и значение красные (цвет у каждой строки, вложенный цвет не перебивает), 4,5:1 в обеих темах
              <div className="hidden shrink-0 flex-col border-r border-line pr-5 sm:flex" data-testid="my-deadline" data-late={late || undefined}>
                <span className={cn("text-caption font-semibold uppercase tracking-wide", late ? "text-danger-ink" : "text-text-secondary")}>{late ? "Срок прошёл" : "До срока"}</span>
                <span className={cn("text-title font-semibold tabular-nums", late ? "text-danger-ink" : "text-ink")}>{late ? "сдать сейчас" : timeLeft}</span>
              </div>
            ) : (
              <IconCircle icon={FileText} tone={submitted ? "success" : "accent"} size={48} className="hidden sm:inline-flex" />
            )}
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

        {/* Ждёт вас (этап 76, раньше раздел «Мне»): вся очередь здесь же. Счётчики ведут якорем к группам ниже */}
        <section aria-labelledby="me-queue" className="sv-section !mt-0">
          <div className="sv-section__head">
            <h2 id="me-queue" className="sv-section__title scroll-mt-[calc(6rem+var(--view-as-h,0px))]">
              Ждёт вас {attention ? <span className="sv-section__count">{attention}</span> : null}
            </h2>
          </div>
          {figures.length ? (
            <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4" aria-label="Что ждёт" data-testid="my-attention-figures">
              {figures.map((f) => (
                <li key={f.key}>
                  {/* Обычная ссылка-якорь: группа на этой же странице, браузер прокручивает к ней сам */}
                  <a
                    href={f.href}
                    className={cn(
                      "group flex flex-col rounded-control-lg px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                      f.tone === "danger" && "bg-danger-soft text-danger-ink",
                      f.tone === "warning" && "bg-warning-soft text-warning-ink",
                      f.tone === "info" && "bg-blue-soft text-link",
                      f.tone === "neutral" && "border border-line bg-surface text-ink",
                    )}
                  >
                    <span className="text-title font-semibold tabular-nums">{f.n}</span>
                    <span className="text-small font-semibold group-hover:underline">{f.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          <MeQueue incoming={requests.incoming} items={items} snoozed={snoozed} />
        </section>
      </div>

      <aside className="flex min-w-0 flex-col gap-6" aria-label="Команда, встреча, обещания, просьбы и комментарии">
        {/* Кто сдал weekly: только руководителю в режиме управления. Справа сверху: обзор команды перед встречей */}
        {team ? <SubmissionStrip reports={team} /> : null}

        {/* Встреча: дата, что внутри, кнопка подготовки */}
        <section aria-labelledby="my-meeting" className="sv-card sv-card--soft p-5">
          <div className="flex items-start gap-3">
            {meetingDay ? (
              <div className="flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-control-lg bg-blue-soft text-link" aria-hidden="true">
                <span className="text-caption font-semibold uppercase">{weekdayShort(meetingDay)}</span>
                <span className="text-title font-semibold leading-none tabular-nums">{toCalendar(meetingDay).day}</span>
              </div>
            ) : (
              <IconCircle icon={Presentation} tone="neutral" size={40} />
            )}
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
          empty={<NoRequests title="Вы ничего не ждёте">Попросите коллегу о помощи: адресат увидит просьбу у себя на «Моей неделе», а ответ и срок появятся здесь.</NoRequests>}
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
              {comments.slice(0, 3).map(({ task, comment }) => (
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
              {comments.length > 3 ? (
                <li className="text-small text-muted">
                  Ещё {comments.length - 3}: целиком в карточках задач,{" "}
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
