// Черновик weekly из фактов недели (этап 22б, модуль М6). Ресурс сам предлагает строки: что закрыто, что перенесено,
// что заблокировано, какие просьбы выполнены. Каждая строка добавляется в weekly одним нажатием и правится как запись.
// Чистые правила: факты по задачам считает и экран, и сервер.

import { addDays, formatShort, type IsoDate } from "@/domain/dates";
import type { BlockCode, DirectionCode, EntryTypeCode } from "@/domain/dictionaries";
import type { PersonSlug, Task } from "@/domain/types";
import { PROMISE_GRACE_DAYS } from "./promises";
import { WEEKLY_LIMITS } from "./rules";

export type FactKind = "closed" | "moved" | "blocked" | "request";

/** Факт недели как черновик записи. key не меняется между загрузками: по нему факт не предлагается второй раз */
export type WeekFact = {
  key: string;
  kind: FactKind;
  type: EntryTypeCode;
  block: BlockCode;
  direction: DirectionCode;
  what: string;
  details?: string;
  taskNumber?: number;
};

type WeekRange = { start: IsoDate; end: IsoDate };
type FactTask = Pick<Task, "number" | "title" | "owner" | "status" | "state" | "closedAt" | "resolution" | "transfers" | "direction" | "blockedBy" | "archived">;

/** «Что произошло» не длиннее 150 знаков: режем по слову */
export function clipWhat(text: string): string {
  const value = text.trim();
  if (value.length <= WEEKLY_LIMITS.what) return value;
  const cut = value.slice(0, WEEKLY_LIMITS.what - 1);
  const atSpace = cut.lastIndexOf(" ");
  return `${(atSpace > 80 ? cut.slice(0, atSpace) : cut).replace(/[,;:\s]+$/, "")}…`;
}

const inRange = (d: IsoDate | null | undefined, from: IsoDate, to: IsoDate) => !!d && d >= from && d <= to;

/**
 * Факты по задачам человека за неделю: закрытые (выполнена или частично), перенесённые и заблокированные.
 * Закрытое в понедельник после недели тоже считается: в понедельник лидеры обновляют задачи и сдают weekly
 */
export function taskFacts(tasks: FactTask[], me: PersonSlug, week: WeekRange): WeekFact[] {
  const until = addDays(week.end, PROMISE_GRACE_DAYS);
  const facts: WeekFact[] = [];
  for (const t of tasks) {
    if (t.archived || t.owner !== me) continue;
    if ((t.status === "done" || t.status === "partial") && inRange(t.closedAt, week.start, until)) {
      facts.push({
        key: `closed:${t.number}`,
        kind: "closed",
        type: "result",
        block: "key-changes",
        direction: t.direction,
        what: clipWhat(t.status === "done" ? t.title : `${t.title}: выполнена частично`),
        details: t.resolution || undefined,
        taskNumber: t.number,
      });
      continue;
    }
    const moved = t.transfers.filter((tr) => inRange(tr.at, week.start, until));
    if (moved.length && t.status !== "cancelled" && t.status !== "failed") {
      const first = moved[0]!;
      const last = moved[moved.length - 1]!;
      const from = first.from ? `с ${formatShort(first.from)} ` : "";
      facts.push({
        key: `moved:${t.number}:${last.to}`,
        kind: "moved",
        type: "risk",
        block: "risks",
        direction: t.direction,
        what: clipWhat(`Перенесли срок: ${t.title}`),
        details: `Срок ${from}на ${formatShort(last.to)}. Причина: ${last.reason}`,
        taskNumber: t.number,
      });
    }
    if (t.state === "blocked" && (t.status === "in-progress" || t.status === "clarify")) {
      facts.push({
        key: `blocked:${t.number}`,
        kind: "blocked",
        type: "risk",
        block: "risks",
        direction: t.direction,
        what: clipWhat(`Заблокирована: ${t.title}`),
        details: t.blockedBy || undefined,
        taskNumber: t.number,
      });
    }
  }
  return facts;
}

/** Выполненная просьба коллеги как факт недели */
export function requestFact(r: { number: number; text: string; author: string; closedAt: IsoDate; answer?: string | null }, direction: DirectionCode): WeekFact {
  return {
    key: `request:${r.number}`,
    kind: "request",
    type: "event",
    block: "team",
    direction,
    what: clipWhat(`Выполнили просьбу коллеги: ${r.text}`),
    details: `Просьба ${r.number} от ${r.author}${r.answer ? `. ${r.answer}` : ""}`,
  };
}

export const FACT_LABELS: Record<FactKind, string> = {
  closed: "Закрыто за неделю",
  moved: "Перенесён срок",
  blocked: "Заблокировано",
  request: "Просьба выполнена",
};
