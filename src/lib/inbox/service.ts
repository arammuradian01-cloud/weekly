// Раздел «Мне» (этап 11, модуль М2 плана Weekly 2.0): одно место, где видно, чего ждут от человека.
//
// События пишутся в той же транзакции, что и правка задачи: правка прошла, значит адресат увидит событие.
// Предмет (subject) склеивает события одной задачи в одну строку. «Разобрано» закрывает строку, новое событие
// по той же задаче возвращает её наверх. «Напомнить» прячет строку до выбранного утра.
// Сам себе человек событий не получает.

import { prisma } from "@/lib/db";
import { moscowDate, moscowDateTime } from "@/lib/week";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import type { InboxKind, Prisma } from "@/generated/prisma/client";

export { notify, quote, taskSubject, type InboxInput } from "./notify";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export type InboxItem = {
  subject: string;
  /** Номер задачи для ссылки и подписи */
  taskNumber: number | null;
  taskTitle: string | null;
  /** Последнее событие предмета: кто и что */
  actorName: string | null;
  kind: InboxKind;
  text: string;
  at: string;
  /** Сколько неразобранных событий по предмету */
  count: number;
};

export type InboxView = { items: InboxItem[]; snoozed: number };

const open = (personId: string, now: Date): Prisma.InboxEventWhereInput => ({
  recipientId: personId,
  doneAt: null,
  OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: now } }],
});

/** Неразобранное, одна строка на предмет, свежие сверху */
export async function listInbox(personId: string, now = new Date()): Promise<InboxView> {
  const [rows, snoozed] = await Promise.all([
    prisma.inboxEvent.findMany({
      where: open(personId, now),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { task: { select: { number: true, title: true } } },
      take: 500,
    }),
    prisma.inboxEvent.groupBy({ by: ["subject"], where: { recipientId: personId, doneAt: null, snoozeUntil: { gt: now } } }),
  ]);
  const bySubject = new Map<string, InboxItem>();
  for (const r of rows) {
    const item = bySubject.get(r.subject);
    if (item) {
      item.count += 1;
      continue;
    }
    bySubject.set(r.subject, {
      subject: r.subject,
      taskNumber: r.task?.number ?? null,
      taskTitle: r.task?.title ?? null,
      actorName: r.actorName,
      kind: r.kind,
      text: r.text,
      at: r.createdAt.toISOString(),
      count: 1,
    });
  }
  const openSubjects = new Set(bySubject.keys());
  return { items: [...bySubject.values()], snoozed: snoozed.filter((s) => !openSubjects.has(s.subject)).length };
}

/** Счётчик в меню: сколько предметов ждут */
export async function inboxCount(personId: string, now = new Date()): Promise<number> {
  const subjects = await prisma.inboxEvent.groupBy({ by: ["subject"], where: open(personId, now) });
  return subjects.length;
}

/** «Разобрано»: все события предмета у этого человека уходят из списка */
export async function markDone(actor: Actor, subject: string, now = new Date()): Promise<number> {
  const done = await prisma.inboxEvent.updateMany({ where: { recipientId: actor.personId, subject, doneAt: null }, data: { doneAt: now } });
  if (!done.count) fail("Это уже разобрано");
  return done.count;
}

/** «Разобрано» всё сразу */
export async function markAllDone(actor: Actor, now = new Date()): Promise<number> {
  const done = await prisma.inboxEvent.updateMany({ where: open(actor.personId, now), data: { doneAt: now } });
  return done.count;
}

export type SnoozeChoice = "tomorrow" | "monday";

/** Когда напомнить: завтра в 9:00 или в ближайший понедельник в 9:00 по Москве */
export function snoozeMoment(choice: SnoozeChoice, now = new Date()): Date {
  const today = moscowDate(now);
  const base = new Date(Date.UTC(today.year, today.month - 1, today.day));
  const weekday = base.getUTCDay() || 7;
  const days = choice === "tomorrow" ? 1 : 8 - weekday;
  const target = new Date(base.getTime() + days * 86_400_000);
  return moscowDateTime({ year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate() }, 9, 0);
}

/** «Напомнить»: строка скрыта до утра, потом возвращается. Новое событие по предмету вернёт её сразу */
export async function snooze(actor: Actor, subject: string, choice: SnoozeChoice, now = new Date()): Promise<Date> {
  if (choice !== "tomorrow" && choice !== "monday") fail("Выберите, когда напомнить");
  const until = snoozeMoment(choice, now);
  const hidden = await prisma.inboxEvent.updateMany({ where: { recipientId: actor.personId, subject, doneAt: null }, data: { snoozeUntil: until } });
  if (!hidden.count) fail("Это уже разобрано");
  return until;
}
