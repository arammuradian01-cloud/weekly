// Шкала готовности крупных инициатив (этап 30): правила без базы.
//
// - инициатив немного, 10-15 больших дел департамента. Заводит и закрывает их владелец или администратор в режиме
//   управления, у каждой один ответственный лидер;
// - шкала из двух делений: «Ещё ищем, как сделать» и «Уже делаем». Деление ставит ответственный, при смене пишет одну
//   фразу: в поиске что ещё не ясно, в работе что делаем и когда первый результат;
// - инициатива ищет, как сделать, дольше 4 недель или без новостей дольше 14 дней: её видно на странице и она сама
//   встаёт в повестку встречи команды ответственного.

import { cleanTopic } from "@/lib/one-on-one/rules";
import type { InitiativeResult, InitiativeState } from "@/generated/prisma/enums";

export const TITLE_MAX = 120;
export const WHY_MAX = 500;
export const NOTE_MAX = 300;
/** Больше активных инициатив шкала теряет смысл: это уже список задач */
export const SOFT_MAX = 15;
/** Ищем, как сделать, дольше этого: пора разобрать на встрече */
export const LONG_SEARCH_DAYS = 28;
/** Без новостей дольше этого: заметку давно не обновляли */
export const STALE_DAYS = 14;

const DAY_MS = 86_400_000;

export type StateCode = "searching" | "doing";
export type ResultCode = "done" | "dropped";

export const STATE_CODE: Record<InitiativeState, StateCode> = { SEARCHING: "searching", DOING: "doing" };
export const STATE_DB: Record<StateCode, InitiativeState> = { searching: "SEARCHING", doing: "DOING" };
export const RESULT_CODE: Record<InitiativeResult, ResultCode> = { DONE: "done", DROPPED: "dropped" };
export const RESULT_DB: Record<ResultCode, InitiativeResult> = { done: "DONE", dropped: "DROPPED" };

export const STATE_LABELS: Record<StateCode, string> = {
  searching: "Ещё ищем, как сделать",
  doing: "Уже делаем",
};

export const RESULT_LABELS: Record<ResultCode, string> = { done: "Сделали", dropped: "Сняли" };

/** Подсказка к заметке: что написать при этом делении шкалы */
export const NOTE_PROMPTS: Record<StateCode, string> = {
  searching: "Что ещё не ясно и что нужно, чтобы начать",
  doing: "Что делаем и когда первый результат",
};

export function isStateCode(value: unknown): value is StateCode {
  return value === "searching" || value === "doing";
}

export function isResultCode(value: unknown): value is ResultCode {
  return value === "done" || value === "dropped";
}

export function cleanTitle(text: unknown): string {
  return cleanTopic(text, TITLE_MAX);
}

export function cleanWhy(text: unknown): string {
  return cleanTopic(text, WHY_MAX);
}

export function cleanNote(text: unknown): string {
  return cleanTopic(text, NOTE_MAX);
}

/** Полных дней между моментами */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

/** «меньше недели», «1 неделю», «3 недели», «5 недель» */
export function weeksText(days: number): string {
  const w = Math.floor(days / 7);
  if (w < 1) return "меньше недели";
  const m10 = w % 10;
  const m100 = w % 100;
  const word = m10 === 1 && m100 !== 11 ? "неделю" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "недели" : "недель";
  return `${w} ${word}`;
}

export type Flags = { longSearch: boolean; stale: boolean; searchDays: number; staleDays: number };

/** Что требует внимания: долго ищем или давно без новостей. У закрытой инициативы ничего */
export function flagsOf(i: { state: StateCode; stateSince: Date; noteAt: Date; closed: boolean }, now: Date): Flags {
  const searchDays = i.state === "searching" ? daysBetween(i.stateSince, now) : 0;
  const staleDays = daysBetween(i.noteAt, now);
  if (i.closed) return { longSearch: false, stale: false, searchDays, staleDays };
  return { longSearch: i.state === "searching" && searchDays > LONG_SEARCH_DAYS, stale: staleDays > STALE_DAYS, searchDays, staleDays };
}

/** Пункт повестки: вопросом, как остальные пункты. null: обсуждать нечего */
export function agendaTitle(title: string, flags: Flags): string | null {
  if (flags.longSearch) return `Инициатива «${title}» ищет, как сделать, уже ${weeksText(flags.searchDays)}. Что мешает начать?`;
  if (flags.stale) return `Инициатива «${title}» без новостей ${flags.staleDays} дн. Где она сейчас?`;
  return null;
}
