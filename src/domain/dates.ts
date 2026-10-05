// Даты на экранах хранятся строкой ГГГГ-ММ-ДД по Москве: так одинаково считаются и на сервере, и в браузере.

import { isoWeekOf, type CalendarDate, type IsoWeek } from "@/lib/week";

export type IsoDate = string;

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const WEEKDAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function toCalendar(iso: IsoDate): CalendarDate {
  const [year, month, day] = iso.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

export function fromCalendar(d: CalendarDate): IsoDate {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

function utc(iso: IsoDate): number {
  const d = toCalendar(iso);
  return Date.UTC(d.year, d.month - 1, d.day);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const d = new Date(utc(iso) + days * DAY_MS);
  return fromCalendar({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
}

/** Сколько дней от a до b: положительное, если b позже */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((utc(b) - utc(a)) / DAY_MS);
}

export function weekOf(iso: IsoDate): IsoWeek {
  return isoWeekOf(toCalendar(iso));
}

export function weekdayShort(iso: IsoDate): string {
  const day = new Date(utc(iso)).getUTCDay() || 7;
  return WEEKDAYS_SHORT[day - 1]!;
}

/** «5 окт» */
export function formatShort(iso: IsoDate): string {
  const d = toCalendar(iso);
  return `${d.day} ${MONTHS_SHORT[d.month - 1]}`;
}

/** «5 октября» */
export function formatLong(iso: IsoDate): string {
  const d = toCalendar(iso);
  return `${d.day} ${MONTHS_GENITIVE[d.month - 1]}`;
}

/** «вчера», «3 дн. назад», «сегодня» относительно today */
export function formatAgo(iso: IsoDate, today: IsoDate): string {
  const days = diffDays(iso, today);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  return `${days} дн. назад`;
}

/** Склонение: 1 день, 2 дня, 5 дней */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
