// Отчёт CEO 2.0 (этап 27): текст отчёта для копирования и письма, встречи недели. Чистые функции: их считают
// и экран, и тесты. Порядок разделов по ТЗ: цифры недели, главное, решения недели, риски, что дальше, благодарности,
// мои встречи недели.

import { cleanDash } from "@/lib/weekly/rules";

/** Встреча недели: о какой встрече и что важно CEO, 4-5 предложений от первого лица */
export type CeoMeeting = { title: string; text: string };

export const MEETINGS_MAX = 12;
export const MEETING_TITLE_MAX = 120;
export const MEETING_TEXT_MAX = 3000;

/** Встречи из формы или базы: только строки, длина ограничена, длинное тире заменено, пустые убраны */
export function cleanMeetings(input: unknown): CeoMeeting[] {
  if (!Array.isArray(input)) return [];
  const out: CeoMeeting[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const title = cleanDash(typeof r.title === "string" ? r.title : "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MEETING_TITLE_MAX);
    const text = cleanDash(typeof r.text === "string" ? r.text : "")
      .trim()
      .slice(0, MEETING_TEXT_MAX);
    if (!title && !text) continue;
    out.push({ title, text });
    if (out.length >= MEETINGS_MAX) break;
  }
  return out;
}

/** Сколько предложений в тексте: для подсказки «4-5 предложений». Сокращения вроде «т. е.» могут прибавить одно */
export function countSentences(text: string): number {
  return text
    .split(/[.!?…]+(?:\s|$)/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-zА-Яа-яЁё0-9]/.test(s)).length;
}

export type CeoDecisionLine = { text: string; owner: string | null };

export type CeoTextInput = {
  weekNumber: number;
  numbers: string[];
  forecast?: string[];
  promises?: string;
  main: string;
  decisions: CeoDecisionLine[];
  risks: string;
  next: string;
  thanks: { name: string; text: string }[];
  meetings: CeoMeeting[];
};

/** Весь отчёт одним текстом: для копирования и письма */
export function ceoReportText(r: CeoTextInput): string {
  const block = (title: string, lines: string[]) => [title, ...(lines.length ? lines : ["-"]), ""];
  return [
    `Отчёт за неделю ${r.weekNumber}`,
    "",
    ...block("Цифры недели", r.numbers),
    ...(r.forecast?.length ? block("Прогноз до конца месяца", r.forecast) : []),
    ...(r.promises ? block("Обещания недели", [r.promises]) : []),
    ...block("Главное за неделю", r.main.trim() ? [r.main.trim()] : []),
    ...(r.decisions.length ? block("Решения недели", r.decisions.map((d) => `- ${d.text}${d.owner ? `. Владелец: ${d.owner}` : ""}`)) : []),
    ...block("Риски", r.risks.trim() ? [r.risks.trim()] : []),
    ...block("Что дальше", r.next.trim() ? [r.next.trim()] : []),
    ...(r.thanks.length ? block("Благодарности", r.thanks.map((t) => `- ${t.name}: ${t.text}`)) : []),
    ...(r.meetings.length ? block("Мои встречи недели", r.meetings.flatMap((m, i) => [...(i ? [""] : []), m.title || "Встреча", m.text || "-"])) : []),
  ]
    .join("\n")
    .trimEnd();
}

/**
 * Самый длинный адрес письма, который открывают целиком все почтовые программы, включая Outlook на Windows (около 2 000
 * знаков). Русская буква в адресе занимает 6 знаков, поэтому целиком уходит только короткий отчёт. Длиннее: текст
 * кладётся в буфер обмена, письмо открывается с темой и подсказкой вставить текст
 */
export const MAILTO_MAX = 1900;

/** Текст письма, когда отчёт в адрес не влезает */
export const MAIL_PASTE_HINT = "Полный текст отчёта скопирован в буфер обмена: вставьте его сюда.";

/** Черновик письма: тема и текст. Строки через CRLF, как требует формат mailto. null: текст слишком длинный */
export function mailtoHref(subject: string, body: string, max = MAILTO_MAX): string | null {
  const href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\r?\n/g, "\r\n"))}`;
  return href.length <= max ? href : null;
}
