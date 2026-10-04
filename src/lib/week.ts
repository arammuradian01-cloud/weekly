// Недели по ISO, время везде московское (раздел 3 ТЗ: неделя с понедельника по воскресенье).

export const TIME_ZONE = "Europe/Moscow";
const DAY_MS = 24 * 60 * 60 * 1000;

export type CalendarDate = { year: number; month: number; day: number };

/** Календарная дата в Москве для момента времени */
export function moscowDate(at: Date): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Момент времени для московской даты и времени. Москва живёт в UTC+3 без перехода на летнее время */
export function moscowDateTime(date: CalendarDate, hours = 0, minutes = 0): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, hours - 3, minutes));
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** День недели по ISO: 1 понедельник, 7 воскресенье */
export function isoWeekday(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() || 7;
}

export type IsoWeek = {
  year: number;
  week: number;
  /** Понедельник и воскресенье недели */
  start: CalendarDate;
  end: CalendarDate;
};

export function isoWeekOf(date: CalendarDate): IsoWeek {
  const weekday = isoWeekday(date);
  const thursday = addDays(date, 4 - weekday);
  const yearStart = Date.UTC(thursday.year, 0, 1);
  const thursdayMs = Date.UTC(thursday.year, thursday.month - 1, thursday.day);
  const week = Math.ceil(((thursdayMs - yearStart) / DAY_MS + 1) / 7);
  return {
    year: thursday.year,
    week,
    start: addDays(date, 1 - weekday),
    end: addDays(date, 7 - weekday),
  };
}

export type DeadlineSetting = { weekday: number; time: string };

/** Срок сдачи weekly за неделю: указанный день следующей недели в указанное время */
export function weeklyDeadline(week: IsoWeek, setting: DeadlineSetting): Date {
  const [h, m] = setting.time.split(":").map(Number);
  const day = addDays(week.start, 7 + (setting.weekday - 1));
  return moscowDateTime(day, h, m);
}

/**
 * Отчётная неделя: та, за которую сейчас пишут weekly.
 * Она сменяется через сутки после срока сдачи, то есть после встречи во вторник.
 */
export function reportingWeek(now: Date, setting: DeadlineSetting): IsoWeek {
  const current = isoWeekOf(moscowDate(now));
  const previous = isoWeekOf(addDays(current.start, -7));
  const previousDeadline = weeklyDeadline(previous, setting);
  return now.getTime() < previousDeadline.getTime() + DAY_MS ? previous : current;
}

const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
export const WEEKDAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function formatDay(date: CalendarDate): string {
  return `${date.day} ${MONTHS_GENITIVE[date.month - 1]}`;
}

export function formatWeekRange(week: IsoWeek): string {
  return `${formatDay(week.start)} - ${formatDay(week.end)}`;
}

export function formatMoment(at: Date): string {
  const date = moscowDate(at);
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  return `${WEEKDAYS[isoWeekday(date) - 1]}, ${formatDay(date)}, ${time}`;
}

export function formatDateTime(at: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(at);
}

export function formatTime(at: Date): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(at);
}

/** «2 д 4 ч», «5 ч 12 мин», «18 мин» */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
}

/** Приветствие по московскому времени */
export function greeting(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", hour12: false }).format(now));
  if (hour < 5) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}
