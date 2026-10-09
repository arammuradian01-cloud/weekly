// Личные цели из бордов лидеров и задачи (этап 31). Без зависимостей от служб задач и целей: правило нужно и при
// привязке цели, и при смене ответственного и соисполнителей, и при заборе из Bord.
//
// Личная цель человека из борда подходит задаче, пока человек в задаче: ответственным или соисполнителем.
// Цель руководителя команды из его борда считается целью команды: её можно выбрать в задачах команды и команд ниже.

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ancestorsOf, loadTeamNodes, type TeamNode } from "@/lib/org/scope";

type Db = PrismaClient | Prisma.TransactionClient;

/** Цель из борда лидера */
export const fromLeaderBoard = (g: { source: string }) => g.source.startsWith("leader-board:");

/** Личная цель другого человека из борда лидера: не руководителя команды цели и не человека задачи */
export function othersPersonal(g: { source: string; ownerId: string | null; teamId: string }, nodes: TeamNode[], people: string[]): boolean {
  if (!fromLeaderBoard(g) || !g.ownerId) return false;
  const leader = nodes.find((n) => n.id === g.teamId)?.leaderId ?? null;
  return g.ownerId !== leader && !people.includes(g.ownerId);
}

/** Люди задачи, чьи личные цели ей подходят: ответственный и соисполнители */
export function taskPeople(task: { ownerId: string | null; coExecutors: { personId: string }[] }): string[] {
  return [...new Set([...(task.ownerId ? [task.ownerId] : []), ...task.coExecutors.map((c) => c.personId)])];
}

/** Можно ли задаче работать на цель: цель своей команды или команды выше, или личная цель человека задачи */
export function goalFits(g: { source: string; ownerId: string | null; teamId: string }, task: { teamId: string }, people: string[], nodes: TeamNode[]): boolean {
  if (fromLeaderBoard(g) && g.ownerId && people.includes(g.ownerId)) return true;
  const inChain = [task.teamId, ...ancestorsOf(nodes, task.teamId)].includes(g.teamId);
  return inChain && !othersPersonal(g, nodes, people);
}

/**
 * Цель задачи стала чужой личной целью: ответственного сменили или соисполнителя убрали. Возвращает название цели,
 * которую надо снять с задачи, иначе null. Цели команд не трогает: их правило не менялось
 */
export async function foreignGoal(db: Db, task: { goalId: string | null; teamId: string; people: string[] }): Promise<string | null> {
  if (!task.goalId) return null;
  const g = await db.goal.findUnique({ where: { id: task.goalId }, select: { title: true, teamId: true, ownerId: true, source: true } });
  if (!g || !fromLeaderBoard(g) || !g.ownerId || task.people.includes(g.ownerId)) return null;
  return goalFits(g, task, task.people, await loadTeamNodes(db)) ? null : g.title;
}
