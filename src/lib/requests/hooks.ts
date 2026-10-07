// Просьбы и задачи (этап 21): задача, сделанная из просьбы, ведёт просьбу за собой. Выполнили задачу, и просьба
// выполнена; отменили «Выполнена», и просьба снова принята; перенесли срок задачи, и у просьбы тот же срок.
// Отдельный модуль без зависимости от сервиса задач: его вызывает сам сервис задач в своей транзакции,
// под замком строки задачи. Строки просьб тоже берутся под замок: ответ адресата или отзыв автора в ту же секунду
// не перезапишется.

import type { Prisma } from "@/generated/prisma/client";
import { formatShort } from "@/domain/dates";
import { notify } from "@/lib/inbox/notify";

type Tx = Prisma.TransactionClient;
type Who = { personId: string; fullName: string; ip?: string | null; via?: Prisma.AuditLogCreateInput["via"] };

export const requestSubject = (number: number) => `request:${number}`;

/** Итог просьбы, закрытой вместе с задачей: по нему же отмена находит, что открыть обратно */
const answerPrefix = (taskNumber: number) => `Задача ${taskNumber} `;
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

async function lockOf(tx: Tx, taskId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "help_requests" WHERE "resultTaskId" = ${taskId} ORDER BY id FOR UPDATE`;
}

async function journal(tx: Tx, actor: Who, rows: { number: number; before: string }[], action: string, field: string, after: string): Promise<void> {
  await tx.auditLog.createMany({
    data: rows.map((r) => ({
      action,
      actorId: actor.personId,
      actorName: actor.fullName,
      source: "APP" as const,
      entity: "request",
      entityId: String(r.number),
      field,
      before: r.before,
      after,
      ip: actor.ip ?? null,
      via: actor.via ?? null,
    })),
  });
}

export type TaskOutcome = "DONE" | "FAILED" | "CANCELLED";

/**
 * Задачу закрыли: открытые и принятые просьбы, из которых она сделана, закрываются вместе с ней. Выполнена:
 * просьба выполнена. Не выполнена или отменена: просьба отклонена с той же причиной. Автору событие
 */
export async function finishRequestsOfTask(tx: Tx, task: { id: string; number: number }, outcome: TaskOutcome, resolution: string | null, actor: Who, now = new Date()): Promise<number> {
  await lockOf(tx, task.id);
  const rows = await tx.helpRequest.findMany({ where: { resultTaskId: task.id, status: { in: ["OPEN", "ACCEPTED"] } }, select: { id: true, number: true, authorId: true, status: true } });
  if (!rows.length) return 0;
  const done = outcome === "DONE";
  const answer = done ? `${answerPrefix(task.number)}выполнена` : `${answerPrefix(task.number)}${outcome === "FAILED" ? "не выполнена" : "отменена"}${resolution ? `: ${resolution}` : ""}`.slice(0, 500);
  await tx.helpRequest.updateMany({ where: { id: { in: rows.map((r) => r.id) }, status: { in: ["OPEN", "ACCEPTED"] } }, data: { status: done ? "DONE" : "DECLINED", answer, closedAt: now } });
  for (const r of rows) {
    const text = done ? `Просьба выполнена: задача ${task.number} закрыта` : `Просьба не выполнена: ${answer}`;
    await notify(tx, { kind: "REQUEST_ANSWER", recipients: [r.authorId], actor, subject: requestSubject(r.number), text, requestId: r.id }, now);
  }
  await journal(tx, actor, rows.map((r) => ({ number: r.number, before: r.status === "OPEN" ? "Ждёт ответа" : "Принята" })), done ? "request.done" : "request.decline", "Состояние", `${done ? "Выполнена" : "Отклонена"}. ${answer}`);
  return rows.length;
}

/** Закрытую задачу открыли снова (статусом или отменой): просьбы, которые закрылись вместе с ней, снова принятые */
export async function reopenRequestsOfTask(tx: Tx, task: { id: string; number: number }, actor: Who, now = new Date()): Promise<number> {
  await lockOf(tx, task.id);
  const prefix = answerPrefix(task.number);
  const rows = await tx.helpRequest.findMany({ where: { resultTaskId: task.id, status: { in: ["DONE", "DECLINED"] }, answer: { startsWith: prefix } }, select: { id: true, number: true, authorId: true, answer: true } });
  if (!rows.length) return 0;
  await tx.helpRequest.updateMany({ where: { id: { in: rows.map((r) => r.id) }, status: { in: ["DONE", "DECLINED"] } }, data: { status: "ACCEPTED", answer: null, closedAt: null } });
  for (const r of rows) {
    await notify(tx, { kind: "REQUEST_ANSWER", recipients: [r.authorId], actor, subject: requestSubject(r.number), text: `Задача ${task.number} снова в работе: просьба снова принята`, requestId: r.id }, now);
  }
  await journal(tx, actor, rows.map((r) => ({ number: r.number, before: r.answer ?? "" })), "request.reopen", "Состояние", "Принята: задачу открыли снова");
  return rows.length;
}

/** У задачи из просьбы новый срок: у открытых и принятых просьб тот же срок, автору событие */
export async function syncRequestDue(tx: Tx, task: { id: string; number: number }, due: Date, actor: Who, now = new Date()): Promise<number> {
  await lockOf(tx, task.id);
  const rows = await tx.helpRequest.findMany({
    where: { resultTaskId: task.id, status: { in: ["OPEN", "ACCEPTED"] }, OR: [{ acceptedDue: null }, { acceptedDue: { not: due } }] },
    select: { id: true, number: true, authorId: true, acceptedDue: true },
  });
  if (!rows.length) return 0;
  await tx.helpRequest.updateMany({ where: { id: { in: rows.map((r) => r.id) }, status: { in: ["OPEN", "ACCEPTED"] } }, data: { status: "ACCEPTED", acceptedDue: due } });
  const date = formatShort(isoOf(due));
  for (const r of rows) {
    await notify(tx, { kind: "REQUEST_ANSWER", recipients: [r.authorId], actor, subject: requestSubject(r.number), text: `Новый срок по просьбе: ${date}, за сроком задачи ${task.number}`, requestId: r.id }, now);
  }
  await journal(
    tx,
    actor,
    rows.map((r) => ({ number: r.number, before: r.acceptedDue ? formatShort(isoOf(r.acceptedDue)) : "не назван" })),
    "request.accept",
    "Срок",
    `${date}, за сроком задачи ${task.number}`,
  );
  return rows.length;
}
