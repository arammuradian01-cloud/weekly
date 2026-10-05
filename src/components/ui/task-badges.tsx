// Метки задач и weekly по разделу 7 ТЗ. Цвет никогда не единственный носитель смысла: рядом всегда слово.

import { cn } from "@/lib/cn";
import { Badge } from "./badge";
import {
  priorityOf,
  stateLabel,
  statusOf,
  weeklyStateOf,
  type PriorityCode,
  type StateCode,
  type StatusCode,
  type WeeklyStateCode,
} from "@/prototype/dictionaries";

export function StatusBadge({ status, className }: { status: StatusCode; className?: string }) {
  const s = statusOf(status);
  return (
    <Badge tone={s.tone} className={className}>
      {s.label}
    </Badge>
  );
}

const PRIORITY_MARK: Record<PriorityCode, string> = {
  critical: "bg-danger",
  high: "bg-orange",
  medium: "bg-slate",
  low: "bg-[#b4c2c9]",
  unset: "border border-dashed border-[#90a4ae] bg-transparent",
};

const PRIORITY_TEXT: Record<PriorityCode, string> = {
  critical: "text-danger-ink font-semibold",
  high: "text-[#9a4a05] font-medium",
  medium: "text-ink",
  low: "text-muted",
  unset: "text-muted",
};

export function PriorityTag({ priority, className }: { priority: PriorityCode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 whitespace-nowrap text-[14px]", PRIORITY_TEXT[priority], className)}>
      <span className={cn("h-3 w-1.5 shrink-0 rounded-[2px]", PRIORITY_MARK[priority])} aria-hidden="true" />
      {priorityOf(priority).label}
    </span>
  );
}

const STATE_DOT: Record<StateCode, string> = {
  "on-track": "bg-green",
  "at-risk": "bg-[#f2b600]",
  blocked: "bg-danger",
  unset: "border border-dashed border-[#90a4ae] bg-transparent",
};

export function StateDot({ state, className }: { state: StateCode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 whitespace-nowrap text-[14px] text-ink", state === "blocked" && "font-medium text-danger-ink", state === "unset" && "text-muted", className)}>
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", STATE_DOT[state])} aria-hidden="true" />
      {stateLabel(state)}
    </span>
  );
}

export function WeeklyBadge({ state, className }: { state: WeeklyStateCode; className?: string }) {
  const s = weeklyStateOf(state);
  return (
    <Badge tone={s.tone} className={className}>
      {s.label}
    </Badge>
  );
}

/** «просрочена на 3 дн.» рядом со сроком */
export function OverdueNote({ days, className }: { days: number; className?: string }) {
  return <span className={cn("whitespace-nowrap text-[13px] font-medium text-danger-ink", className)}>просрочена на {days} дн.</span>;
}

export function StaleNote({ className }: { className?: string }) {
  return <span className={cn("whitespace-nowrap text-[13px] text-warning-ink", className)}>давно не обновлялась</span>;
}
