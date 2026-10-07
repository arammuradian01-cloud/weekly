// Когда и какие письма (этап 20). Чистые функции без базы.
//
// - Рабочие часы 9:00-20:00 по Москве с понедельника по пятницу. Вне них письма копятся и уходят утренней сводкой.
// - Адресное событие уходит письмом, если его не увидели в ресурсе за 15 минут.
// - Напоминание о сдаче: за 6 часов до своего срока (при сроке в понедельник в 18:00 это 12:00) и за час (17:00).
//   Не больше двух за неделю, после срока не напоминаем.
// - Дайджест в день встречи в 9:00.

import type { InboxKind } from "@/generated/prisma/enums";
import { moscowDate, moscowDateTime, isoWeekday } from "@/lib/week";

export const WORK_HOURS = { start: 9, end: 20 };
/** Через сколько непрочитанное событие уходит письмом */
export const EVENT_DELAY_MS = 15 * 60_000;
/** События старше этого письмом не уходят: после долгого простоя не засыпаем людей старым */
export const EVENT_MAX_AGE_MS = 72 * 3_600_000;
export const REMIND_BEFORE_MS = [6 * 3_600_000, 3_600_000] as const;
/** Второе напоминание не раньше чем через час после первого: при раннем сроке приходит одно */
export const REMIND_GAP_MS = 3_600_000;

/** Какие письма человек получает. По умолчанию все: адресные события, напоминания о сдаче и дайджест */
export type MailPrefs = { tasks: boolean; mentions: boolean; reactions: boolean; reminders: boolean; digest: boolean };
export type MailPrefKey = keyof MailPrefs;

export const DEFAULT_PREFS: MailPrefs = { tasks: true, mentions: true, reactions: true, reminders: true, digest: true };

export const PREF_LABELS: Record<MailPrefKey, { title: string; hint: string }> = {
  tasks: { title: "Задачи и просьбы", hint: "Вам поставили, передали или предложили задачу, прокомментировали её, просят обновить, изменилась задача, за которой вы следите. Просьбы коллег к вам и ответы на ваши просьбы" },
  mentions: { title: "Упоминания и обсуждения", hint: "Вас упомянули, прокомментировали вашу запись weekly или обсуждение, в котором вы участвуете" },
  reactions: { title: "Реакции", hint: "Отреагировали на вашу запись или комментарий: «Принято», «Вопрос», «Обсудить на встрече», «Спасибо»" },
  reminders: { title: "Напоминания о сдаче weekly", hint: "За 6 часов и за час до вашего срока, если weekly ещё не сдан. Не больше двух в неделю" },
  digest: { title: "Дайджест в день встречи", hint: "В 9:00: сколько ждёт вас в «Мне», вопросы к встрече, кто из ваших команд не сдал weekly" },
};

export function prefsOf(value: unknown): MailPrefs {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const out = { ...DEFAULT_PREFS };
  for (const key of Object.keys(DEFAULT_PREFS) as MailPrefKey[]) if (typeof raw[key] === "boolean") out[key] = raw[key] as boolean;
  return out;
}

/** К какой настройке относится событие «Мне» */
export function prefOfKind(kind: InboxKind): MailPrefKey {
  if (kind === "MENTION" || kind === "ENTRY_COMMENT") return "mentions";
  if (kind === "REACTION") return "reactions";
  return "tasks";
}

/** Рабочее ли сейчас время по Москве */
export function inWorkHours(now: Date): boolean {
  const day = moscowDate(now);
  if (isoWeekday(day) > 5) return false;
  const start = moscowDateTime(day, WORK_HOURS.start).getTime();
  const end = moscowDateTime(day, WORK_HOURS.end).getTime();
  return now.getTime() >= start && now.getTime() < end;
}

/** Событие пришло вне рабочего времени: письмо о нём будет утренней сводкой */
export function outsideWorkHours(at: Date): boolean {
  return !inWorkHours(at);
}

/**
 * Какое напоминание о сдаче пора отправить: 1, 2 или null. deadline: свой срок человека за неделю.
 * Первое за 6 часов до срока, но не раньше начала рабочего дня, второе за час до срока и не раньше чем через час после первого
 */
export function reminderDue(now: Date, deadline: Date, sent: { first: Date | null; second: Date | null }): 1 | 2 | null {
  const t = now.getTime();
  const end = deadline.getTime();
  if (t >= end || !inWorkHours(now)) return null;
  if (!sent.first) return t >= end - REMIND_BEFORE_MS[0] ? 1 : null;
  if (sent.second) return null;
  if (t < end - REMIND_BEFORE_MS[1]) return null;
  return t - sent.first.getTime() >= REMIND_GAP_MS ? 2 : null;
}

/** Пора ли отправить дайджест: день встречи, с 9:00 и до полудня. Позже не шлём: встреча уже идёт */
export function digestDue(now: Date, meeting: { year: number; month: number; day: number }): boolean {
  const t = now.getTime();
  return t >= moscowDateTime(meeting, WORK_HOURS.start).getTime() && t < moscowDateTime(meeting, 12).getTime() && inWorkHours(now);
}
