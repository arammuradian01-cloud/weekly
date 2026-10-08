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
import { loadScope, loadTeamNodes, type ScopeSubject } from "@/lib/org/scope";
import { seesTask } from "@/lib/tasks/watch";
import { seesEntry } from "@/lib/discuss/access";
import type { RequestStatusCode } from "@/domain/requests";
import { TOP_TEAM } from "@/lib/org/scope";
import { isoFromDbDate } from "@/lib/tasks/dates";
import type { IsoDate } from "@/domain/dates";

export { notify, quote, taskSubject, type InboxInput } from "./notify";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export type InboxItem = {
  subject: string;
  /** Номер задачи для ссылки и подписи */
  taskNumber: number | null;
  taskTitle: string | null;
  /** Запись weekly (этап 20): ссылка на страницу записи и её «что произошло» */
  entryId: string | null;
  entryTitle: string | null;
  /** Просьба (этап 21): ссылка на страницу просьбы, её текст и состояние */
  requestNumber: number | null;
  requestText: string | null;
  requestStatus: RequestStatusCode | null;
  /** Срок просьбы, если её можно принять прямо из «Мне» одним нажатием (этап 26): я адресат, просьба ждёт ответа */
  requestQuickDue: IsoDate | null;
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

/**
 * Общий логин без режима управления видит только топ-команду (этап 14). Профиль можно выбрать чужой, поэтому
 * в «Мне» такой вход показывает только события о задачах и записях, которые видны и так. viewer не задан: личный вход
 */
async function limitedFilter(personId: string, viewer: ScopeSubject | undefined) {
  if (!viewer?.limited) return null;
  const [scope, nodes] = await Promise.all([loadScope(prisma, { ...viewer, id: personId }), loadTeamNodes(prisma)]);
  const topNode = nodes.find((n) => n.id === TOP_TEAM);
  const top = new Set([...(topNode?.leaderId ? [topNode.leaderId] : []), ...(topNode?.members ?? [])]);
  return (r: {
    task: { teamId: string; ownerId: string | null; createdById: string | null; archivedAt: Date | null; coExecutors: { personId: string }[] } | null;
    entry: { authorId: string | null; ceo: boolean; promotions: { byId: string }[] } | null;
    request: { authorId: string; addresseeId: string } | null;
    kind: InboxKind;
    actorId: string | null;
  }) => {
    // Просьбы по общему логину: только между людьми топ-команды (этап 21). Благодарности так же: от людей топ-команды
    if (r.request) return top.has(r.request.authorId) && top.has(r.request.addresseeId);
    if (r.kind === "THANKS" || r.kind === "MEETING") return !!r.actorId && top.has(r.actorId);
    if (r.task) return !r.task.archivedAt && seesTask(scope, r.task, personId);
    if (r.entry) return seesEntry(scope, nodes, { authorId: r.entry.authorId, ceo: r.entry.ceo, promotedBy: r.entry.promotions.map((p) => p.byId) }, personId);
    return true;
  };
}

const inboxInclude = {
  task: { select: { number: true, title: true, teamId: true, ownerId: true, createdById: true, archivedAt: true, coExecutors: { select: { personId: true } } } },
  entry: { select: { id: true, what: true, authorId: true, ceo: true, promotions: { select: { byId: true } } } },
  request: { select: { number: true, text: true, status: true, authorId: true, addresseeId: true, due: true, resultTaskId: true } },
} satisfies Prisma.InboxEventInclude;

/** Неразобранное, одна строка на предмет, свежие сверху */
export async function listInbox(personId: string, now = new Date(), viewer?: ScopeSubject): Promise<InboxView> {
  const [all, snoozed, keep] = await Promise.all([
    prisma.inboxEvent.findMany({
      where: open(personId, now),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: inboxInclude,
      take: 500,
    }),
    prisma.inboxEvent.groupBy({ by: ["subject"], where: { recipientId: personId, doneAt: null, snoozeUntil: { gt: now } } }),
    limitedFilter(personId, viewer),
  ]);
  const rows = keep ? all.filter(keep) : all;
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
      entryId: r.entry?.id ?? null,
      entryTitle: r.entry?.what ?? null,
      requestNumber: r.request?.number ?? null,
      requestText: r.request?.text ?? null,
      requestStatus: r.request ? (r.request.status.toLowerCase() as RequestStatusCode) : null,
      requestQuickDue: r.request && r.request.status === "OPEN" && r.request.addresseeId === personId && !r.request.resultTaskId ? isoFromDbDate(r.request.due) : null,
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
export async function inboxCount(personId: string, now = new Date(), viewer?: ScopeSubject): Promise<number> {
  if (viewer?.limited) return (await listInbox(personId, now, viewer)).items.length;
  const subjects = await prisma.inboxEvent.groupBy({ by: ["subject"], where: open(personId, now) });
  return subjects.length;
}

/** «Разобрано»: все события предмета у этого человека уходят из списка */
export async function markDone(actor: Actor, subject: string, now = new Date()): Promise<number> {
  await requireVisible(actor, [subject], now);
  const done = await prisma.inboxEvent.updateMany({ where: { recipientId: actor.personId, subject, doneAt: null }, data: { doneAt: now } });
  if (!done.count) fail("Это уже разобрано");
  return done.count;
}

/**
 * Человек видел события в ресурсе (этап 20): открыл «Мне» или сам предмет. Письмо по таким событиям не уходит.
 * subjects не задан: всё, что сейчас видно в «Мне»
 */
export async function markSeen(personId: string, subjects?: string[], now = new Date()): Promise<number> {
  const where: Prisma.InboxEventWhereInput = subjects ? { recipientId: personId, subject: { in: subjects.map(String).slice(0, 50) }, seenAt: null } : { ...open(personId, now), seenAt: null };
  const seen = await prisma.inboxEvent.updateMany({ where, data: { seenAt: now } });
  return seen.count;
}

/** «Разобрано» всё сразу */
export async function markAllDone(actor: Actor, now = new Date()): Promise<number> {
  // Общий логин разбирает только то, что ему показано: скрытые события человека остаются ему
  const viewer = viewerOf(actor);
  const where: Prisma.InboxEventWhereInput = viewer.limited
    ? { ...open(actor.personId, now), subject: { in: (await listInbox(actor.personId, now, viewer)).items.map((i) => i.subject) } }
    : open(actor.personId, now);
  const done = await prisma.inboxEvent.updateMany({ where, data: { doneAt: now } });
  return done.count;
}

/** Доступ того, кто действует: общий логин без режима управления видит только топ-команду */
function viewerOf(actor: Actor): ScopeSubject {
  return { id: actor.personId, role: actor.role, limited: actor.via === "TEAM" && !actor.management };
}

/** Общий логин трогает только предметы, которые ему показаны в «Мне» */
async function requireVisible(actor: Actor, subjects: string[], now: Date): Promise<void> {
  const viewer = viewerOf(actor);
  if (!viewer.limited) return;
  const shown = new Set((await listInbox(actor.personId, now, viewer)).items.map((i) => i.subject));
  if (subjects.some((s) => !shown.has(s))) fail("Это уже разобрано");
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
  await requireVisible(actor, [subject], now);
  const hidden = await prisma.inboxEvent.updateMany({ where: { recipientId: actor.personId, subject, doneAt: null }, data: { snoozeUntil: until } });
  if (!hidden.count) fail("Это уже разобрано");
  return until;
}
