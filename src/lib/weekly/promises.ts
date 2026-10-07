// Обещания недели (этап 22, модуль М6): что лидер обещал на прошлой неделе и что из этого вышло.
// Чистые правила: ими пользуются и экран сдачи weekly, и сервер (сводка в отчёте CEO).
//
// Обещания недели W:
// - планы из weekly недели W-1: записи типа «План» и «Что делаем дальше» в остальных записях. Записи, по которым уже
//   сделана задача, не считаются: за них отвечает задача;
// - задачи лидера со сроком на неделе W, и те, чей срок с недели W перенесли позже уже во время недели или после неё.
// Итог плана ставит лидер, итог задачи это её статус: у каждого факта одно место.

import type { BadgeTone } from "@/components/ui/badge";
import type { IsoDate } from "@/domain/dates";
import type { PersonSlug, Task } from "@/domain/types";

export type PromiseResultCode = "done" | "partial" | "not-done" | "dropped";

export const PROMISE_RESULTS: { code: PromiseResultCode; label: string; tone: BadgeTone }[] = [
  { code: "done", label: "Сделано", tone: "green" },
  { code: "partial", label: "Частично", tone: "orange" },
  { code: "not-done", label: "Не сделано", tone: "red" },
  { code: "dropped", label: "Снято", tone: "gray" },
];

export const promiseResultOf = (code: PromiseResultCode) => PROMISE_RESULTS.find((r) => r.code === code)!;

/** Фраза итога: не длиннее одной мысли */
export const PROMISE_NOTE_MAX = 300;

/** Итог без фразы бывает только у «Сделано» */
export function promiseNeedsNote(result: PromiseResultCode): boolean {
  return result !== "done";
}

/** Переносят в план этой недели только невыполненное */
export function canCarry(result: PromiseResultCode | undefined): boolean {
  return result === "partial" || result === "not-done";
}

export function promiseNoteHint(result: PromiseResultCode | ""): string {
  if (result === "partial") return "Что сделано и что осталось";
  if (result === "not-done") return "Что помешало";
  if (result === "dropped") return "Почему сняли";
  return "Что получилось, если есть что сказать";
}

/** Обещание из прошлого weekly: план или «что делаем дальше» */
export type EntryPromise = {
  entryId: string;
  kind: "plan" | "next";
  /** Что обещал */
  what: string;
  /** Запись, к которой относится «что делаем дальше» */
  from?: string;
  review?: { result: PromiseResultCode; note?: string; carried?: { id: string; what: string } };
};

/** Запись прошлой недели как обещание. null: запись не обещание или за неё отвечает задача */
export function entryPromiseText(e: { type: string; what: string; next?: string | null; hasTask: boolean }): { kind: "plan" | "next"; what: string } | null {
  if (e.hasTask) return null;
  if (e.type === "plan") return { kind: "plan", what: e.what };
  const next = (e.next ?? "").trim();
  return next ? { kind: "next", what: next } : null;
}

type WeekRange = { start: IsoDate; end: IsoDate };
type PromiseTask = Pick<Task, "status" | "due" | "resolution" | "transfers" | "owner" | "archived">;

const inWeek = (d: IsoDate | null | undefined, w: WeekRange) => !!d && d >= w.start && d <= w.end;

/**
 * Задача человека, которую он обещал закончить на неделе: срок на неделе, или срок был на неделе и его перенесли
 * позже уже во время недели. Перенос до начала недели обещанием этой недели не считается
 */
export function isPromiseTask(task: PromiseTask, author: PersonSlug, week: WeekRange): boolean {
  if (task.archived || task.status === "proposed" || task.owner !== author) return false;
  if (inWeek(task.due, week)) return true;
  return task.transfers.some((t) => inWeek(t.from, week) && !!t.at && t.at >= week.start);
}

export function promiseTasks<T extends PromiseTask>(tasks: T[], author: PersonSlug, week: WeekRange): T[] {
  return tasks.filter((t) => isPromiseTask(t, author, week));
}

/**
 * Итог задачи-обещания по её статусу. moved: срок перенесли за неделю, это «не сделано» с причиной переноса.
 * open: задача открыта и срок на неделе, итога ещё нет
 */
export type TaskPromiseOutcome = { result: PromiseResultCode | "moved" | "open"; note?: string };

export function taskPromiseOutcome(task: PromiseTask, week: WeekRange): TaskPromiseOutcome {
  const note = task.resolution || undefined;
  if (task.status === "done") return { result: "done", note };
  if (task.status === "partial") return { result: "partial", note };
  if (task.status === "failed") return { result: "not-done", note };
  if (task.status === "cancelled") return { result: "dropped", note };
  if (task.due > week.end) {
    const moved = [...task.transfers].reverse().find((t) => inWeek(t.from, week));
    return { result: "moved", note: moved?.reason };
  }
  return { result: "open" };
}

export type PromiseSummary = { done: number; partial: number; notDone: number; dropped: number; pending: number; total: number };

export const EMPTY_SUMMARY: PromiseSummary = { done: 0, partial: 0, notDone: 0, dropped: 0, pending: 0, total: 0 };

/** Сводка итогов. Перенесённая задача считается невыполненной, обещание без итога отдельно */
export function summarize(results: (PromiseResultCode | "moved" | "open" | undefined)[]): PromiseSummary {
  const s = { ...EMPTY_SUMMARY, total: results.length };
  for (const r of results) {
    if (r === "done") s.done++;
    else if (r === "partial") s.partial++;
    else if (r === "not-done" || r === "moved") s.notDone++;
    else if (r === "dropped") s.dropped++;
    else s.pending++;
  }
  return s;
}

export function addSummary(a: PromiseSummary, b: PromiseSummary): PromiseSummary {
  return { done: a.done + b.done, partial: a.partial + b.partial, notDone: a.notDone + b.notDone, dropped: a.dropped + b.dropped, pending: a.pending + b.pending, total: a.total + b.total };
}

/** Доля выполненных обещаний: сделано из тех, у кого есть итог. Снятые и обещания без итога не считаются. null: считать не из чего */
export function promiseShare(s: PromiseSummary): number | null {
  const base = s.done + s.partial + s.notDone;
  return base ? Math.round((s.done / base) * 100) : null;
}

/** «Сделано 3 из 4, частично 1. Снято 1. Без итога 2» */
export function summaryText(s: PromiseSummary): string {
  if (!s.total) return "Обещаний не было";
  const base = s.done + s.partial + s.notDone;
  const parts: string[] = [];
  if (base) {
    const tail = [s.partial ? `частично ${s.partial}` : "", s.notDone ? `не сделано ${s.notDone}` : ""].filter(Boolean).join(", ");
    parts.push(`Сделано ${s.done} из ${base}${tail ? `: ${tail}` : ""}`);
  }
  if (s.dropped) parts.push(`Снято ${s.dropped}`);
  if (s.pending) parts.push(`Без итога ${s.pending}`);
  return parts.join(". ");
}
