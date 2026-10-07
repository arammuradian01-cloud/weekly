// Перевод значений базы в коды экранов и обратно. Экраны говорят «in-progress», база IN_PROGRESS.

import type { TaskPriority, TaskState, TaskStatus } from "@/generated/prisma/enums";
import type { PriorityCode, StateCode, StatusCode } from "@/domain/dictionaries";

const STATUS: Record<TaskStatus, StatusCode> = {
  PROPOSED: "proposed",
  IN_PROGRESS: "in-progress",
  CLARIFY: "clarify",
  DONE: "done",
  PARTIAL: "partial",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

const PRIORITY: Record<TaskPriority, Exclude<PriorityCode, "unset">> = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
};

const STATE: Record<TaskState, Exclude<StateCode, "unset">> = {
  ON_TRACK: "on-track",
  AT_RISK: "at-risk",
  BLOCKED: "blocked",
};

function invert<K extends string, V extends string>(map: Record<K, V>): Record<V, K> {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k])) as Record<V, K>;
}

const STATUS_DB = invert(STATUS);
const PRIORITY_DB = invert(PRIORITY);
const STATE_DB = invert(STATE);

export const statusCode = (s: TaskStatus): StatusCode => STATUS[s];
export const priorityCode = (p: TaskPriority | null): PriorityCode => (p ? PRIORITY[p] : "unset");
export const stateCode = (s: TaskState | null): StateCode => (s ? STATE[s] : "unset");

export function statusDb(code: string): TaskStatus | null {
  return (STATUS_DB as Record<string, TaskStatus>)[code] ?? null;
}
export function priorityDb(code: string): TaskPriority | null {
  return (PRIORITY_DB as Record<string, TaskPriority>)[code] ?? null;
}
export function stateDb(code: string): TaskState | null {
  return (STATE_DB as Record<string, TaskState>)[code] ?? null;
}

export const CLOSED_DB: TaskStatus[] = ["DONE", "PARTIAL", "FAILED", "CANCELLED"];
