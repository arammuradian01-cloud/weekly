// Анонимная оценка встреч раз в месяц (этап 29): правила без базы.
//
// - оценивают участники команды, кроме руководителя: «насколько полезны встречи, от 1 до 5» и «что убрать»;
// - оценка за месяц открыта весь месяц и ещё 7 дней следующего: кто встречается в конце месяца, успеет ответить;
// - итог виден руководителю команды и руководству после закрытия опроса. Пока опрос идёт, видно только число
//   ответов: по тому, как меняется итог, можно было бы угадать, кто ответил;
// - при ответах меньше трёх итог не показывается вовсе, комментарии тоже: иначе автора легко угадать;
// - кто ответил, записано отдельно. Сами ответы складываются в урну: одна строка на команду и месяц, где только
//   сколько раз поставили каждую оценку и тексты в случайном порядке. Отдельного ответа в базе нет;
// - тот, кто смотрит итог и сам ответил, видит его от четырёх ответов: свой ответ он знает;
// - комментарии показываются по алфавиту.

import type { IsoDate } from "@/domain/dates";
import { cleanTopic } from "@/lib/one-on-one/rules";

/** Месяц вида 2026-10 */
export type Month = string;

/** Меньше ответов: итога и комментариев нет */
export const RATING_MIN = 3;
export const REMOVE_MAX = 500;
/** Сколько дней следующего месяца ещё можно оценить прошлый */
export const GRACE_DAYS = 7;
/** С какого числа на главной напоминание оценить текущий месяц */
export const PROMPT_FROM_DAY = 20;
/** Сколько закрытых месяцев показывать в итогах */
export const HISTORY_MONTHS = 6;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const NOMINATIVE = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const GENITIVE = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export function isMonth(value: unknown): value is Month {
  return typeof value === "string" && MONTH.test(value);
}

export function monthOf(today: IsoDate): Month {
  return today.slice(0, 7);
}

export function shiftMonth(month: Month, by: number): Month {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const dayOf = (today: IsoDate) => Number(today.slice(8, 10));

/** Открытые для ответа месяцы: текущий, а в первые дни месяца ещё и прошлый (он первым) */
export function openMonths(today: IsoDate): Month[] {
  const current = monthOf(today);
  return dayOf(today) <= GRACE_DAYS ? [shiftMonth(current, -1), current] : [current];
}

export function isOpen(month: Month, today: IsoDate): boolean {
  return openMonths(today).includes(month);
}

/** Последний день, когда можно ответить за месяц */
export function closesOn(month: Month): IsoDate {
  return `${shiftMonth(month, 1)}-${String(GRACE_DAYS).padStart(2, "0")}`;
}

/** Итог за месяц виден со следующего дня после закрытия опроса */
export function resultsVisible(month: Month, today: IsoDate): boolean {
  return today > closesOn(month);
}

/** О каком месяце напомнить на главной: в конце месяца о текущем, в первые дни о прошлом */
export function promptMonth(today: IsoDate): Month | null {
  const day = dayOf(today);
  if (day <= GRACE_DAYS) return shiftMonth(monthOf(today), -1);
  if (day >= PROMPT_FROM_DAY) return monthOf(today);
  return null;
}

/** «октябрь 2026» */
export function monthLabel(month: Month): string {
  const [y, m] = month.split("-").map(Number);
  return `${NOMINATIVE[m - 1]} ${y}`;
}

/** «7 ноября» */
export function dayLabel(iso: IsoDate): string {
  return `${Number(iso.slice(8, 10))} ${GENITIVE[Number(iso.slice(5, 7)) - 1]}`;
}

export function cleanRemove(text: unknown): string {
  return cleanTopic(text, REMOVE_MAX);
}

export function validScore(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

export type RatingSummary = {
  answered: number;
  /** Итог скрыт: ответов меньше трёх (или меньше четырёх, если среди них ответ того, кто смотрит) */
  hidden: boolean;
  /** Средняя с одним знаком; null, если итог скрыт */
  average: number | null;
  /** Сколько раз поставили 1, 2, 3, 4 и 5 */
  counts: number[] | null;
  /** Ответы «что убрать»: непустые, по алфавиту */
  remove: string[];
};

/** Урна за месяц: сколько раз поставили каждую оценку и ответы «что убрать» */
export type RatingBox = { counts: number[]; remove: string[] };

export const EMPTY_BOX: RatingBox = { counts: [0, 0, 0, 0, 0], remove: [] };

/** Сколько ответов в урне */
export function boxTotal(box: RatingBox): number {
  return [0, 1, 2, 3, 4].reduce((s, i) => s + Math.max(0, Number(box.counts[i] ?? 0)), 0);
}

/**
 * Новый ответ в урну: к счётчику оценки прибавляется один, текст встаёт в случайное место списка. Так порядок
 * текстов не выдаёт, кто ответил раньше. random: число от 0 до 1, как Math.random
 */
export function addToBox(box: RatingBox, score: number, remove: string, random: () => number = Math.random): RatingBox {
  const counts = [0, 1, 2, 3, 4].map((i) => Math.max(0, Number(box.counts[i] ?? 0)));
  counts[score - 1] += 1;
  const list = [...box.remove];
  const text = remove.trim();
  if (text) list.splice(Math.min(list.length, Math.floor(random() * (list.length + 1))), 0, text);
  return { counts, remove: list };
}

/**
 * Итог урны. selfVoted: тот, кто смотрит, сам ответил. Свой ответ он знает, поэтому для него порог на один выше:
 * иначе из трёх ответов неизвестными остались бы два
 */
export function summarize(box: RatingBox, opts: { selfVoted?: boolean } = {}): RatingSummary {
  const counts = [0, 1, 2, 3, 4].map((i) => Math.max(0, Number(box.counts[i] ?? 0)));
  const answered = counts.reduce((s, n) => s + n, 0);
  if (answered < RATING_MIN + (opts.selfVoted ? 1 : 0)) return { answered, hidden: true, average: null, counts: null, remove: [] };
  const average = Math.round((counts.reduce((s, n, i) => s + n * (i + 1), 0) / answered) * 10) / 10;
  const remove = box.remove
    .map((r) => r.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ru"));
  return { answered, hidden: false, average, counts, remove };
}

/** Кто оценивает встречи команды: участники, кроме руководителя */
export function ratersOf(node: { leaderId: string | null; members: string[] }): string[] {
  return [...new Set(node.members.filter((m) => m !== node.leaderId))];
}
