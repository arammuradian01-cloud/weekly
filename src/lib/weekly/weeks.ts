// Ключи недель: неделю определяет её понедельник. Так нет путаницы на стыке лет, где номер ISO начинается заново.

import { addDays, fromCalendar, toCalendar, weekOf, type IsoDate } from "@/prototype/dates";
import { moscowDateTime, reportingWeek, weeklyDeadline, type DeadlineSetting } from "@/lib/week";
import type { WeekKey } from "@/prototype/types";

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

export { moscowDateTime };
