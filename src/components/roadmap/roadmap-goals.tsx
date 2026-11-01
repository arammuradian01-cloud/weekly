"use client";

// Цели на roadmap (этап 77): строка и карточка цели, статус и прогресс как на экране «Цели», кнопка свернуть группу.
// Нажатие на цель открывает её на экране «Цели» (ссылка #goal-...): там строка таблицы раскрывается с фактом и историей.

import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { GoalGroup, RoadmapGoal } from "@/lib/tasks/roadmap-goals";
import { quarterLabel } from "@/lib/goals/parse";
import { progressLabel } from "@/lib/goals/progress";
import { goalTasksText } from "@/lib/goals/links";
import { formatShort, plural } from "@/domain/dates";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Meter, goalStatus } from "@/components/goals/goals-table";

/** Ссылка на цель: экран «Цели» нужного квартала, строка цели раскрывается */
export const goalHref = (g: Pick<RoadmapGoal, "id" | "quarter">) => `/goals${g.quarter ? `?q=${g.quarter}` : ""}#goal-${encodeURIComponent(g.id)}`;

/** «РТ-1. Подписка ОСАГО запущена» */
export const goalName = (g: Pick<RoadmapGoal, "code" | "title">) => (g.code ? `${g.code}. ${g.title}` : g.title);

export const tasksText = (n: number) => `${n} ${plural(n, "задача", "задачи", "задач")}`;

/** Счётчик группы: «3 задачи, важных 1, просрочено 1» */
export const groupCount = (g: { tasks: unknown[]; important: number; overdue: number }) =>
  `${tasksText(g.tasks.length)}${g.important ? `, важных ${g.important}` : ""}${g.overdue ? `, просрочено ${g.overdue}` : ""}`;

/** Чья цель, если не своей команды: «цель команды «Топ»», «цель Q3 2026» */
export function goalOrigin(g: RoadmapGoal, quarter: string): string | null {
  // У цели из метки задачи квартал уже на метке статуса
  if (g.own || !g.known) return null;
  const parts: string[] = [];
  if (g.team) parts.push(`команды «${g.team.name}»`);
  if (g.quarter && g.quarter !== quarter) parts.push(quarterLabel(g.quarter));
  return parts.length ? `цель ${parts.join(", ")}` : null;
}

/** Прогресс одной строкой: факт и доля пути к целевому или закрытые задачи, как в карточке цели */
export function goalProgressText(g: RoadmapGoal): string | null {
  if (!g.known) return null;
  if (g.numeric) return `${g.fact ? `факт ${g.fact}, ` : ""}${progressLabel(g.numeric)} пути`;
  return goalTasksText(g.progress.done, g.progress.total);
}

/**
 * Сроки цели словами: «с 1 окт. по 25 нояб.». У цели без задач на roadmap «до конца квартала», и только при нулевом
 * прогрессе «задач нет» (этап 84: задачи цели могут висеть на целях ниже). У снятой и недостигнутой цели без задач
 * срока впереди нет
 */
export function goalSpanText(group: Pick<GoalGroup, "span" | "empty" | "blank" | "closed">): string {
  if (!group.empty) return `с ${formatShort(group.span.start)} по ${formatShort(group.span.end)}`;
  if (group.closed) return "задач на roadmap нет";
  return `${group.blank ? "задач нет, " : ""}до конца квартала ${formatShort(group.span.end)}`;
}

export function GoalStatus({ goal, className }: { goal: RoadmapGoal; className?: string }) {
  if (!goal.known) return <Badge tone="gray" className={className}>{goal.quarter ? `цель ${quarterLabel(goal.quarter)}` : "цель"}</Badge>;
  const s = goalStatus(goal);
  return (
    <Badge tone={s.tone} dot className={className}>
      {s.label}
    </Badge>
  );
}

export function GoalCode({ code }: { code: string | null }) {
  if (!code) return null;
  return <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-blue-soft px-2 text-caption font-semibold tabular-nums text-link">{code}</span>;
}

/**
 * Кнопка раскрыть группу. Этап 84: подпись постоянная («Задачи цели РТ-1, 3 задачи»), раскрыта группа или нет
 * говорит aria-expanded: меняющаяся подпись «Свернуть» и «Развернуть» сбивала диктор и поиск по кнопке.
 * Цель нажатия 44 px на телефоне и на планшете, меньше только на широком экране с мышью
 */
export function GroupToggle({ open, onToggle, controls, label }: { open: boolean; onToggle: () => void; controls: string; label: string }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      className="-my-2 -ml-3 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted hover:bg-field hover:text-ink focus-visible:outline-2 focus-visible:outline-focus lg:-ml-2 lg:h-8 lg:w-8"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

/** Карточка цели на доске: код, название, статус, прогресс, сроки. Вся карточка открывает цель */
export function GoalCard({ group, quarter }: { group: GoalGroup; quarter: string }) {
  const g = group.goal;
  const origin = goalOrigin(g, quarter);
  const pct = g.progress.total ? Math.round((g.progress.done / g.progress.total) * 100) : 0;
  return (
    <li>
      <div
        className={cn(
          "sv-card-task !cursor-pointer has-[a[data-rm-title]:focus-visible]:ring-2 has-[a[data-rm-title]:focus-visible]:ring-blue",
          group.empty && !group.closed && "border-dashed border-steel",
          g.known && g.risk && g.result === "IN_PROGRESS" && "border-danger-ink",
        )}
        data-testid={`roadmap-goal-${g.id}`}
        data-empty={group.empty ? "true" : undefined}
      >
        <div className="flex items-start gap-2">
          <GoalCode code={g.code} />
          <Link
            href={goalHref(g)}
            data-rm-title
            className="min-w-0 flex-1 text-small font-semibold leading-snug text-ink [overflow-wrap:anywhere] after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          >
            {g.title}
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <GoalStatus goal={g} />
          {origin ? <span className="text-caption text-muted">{origin}</span> : null}
        </div>
        {g.known ? (
          g.numeric ? (
            <Meter progress={g.numeric} risk={!!g.risk} detail={g.fact ? `факт ${g.fact}` : null} />
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-caption text-muted">{goalTasksText(g.progress.done, g.progress.total)}</span>
              <div className="h-1.5 overflow-hidden rounded-full bg-field" aria-hidden="true">
                <div className="h-full rounded-full bg-green" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        ) : null}
        <p className="m-0 flex flex-wrap gap-x-2 gap-y-0.5 text-caption text-muted">
          <span className="tabular-nums">{group.empty ? (group.closed ? "задач на roadmap нет" : "до конца квартала") : `до ${formatShort(group.span.end)}`}</span>
          {group.tasks.length ? <span>{`${group.tasks.length} ${plural(group.tasks.length, "открытая задача", "открытые задачи", "открытых задач")}`}</span> : null}
          {group.overdue ? <span className="font-semibold text-danger-ink">просрочено {group.overdue}</span> : null}
        </p>
      </div>
    </li>
  );
}

/** Заголовок группы цели на доске «Цели и задачи»: свернуть, код, название (ссылка на цель), статус, прогресс, счётчики */
export function GoalGroupHeading({ group, quarter, id, open, onToggle, controls }: { group: GoalGroup; quarter: string; id: string; open: boolean; onToggle: () => void; controls: string }) {
  const g = group.goal;
  const name = goalName(g);
  // У цели без открытых задач без «0 задач»: хватает строки сроков
  const progress = g.progress.total || g.numeric ? goalProgressText(g) : null;
  const meta = [goalOrigin(g, quarter), progress, group.empty ? goalSpanText(group) : `${groupCount(group)}, до ${formatShort(group.span.end)}`].filter(Boolean);
  return (
    <div className="flex flex-col gap-1">
      <h2 id={id} className="m-0 flex min-w-0 items-center gap-2 text-body font-semibold text-ink">
        <GroupToggle open={open} onToggle={onToggle} controls={controls} label={`Задачи цели ${name}, ${tasksText(group.tasks.length)}`} />
        <GoalCode code={g.code} />
        <Link href={goalHref(g)} className="min-w-0 [overflow-wrap:anywhere] hover:underline" data-testid={`roadmap-goal-link-${g.id}`}>
          {g.title}
        </Link>
      </h2>
      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted sm:pl-7">
        <GoalStatus goal={g} />
        <span>{meta.join(", ")}</span>
      </p>
    </div>
  );
}

/** Заголовок последней группы «Задачи без цели» */
export function NoGoalHeading({ count, id, open, onToggle, controls }: { count: { tasks: unknown[]; important: number; overdue: number }; id: string; open: boolean; onToggle: () => void; controls: string }) {
  return (
    <h2 id={id} className="m-0 flex flex-wrap items-center gap-x-2 text-body font-semibold text-ink">
      <GroupToggle open={open} onToggle={onToggle} controls={controls} label={`Задачи без цели, ${tasksText(count.tasks.length)}`} />
      Задачи без цели
      <span className="text-small font-normal text-muted">{groupCount(count)}</span>
    </h2>
  );
}
