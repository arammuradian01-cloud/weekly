// Правила просьб без базы (этап 21): когда просьба считается зависшей, когда напоминать.

import { addDays, type IsoDate } from "@/domain/dates";
import type { RequestStatusCode } from "@/domain/requests";

/** Просьба без ответа дольше 2 рабочих дней попадает на встречу */
export const STUCK_WORKING_DAYS = 2;
/** Предложенная задача без ответа 3 дня попадает на встречу */
export const PROPOSAL_STALE_DAYS = 3;
/** Автор напоминает о просьбе не чаще раза в сутки */
export const REMIND_GAP_MS = 20 * 60 * 60 * 1000;
export const REQUEST_TEXT_MAX = 500;
export const REQUEST_ANSWER_MAX = 500;

function weekday(iso: IsoDate): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** Сколько рабочих дней (понедельник-пятница) прошло после дня from по день to включительно. Праздники не учитываются */
export function workingDaysAfter(from: IsoDate, to: IsoDate): number {
  if (to <= from) return 0;
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) {
    const w = weekday(d);
    if (w !== 0 && w !== 6) n += 1;
  }
  return n;
}

/**
 * Зависла ли просьба: без ответа больше 2 рабочих дней или принята, но названный адресатом срок прошёл.
 * created: день создания по Москве
 */
export function isStuck(r: { status: RequestStatusCode; created: IsoDate; due: IsoDate; acceptedDue: IsoDate | null }, today: IsoDate): boolean {
  if (r.status === "open") return workingDaysAfter(r.created, today) > STUCK_WORKING_DAYS;
  if (r.status === "accepted") return (r.acceptedDue ?? r.due) < today;
  return false;
}

/** Срок, который действует сейчас, прошёл */
export function isRequestOverdue(r: { status: RequestStatusCode; due: IsoDate; acceptedDue: IsoDate | null }, today: IsoDate): boolean {
  return (r.status === "open" || r.status === "accepted") && (r.acceptedDue ?? r.due) < today;
}

/** Задача из просьбы: название одной мыслью до 120 знаков, по границе слова */
export function taskTitleFrom(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}
