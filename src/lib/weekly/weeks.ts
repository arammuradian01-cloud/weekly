// Ключи недель: неделю определяет её понедельник. Так нет путаницы на стыке лет, где номер ISO начинается заново.

import { addDays, fromCalendar, toCalendar, weekOf, type IsoDate } from "@/domain/dates";
import { moscowDateTime, reportingWeek, weeklyDeadline, type DeadlineSetting } from "@/lib/week";
import type { WeekKey } from "@/domain/types";

export type MeetingSetting = { weekday: number };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Понедельник недели, в которую попадает дата */
export function weekKeyOf(iso: IsoDate): WeekKey {
  return fromCalendar(weekOf(iso).start);
}

export function isWeekKey(value: unknown): value is WeekKey {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const d = toCalendar(value);
  const check = new Date(Date.UTC(d.year, d.month - 1, d.day));
  if (check.getUTCMonth() + 1 !== d.month || check.getUTCDate() !== d.day) return false;
  return weekKeyOf(value) === value;
}

export function weekNumberOf(key: WeekKey): number {
  return weekOf(key).week;
}

export function weekYearOf(key: WeekKey): number {
  return weekOf(key).year;
}

export function weekEndOf(key: WeekKey): IsoDate {
  return addDays(key, 6);
}

/** Отчётная неделя: за неё сейчас пишут weekly. Сменяется через сутки после срока сдачи */
export function reportingKey(now: Date, setting: DeadlineSetting): WeekKey {
  return fromCalendar(reportingWeek(now, setting).start);
}

export function deadlineOf(key: WeekKey, setting: DeadlineSetting): Date {
  return weeklyDeadline(weekOf(key), setting);
}

/** Встреча команды на следующей неделе в указанный день */
export function meetingOf(key: WeekKey, setting: MeetingSetting): IsoDate {
  return addDays(key, 7 + (setting.weekday - 1));
}

/** Неделя, к которой относится встреча: та, что закончилась перед ней */
export function weekKeyOfMeeting(meeting: IsoDate): WeekKey {
  return weekKeyOf(addDays(meeting, -7));
}

export function shiftWeek(key: WeekKey, weeks: number): WeekKey {
  return addDays(key, weeks * 7);
}

/**
 * Неделя встречи (этап 73б). Явно выбранная неделя остаётся, если она не позже отчётной. Без выбора, с неверной или
 * будущей неделей встреча открывается на неделе идущей встречи команды, иначе на отчётной. Идущую встречу берём только
 * за отчётную неделю или неделю до неё: забытая открытой старая встреча не уводит всех в прошлое
 */
export function meetingWeekKey(input: { now: Date; deadline: DeadlineSetting; requested?: unknown; live?: readonly WeekKey[] }): WeekKey {
  const reporting = reportingKey(input.now, input.deadline);
  if (isWeekKey(input.requested) && input.requested <= reporting) return input.requested;
  const earliest = shiftWeek(reporting, -1);
  const live = (input.live ?? []).filter((k) => isWeekKey(k) && k >= earliest && k <= reporting).sort();
  return live.at(-1) ?? reporting;
}

export { moscowDateTime };

/**
 * Сдача weekly за выбранную неделю (этап 76, строка «Не сдан weekly за неделю N» на «Моей неделе»). Пока экран сдачи
 * не знает параметр week (его добавляет этап 73), откроется отчётная неделя
 */
export function submitWeekHref(key: WeekKey): string {
  return `/weekly/submit?week=${key}`;
}
