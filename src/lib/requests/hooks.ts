// Просьбы и задачи (этап 21): задача, сделанная из просьбы, выполнена, значит выполнена и просьба.
// Отдельный модуль без зависимости от сервиса задач: его вызывает сам сервис задач в своей транзакции.

import type { Prisma } from "@/generated/prisma/client";
import { notify } from "@/lib/inbox/notify";

type Tx = Prisma.TransactionClient;

export const requestSubject = (number: number) => `request:${number}`;

/** Задачу выполнили: открытые и принятые просьбы, из которых она сделана, закрываются с итогом, автору событие */
export async function closeRequestsOfTask(tx: Tx, task: { id: string; number: number }, actor: { personId: string; fullName: string; ip?: string | null; via?: Prisma.AuditLogCreateInput["via"] }, now = new Date()): Promise<number> {
  const rows = await tx.helpRequest.findMany({ where: { resultTaskId: task.id, status: { in: ["OPEN", "ACCEPTED"] } }, select: { id: true, number: true, authorId: true, status: true } });
  if (!rows.length) return 0;
  const answer = `Задача ${task.number} выполнена`;
  await tx.helpRequest.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: "DONE", answer, closedAt: now } });
  for (const r of rows) {
    await notify(tx, { kind: "REQUEST_ANSWER", recipients: [r.authorId], actor, subject: requestSubject(r.number), text: `Просьба выполнена: задача ${task.number} закрыта`, requestId: r.id }, now);
  }
  await tx.auditLog.createMany({
    data: rows.map((r) => ({
      action: "request.done",
      actorId: actor.personId,
      actorName: actor.fullName,
      source: "APP" as const,
      entity: "request",
      entityId: String(r.number),
      field: "Состояние",
      before: r.status === "OPEN" ? "Ждёт ответа" : "Принята",
      after: `Выполнена. ${answer}`,
      ip: actor.ip ?? null,
      via: actor.via ?? null,
    })),
  });
  return rows.length;
}
