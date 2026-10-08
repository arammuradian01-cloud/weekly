// Календарь сроков (этап 29): файл iCalendar (RFC 5545) без базы. Его забирают Google, Яндекс и Outlook по личной
// ссылке. Правила формата: строки через CRLF, длиннее 75 байт переносятся с пробелом в начале продолжения,
// в тексте экранируются обратная косая черта, точка с запятой, запятая и перенос строки.

import type { IsoDate } from "@/domain/dates";

export type CalEvent = {
  /** Постоянный ключ события: по нему календарь узнаёт событие при следующей загрузке */
  uid: string;
  summary: string;
  description?: string;
  url?: string;
  /** Событие на весь день */
  date?: IsoDate;
  /** Или момент начала и длительность в минутах */
  start?: Date;
  minutes?: number;
};

const CRLF = "\r\n";

/**
 * Текст свойства: экранирование по RFC 5545. Управляющие символы, кроме переноса строки и табуляции, в тексте
 * запрещены: из-за одного такого символа в названии задачи Google отбросил бы весь календарь
 */
export function escapeText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Перенос длинной строки: не больше 75 байт в строке, многобайтные буквы не разрезаются */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, "utf8");
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
      // Продолжение начинается с пробела: он тоже считается
      limit = 74;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join(`${CRLF} `);
}

/** Дата для события на весь день: 20261009 */
export function icsDate(iso: IsoDate): string {
  return iso.replace(/-/g, "");
}

/** Момент в UTC: 20261009T150000Z */
export function icsMoment(at: Date): string {
  return at
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

function nextDay(iso: IsoDate): IsoDate {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10) as IsoDate;
}

/** Ссылка без управляющих символов: в свойство URL текст не экранируется */
function safeUrl(url: string): string {
  return url.replace(/[\u0000-\u001f\u007f]/g, "");
}

export function eventLines(e: CalEvent, stamp: Date): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${escapeText(e.uid)}`, `DTSTAMP:${icsMoment(stamp)}`];
  if (e.date) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(e.date)}`, `DTEND;VALUE=DATE:${icsDate(nextDay(e.date))}`);
  } else if (e.start) {
    const end = new Date(e.start.getTime() + (e.minutes ?? 30) * 60_000);
    lines.push(`DTSTART:${icsMoment(e.start)}`, `DTEND:${icsMoment(end)}`);
  }
  lines.push(`SUMMARY:${escapeText(e.summary)}`);
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.url) lines.push(`URL:${safeUrl(e.url)}`);
  // Сроки и встречи не занимают время в календаре: встреча команды обычно уже стоит в рабочем календаре
  lines.push("TRANSP:TRANSPARENT", "STATUS:CONFIRMED", "END:VEVENT");
  return lines;
}

/** Весь файл календаря */
export function buildIcs(events: CalEvent[], opts: { name: string; description?: string; stamp: Date }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sravni//Weekly//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    "X-WR-TIMEZONE:Europe/Moscow",
    ...(opts.description ? [`X-WR-CALDESC:${escapeText(opts.description)}`] : []),
    // Просьба к календарю забирать обновления раз в час. Google решает сам, обычно раз в несколько часов
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...events.flatMap((e) => eventLines(e, opts.stamp)),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}
