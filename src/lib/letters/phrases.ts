// Тексты событий «Мне» для писем и уведомлений в браузере: кто и что, без содержимого (этапы 20 и 26). Чистые функции.

import type { InboxKind } from "@/generated/prisma/enums";

export type EventLine = { kind: InboxKind; actorName: string | null; taskNumber: number | null; entryId: string | null; commentId: string | null; requestNumber?: number | null; subject?: string };

/** Одна строка письма о событии: кто и что, без содержимого. Без глаголов с родом: «Рева Тарас: упоминание в задаче 47» */
export function eventPhrase(e: EventLine): string {
  const who = e.actorName ? `${e.actorName}: ` : "";
  const n = e.taskNumber ? ` ${e.taskNumber}` : "";
  switch (e.kind) {
    case "TASK_ASSIGNED":
      return `${who}вам поручена задача${n}`;
    case "TASK_PROPOSED":
      return `${who}предложение задачи${n}`;
    case "TASK_CONFIRMED":
      return `${who}задача${n} подтверждена`;
    case "TASK_COEXECUTOR":
      return `${who}вы соисполнитель в задаче${n}`;
    case "TASK_COMMENT":
      return `${who}комментарий в задаче${n}`;
    case "TASK_DUE":
      return `Срок по задаче${n}`;
    case "UPDATE_REQUEST":
      return `${who}просьба обновить задачу${n}`;
    case "TASK_WATCH":
      return `${who}изменения в задаче${n}, за которой вы следите`;
    case "MENTION":
      return e.entryId ? `${who}упоминание в записи weekly` : `${who}упоминание в задаче${n}`;
    case "ENTRY_COMMENT":
      return `${who}комментарий к записи weekly`;
    case "REACTION":
      return e.entryId ? `${who}реакция на ${e.commentId ? "ваш комментарий к записи weekly" : "вашу запись weekly"}` : `${who}реакция на ваш комментарий в задаче${n}`;
    case "REQUEST":
      return `${who}просьба к вам`;
    case "THANKS":
      return `${who}благодарность в weekly`;
    case "MEETING":
      return `${who}встреча: протокол или решение`;
    case "TASK_DEPENDENCY":
      return `${who}изменения по связанной задаче${n}`;
    case "REQUEST_ANSWER":
      return `${who}изменения по просьбе`;
    case "ONE_ON_ONE":
      return `${who}встреча один на один`;
    default:
      return `${who}новое событие`;
  }
}

/** Адрес предмета события внутри ресурса: просьба, задача, запись weekly или «Мне» */
export function pathOf(e: { taskNumber: number | null; entryId: string | null; requestNumber?: number | null; subject?: string }): string {
  // Встреча один на один (этап 28): страница пары откроется только у её участника
  if (e.subject?.startsWith("1on1:")) return `/one-on-one?pair=${encodeURIComponent(e.subject.slice(5))}`;
  if (e.requestNumber) return `/requests/${e.requestNumber}`;
  if (e.taskNumber) return `/tasks/${e.taskNumber}`;
  if (e.entryId) return `/weekly/entry/${e.entryId}`;
  return "/me";
}

/** Склонение по числу: 1 событие, 2 события, 5 событий */
export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}
