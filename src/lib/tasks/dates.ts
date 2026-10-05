// Даты задач. Срок и дата встречи хранятся в базе как DATE без часового пояса,
// время событий как момент, который показываем по Москве.

import { TIME_ZONE, moscowDate } from "@/lib/week";
import { fromCalendar, type IsoDate } from "@/domain/dates";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** DATE из базы приходит полночью UTC: берём его календарные части как есть */
export function isoFromDbDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function dbDate(iso: IsoDate): Date {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new Error(`Дата не в формате ГГГГ-ММ-ДД: ${iso}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (isoFromDbDate(d) !== iso) throw new Error(`Такой даты нет: ${iso}`);
  return d;
}

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  try {
    dbDate(value);
    return true;
  } catch {
    return false;
  }
}

/** Сегодня по Москве */
export function moscowToday(now = new Date()): IsoDate {
  return fromCalendar(moscowDate(now));
}

/** Календарный день момента по Москве */
export function moscowIso(at: Date): IsoDate {
  return fromCalendar(moscowDate(at));
}

export function moscowTime(at: Date): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(at);
}

/** «23.09.2026» из таблицы в ISO */
export function isoFromRuDate(value: string): IsoDate | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}
