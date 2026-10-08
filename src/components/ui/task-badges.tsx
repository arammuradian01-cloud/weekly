// Метки задач и weekly по разделу 7 ТЗ. Цвет никогда не единственный носитель смысла: рядом всегда слово.

import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "./badge";
import type { Task } from "@/domain/types";
import { lateWaits } from "@/lib/tasks/rules";
import { greenOutside, greenOutsideText } from "@/lib/tasks/green-outside";
import type { IsoDate } from "@/domain/dates";
import {
  priorityOf,
  stateLabel,
  statusOf,
  weeklyStateOf,
  type PriorityCode,
  type StateCode,
  type StatusCode,
  type WeeklyStateCode,
} from "@/domain/dictionaries";

export function StatusBadge({ status, className }: { status: StatusCode; className?: string }) {
  const s = statusOf(status);
  // Дизайн-система: у статусов точка, «Предложена» обводкой без точки, «Выполнена частично» зелёная с половинной точкой
  if (status === "partial") {
    return (
      <Badge tone="green" dot half className={className}>
        {s.label}
      </Badge>
    );
  }
  return (
    <Badge tone={s.tone} dot={status !== "proposed"} className={className}>
      {s.label}
    </Badge>
  );
}

const PRIORITY_LEVEL: Record<PriorityCode, string> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  unset: "none",
};

/** Приоритет: метка слева и слово (sv-priority) */
export function PriorityTag({ priority, className }: { priority: PriorityCode; className?: string }) {
  return (
    <span className={cn("sv-priority", `sv-priority--${PRIORITY_LEVEL[priority]}`, className)}>
      <span className="sv-priority__mark" aria-hidden="true" />
      {priorityOf(priority).label}
    </span>
  );
}

const STATE_LEVEL: Record<StateCode, string> = {
  "on-track": "ok",
  "at-risk": "risk",
  blocked: "blocked",
  unset: "none",
};

/** Состояние задачи: точка и слово (sv-state) */
export function StateDot({ state, className, label }: { state: StateCode; className?: string; label?: string }) {
  return (
    <span className={cn("sv-state", `sv-state--${STATE_LEVEL[state]}`, className)}>
      <span className="sv-state__dot" aria-hidden="true" />
      {label ?? stateLabel(state)}
    </span>
  );
}

export function WeeklyBadge({ state, className }: { state: WeeklyStateCode; className?: string }) {
  const s = weeklyStateOf(state);
  return (
    <Badge tone={s.tone} dot className={className}>
      {s.label}
    </Badge>
  );
}

/** «просрочена на 3 дн.» рядом со сроком */
export function OverdueNote({ days, className }: { days: number; className?: string }) {
  return (
    <span className={cn("sv-overdue", className)}>
      <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
      просрочена на {days} дн.
    </span>
  );
}

export function StaleNote({ className }: { className?: string }) {
  return <span className={cn("whitespace-nowrap text-caption text-warning-ink", className)}>давно не обновлялась</span>;
}

/**
 * «Зелёное снаружи» (этап 22): «В графике», но просрочена, срок переносили 2 раза или давно без обновлений.
 * С 14 дней без обновлений «В графике» не считается, пока не обновят «где сейчас»
 */
export function GreenOutsideNote({ task, today, className }: { task: Parameters<typeof greenOutside>[0]; today: IsoDate; className?: string }) {
  const g = greenOutside(task, today);
  if (!g) return null;
  return (
    <span className={cn("text-caption font-medium text-orange-ink", className)}>
      {greenOutsideText(g)}
      {g.unconfirmed ? ": не подтверждено" : ""}
    </span>
  );
}

/** Задача ждёт другие, а их срок позже её срока (этап 21) */
export function LateWaits({ task, className }: { task: Pick<Task, "waitsFor" | "due" | "status">; className?: string }) {
  const late = lateWaits(task);
  if (!late.length) return null;
  return <span className={cn("text-caption font-medium text-danger-ink", className)}>ждёт {late.length > 1 ? "задачи" : "задачу"} {late.join(", ")} с более поздним сроком</span>;
}
