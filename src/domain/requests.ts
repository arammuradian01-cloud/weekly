// Просьбы коллегам (этап 21, модуль М4 плана Weekly 2.0): типы и подписи для экранов. Без обращения к базе.

import type { IsoDate } from "./dates";
import type { PersonSlug } from "./types";

export type RequestStatusCode = "open" | "accepted" | "done" | "declined" | "withdrawn";

export const REQUEST_STATUS: Record<RequestStatusCode, { label: string; tone: "warning" | "info" | "success" | "neutral" }> = {
  open: { label: "Ждёт ответа", tone: "warning" },
  accepted: { label: "Принята", tone: "info" },
  done: { label: "Выполнена", tone: "success" },
  declined: { label: "Отклонена", tone: "neutral" },
  withdrawn: { label: "Отозвана", tone: "neutral" },
};

/** Просьба открыта: следующий шаг за адресатом */
export function isActiveRequest(status: RequestStatusCode): boolean {
  return status === "open" || status === "accepted";
}

/** Что текущий человек может сделать с просьбой */
export type RequestCan = {
  accept: boolean;
  decline: boolean;
  done: boolean;
  toTask: boolean;
  withdraw: boolean;
  remind: boolean;
};

export type RequestView = {
  number: number;
  status: RequestStatusCode;
  text: string;
  author: PersonSlug;
  addressee: PersonSlug;
  /** К какому сроку просит автор */
  due: IsoDate;
  /** Срок, который назвал адресат */
  acceptedDue: IsoDate | null;
  /** Причина отказа или итог */
  answer: string | null;
  /** Связанная задача и запись: только если человек их видит */
  task: { number: number; title: string } | null;
  entry: { id: string; what: string } | null;
  /** Задача адресата, сделанная из просьбы */
  resultTask: { number: number; title: string } | null;
  createdAt: string;
  answeredAt: string | null;
  closedAt: string | null;
  remindedAt: string | null;
  /** Без ответа больше 2 рабочих дней или принята и просрочена: попадает на встречу */
  stuck: boolean;
  /** Срок, который действует сейчас, прошёл */
  overdue: boolean;
  can: RequestCan;
};

/** Срок, который действует сейчас: названный адресатом или просимый автором */
export function currentDue(r: Pick<RequestView, "due" | "acceptedDue">): IsoDate {
  return r.acceptedDue ?? r.due;
}

/** Фраза о состоянии для строки списка: «Ждёт ответа», «Принята, срок 15.10», «Отклонена: нет данных» */
export function requestStateText(r: Pick<RequestView, "status" | "acceptedDue" | "answer">, format: (iso: IsoDate) => string): string {
  const label = REQUEST_STATUS[r.status].label;
  if (r.status === "accepted" && r.acceptedDue) return `${label}, срок ${format(r.acceptedDue)}`;
  if ((r.status === "declined" || r.status === "done") && r.answer) return `${label}: ${r.answer}`;
  return label;
}
