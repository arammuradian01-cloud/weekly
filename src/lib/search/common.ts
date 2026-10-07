// Общий поиск без базы (этап 25): типы результатов, запрос к словарю, маркеры подсветки. Нужен и серверу, и экранам

import type { IsoDate } from "@/domain/dates";
import type { WeekKey } from "@/domain/types";

export const SEARCH_MIN = 2;
export const SEARCH_MAX = 200;

export type SearchHit =
  | { kind: "task"; number: number; title: string; snippet: string; status: string; due: IsoDate; owner: string | null; closed: boolean }
  | { kind: "entry"; id: string; week: WeekKey; weekNumber: number; author: string | null; snippet: string; what: string }
  | { kind: "comment"; id: string; snippet: string; author: string; task?: { number: number; title: string }; entry?: { id: string; week: WeekKey; what: string } }
  | { kind: "decision"; id: string; snippet: string; text: string; date: IsoDate; status: "active" | "cancelled"; owner: string | null }
  | { kind: "person"; slug: string; fullName: string; position: string | null; snippet: string };

export type SearchResult = { query: string; hits: SearchHit[]; total: number; truncated: boolean };

/** Маркеры найденных слов в отрывке: экран подсвечивает текст между ними */
export const MARK_START = "\u0001";
export const MARK_END = "\u0002";

/**
 * Запрос к словарю из того, что набрал человек: слова через «и», последнее по началу, если в нём хоть 3 знака.
 * Ничего, кроме букв и цифр, в запрос не попадает: так в to_tsquery не уходят операторы
 */
export function tsQueryOf(raw: string): string {
  const words = raw
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  if (!words.length) return "";
  return words.map((w, i) => (i === words.length - 1 && w.length >= 3 ? `${w}:*` : w)).join(" & ");
}

/** Номер задачи, если ищут по нему: «47» или «#47» */
export function taskNumberOf(raw: string): number | null {
  const m = /^#?(\d{1,7})$/.exec(raw.trim());
  return m ? Number(m[1]) : null;
}

/** Текст без маркеров: для подписи и для тех экранов, где подсветка не нужна */
export function plainSnippet(s: string): string {
  return s.split(MARK_START).join("").split(MARK_END).join("");
}

/** Ключ результата для списков */
export function hitId(h: SearchHit): string {
  return h.kind === "task" ? `task-${h.number}` : h.kind === "person" ? `person-${h.slug}` : `${h.kind}-${h.id}`;
}

/** Куда ведёт результат */
export function hitHref(h: SearchHit): string {
  switch (h.kind) {
    case "task":
      return `/tasks/${h.number}`;
    case "entry":
      return `/weekly/entry/${h.id}`;
    case "comment":
      return h.task ? `/tasks/${h.task.number}` : `/weekly/entry/${h.entry!.id}`;
    case "decision":
      return `/decisions?q=${encodeURIComponent(h.text.slice(0, 60))}`;
    case "person":
      return `/tasks?owner=${encodeURIComponent(h.slug)}`;
  }
}
