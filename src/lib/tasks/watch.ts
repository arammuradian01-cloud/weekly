// Подписка на задачу (этап 16): события подписчикам о смене статуса и срока. Отдельный модуль без зависимости
// от сервиса задач: его вызывают и сервис задач, и забор из Bord.

import type { Prisma } from "@/generated/prisma/client";
import { TOP_TEAM, loadTeamNodes, scopeOf, type Scope } from "@/lib/org/scope";
import { taskSubject } from "@/lib/inbox/notify";

type Tx = Prisma.TransactionClient;

/** Видит ли человек задачу: та же проверка, что у сервиса задач (canSeeRow) */
export function seesTask(scope: Scope, task: { teamId: string; ownerId: string | null; createdById: string | null; coExecutors: { personId: string }[] }, personId: string): boolean {
  if (scope.all || scope.visible.includes(task.teamId)) return true;
  if (task.ownerId === personId || task.createdById === personId || task.coExecutors.some((c) => c.personId === personId)) return true;
  if (!task.ownerId) return false;
  return scope.functional.includes(task.ownerId) || (task.teamId !== TOP_TEAM && scope.leadPeople.includes(task.ownerId));
}

/**
 * Событие подписчикам задачи. Только тем, кто задачу всё ещё видит (его могли убрать из команды, задачу перенести),
 * кроме автора правки и тех, кто уже получил событие об этой правке. actor null: правка пришла из Bord
 */
export async function notifyWatchers(tx: Tx, taskId: string, text: string, actor: { personId: string; fullName: string } | null, skip: (string | null)[] = []): Promise<number> {
  const watchers = await tx.taskWatch.findMany({ where: { taskId }, select: { personId: true, person: { select: { role: true, active: true } } } });
  const candidates = watchers.filter((w) => w.person.active && w.personId !== actor?.personId && !skip.includes(w.personId));
  if (!candidates.length) return 0;
  const task = await tx.task.findUnique({ where: { id: taskId }, select: { number: true, teamId: true, ownerId: true, createdById: true, archivedAt: true, coExecutors: { select: { personId: true } } } });
  if (!task) return 0;
  const nodes = await loadTeamNodes(tx);
  const functional = await tx.person.findMany({ where: { functionalManagerId: { in: candidates.map((c) => c.personId) } }, select: { id: true, functionalManagerId: true } });
  const recipients = candidates.filter((w) => {
    // Архивную задачу видит только владелец
    if (task.archivedAt && w.person.role !== "OWNER") return false;
    const scope = scopeOf(nodes, { id: w.personId, role: w.person.role }, functional.filter((f) => f.functionalManagerId === w.personId).map((f) => f.id));
    return seesTask(scope, task, w.personId);
  });
  if (!recipients.length) return 0;
  await tx.inboxEvent.createMany({
    data: recipients.map((w) => ({
      recipientId: w.personId,
      kind: "TASK_WATCH" as const,
      actorId: actor?.personId ?? null,
      actorName: actor?.fullName ?? "Bord",
      subject: taskSubject(task.number),
      taskId,
      text,
    })),
  });
  return recipients.length;
}
