// Карта сроков roadmap (этап 68). Задача на карте полосой от начала работы до срока, по месяцам. Полосу двигают
// целиком или тянут за края: левый край меняет начало (сразу, без причины), правый переносит срок (с причиной, как
// в карточке задачи), сдвиг целиком сохраняется одной правкой (moveTaskSpan). У задачи без начала полоса идёт от даты
// постановки, край помечен пунктиром. Полоса целиком за окном карты рисуется обрубком у края с подписью даты.
//
// Здесь только расчёт: диапазон месяцев, положение полосы, новая пара дат после перетаскивания и что сохранить.

import { addDays, diffDays, type IsoDate } from "@/domain/dates";
import type { DirectionCode } from "@/domain/dictionaries";
import type { Task } from "@/domain/types";
import { buildRoadmap, importanceOf, type RoadmapFilter } from "./roadmap";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

/** Месяцев на карте, считая текущий */
export const TIMELINE_MONTHS = 4;

export type TimelineMonth = { key: string; label: string; start: IsoDate; days: number; offset: number };
export type TimelineRange = { start: IsoDate; end: IsoDate; days: number; months: TimelineMonth[] };

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** С первого числа текущего месяца на TIMELINE_MONTHS месяцев вперёд */
export function timelineRange(today: IsoDate, count = TIMELINE_MONTHS): TimelineRange {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  const months: TimelineMonth[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const days = daysIn(year, month);
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    // Январь следующего года с годом: рядом с декабрём он иначе читается как прошлый
    months.push({ key: start.slice(0, 7), label: month === 1 && i > 0 ? `${MONTHS[0]} ${year}` : MONTHS[month - 1]!, start, days, offset });
    offset += days;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  const start = months[0]!.start;
  return { start, end: addDays(start, offset - 1), days: offset, months };
}

/** Начало задачи: своё, иначе дата постановки. Начало позже срока (старые данные) прижимается к сроку */
export function startOf(task: Pick<Task, "start" | "createdAt" | "due">): { date: IsoDate; known: boolean } {
  const date = (task.start ?? task.createdAt.slice(0, 10)) as IsoDate;
  return { date: date > task.due ? task.due : date, known: !!task.start };
}

export type Bar = {
  task: Task;
  start: IsoDate;
  end: IsoDate;
  startKnown: boolean;
  /** Номер дня диапазона, с которого полоса видна, и по который включительно */
  from: number;
  to: number;
  /** Полоса начинается раньше карты или кончается позже: край обрезан */
  cutStart: boolean;
  cutEnd: boolean;
  /** Полоса целиком за окном: before кончилась до первого дня карты, after начинается после последнего. Рисуется обрубком у края */
  outside: "before" | "after" | null;
  overdue: boolean;
  importance: 0 | 1 | 2;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function barOf(task: Task, range: TimelineRange, today: IsoDate, span?: { start: IsoDate; end: IsoDate }): Bar {
  const s = startOf(task);
  const start = span?.start ?? s.date;
  const end = span?.end ?? task.due;
  const a = diffDays(range.start, start);
  const b = diffDays(range.start, end);
  return {
    task,
    start,
    end,
    startKnown: s.known || !!span,
    from: clamp(a, 0, range.days - 1),
    to: clamp(b, 0, range.days - 1),
    cutStart: a < 0,
    cutEnd: b > range.days - 1,
    outside: b < 0 ? "before" : a > range.days - 1 ? "after" : null,
    overdue: end < today && task.status !== "proposed",
    importance: importanceOf(task.priority),
  };
}

export type DragMode = "move" | "start" | "end";

/**
 * Новая пара дат после перетаскивания на delta дней. Начало не позже срока, срок не раньше начала. Срок не уходит
 * в прошлое: сервер такой перенос не примет, поэтому полоса упирается в сегодня. У просроченной полосы (срок уже
 * прошёл) сдвиг целиком и срок двигаются только вправо и считаются от сегодня: срок на день позже сегодняшнего
 */
export function dragSpan(span: { start: IsoDate; end: IsoDate }, mode: DragMode, delta: number, today: IsoDate): { start: IsoDate; end: IsoDate } {
  if (mode === "start") {
    const start = addDays(span.start, delta);
    return { start: start > span.end ? span.end : start, end: span.end };
  }
  if (span.end < today) {
    if (delta <= 0) return span;
    const end = addDays(today, delta);
    return mode === "end" ? { start: span.start, end } : { start: addDays(span.start, diffDays(span.end, end)), end };
  }
  if (mode === "end") {
    let end = addDays(span.end, delta);
    if (end < span.start) end = span.start;
    if (end < today && end !== span.end) end = today < span.start ? span.start : today;
    return { start: span.start, end };
  }
  let shift = delta;
  const end = addDays(span.end, shift);
  if (end < today && end !== span.end) shift = diffDays(span.end, today);
  return { start: addDays(span.start, shift), end: addDays(span.end, shift) };
}

/**
 * Что сохранить после перетаскивания: start: одно начало, без причины; due: перенос срока с причиной; move: начало
 * и срок одной правкой с причиной (moveTaskSpan); null: ничего не поменялось
 */
export type SpanPlan = { kind: "start" | "due" | "move" | null; start: IsoDate; due: IsoDate };

export function spanPlan(before: { start: IsoDate; end: IsoDate }, after: { start: IsoDate; end: IsoDate }): SpanPlan {
  // Начало без своей даты (от постановки) сохраняется, только если его сдвинули: иначе задача остаётся «без начала»
  const startMoved = after.start !== before.start;
  const dueMoved = after.end !== before.end;
  const kind = startMoved && dueMoved ? "move" : startMoved ? "start" : dueMoved ? "due" : null;
  return { kind, start: after.start, due: after.end };
}

export type TimelineRow = { direction: DirectionCode; label: string; bars: Bar[]; important: number };

/** Строки по направлениям, как на доске: те же задачи и фильтры. Внутри по началу, потом по сроку и номеру */
export function buildTimeline(tasks: Task[], today: IsoDate, filter: RoadmapFilter, directions: { code: string; label: string }[], range = timelineRange(today)): { range: TimelineRange; rows: TimelineRow[]; total: number } {
  const board = buildRoadmap(tasks, today, filter, directions);
  const rows = board.rows.map((r) => {
    const bars = Object.values(r.cells)
      .flat()
      .map((t) => barOf(t, range, today))
      .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.task.number - b.task.number);
    return { direction: r.direction, label: r.label, bars, important: r.important };
  });
  return { range, rows, total: board.total };
}
