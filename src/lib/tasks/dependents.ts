// Связи задач (этап 21): события ответственным задач, которые ждут эту. Отдельный модуль без зависимости от сервиса
// задач: его вызывают и сервис задач, и забор из Bord (там правки приходят без человека).

import type { Prisma } from "@/generated/prisma/client";
import { taskSubject } from "@/lib/inbox/notify";
import { CLOSED_DB } from "./codes";

type Tx = Prisma.TransactionClient;

/**
 * Событие ответственным открытых задач, которые ждут эту. text решает по каждой зависимой, нужно ли событие:
 * null значит «не касается». actor null: правка пришла из Bord
 */
export async function notifyDependents(
  tx: Tx,
  blocker: { id: string },
  actor: { personId: string; fullName: string } | null,
  text: (dep: { number: number; due: Date }) => string | null,
): Promise<number> {
  const deps = await tx.taskDependency.findMany({
    where: { blockerId: blocker.id, task: { status: { notIn: CLOSED_DB }, archivedAt: null } },
    select: { task: { select: { id: true, number: true, due: true, ownerId: true, owner: { select: { active: true } } } } },
  });
  const rows: Prisma.InboxEventCreateManyInput[] = [];
  for (const { task } of deps) {
    if (!task.ownerId || !task.owner?.active || task.ownerId === actor?.personId) continue;
    const line = text(task);
    if (!line) continue;
    rows.push({
      recipientId: task.ownerId,
      kind: "TASK_DEPENDENCY",
      actorId: actor?.personId ?? null,
      actorName: actor?.fullName ?? "Bord",
      subject: taskSubject(task.number),
      taskId: task.id,
      text: line,
    });
  }
  if (rows.length) await tx.inboxEvent.createMany({ data: rows });
  return rows.length;
}
