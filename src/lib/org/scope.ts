// Кто какие команды видит и какими руководит (этап 14). Команд в департаменте десятки, поэтому дерево
// грузится целиком одним запросом, а поддеревья считаются в памяти.
//
// Правила:
// - владелец, администраторы и наблюдатель видят все команды, как раньше видели всю топ-команду;
// - остальные видят команды, где они участники или руководители, и все команды ниже своих;
// - руководитель команды (кроме топ-команды) ведёт задачи своей команды и всех команд ниже: ставит, переносит,
//   подтверждает предложенные. Топ-командой по-прежнему управляет режим управления владельца и администраторов;
// - функциональный руководитель видит задачи своих людей, но не правит их.

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Role, TeamKind } from "@/generated/prisma/enums";

import { TOP_TEAM } from "@/domain/teams";

export { TOP_TEAM };

type Db = PrismaClient | Prisma.TransactionClient;

export type TeamNode = {
  id: string;
  name: string;
  kind: TeamKind;
  leaderId: string | null;
  parentId: string | null;
  unitId: string | null;
  active: boolean;
  sortOrder: number;
  /** id участников, без руководителя */
  members: string[];
};

export type Scope = {
  /** Видит все команды: владелец, администраторы, наблюдатель */
  all: boolean;
  /** Команды, где человек участник или руководитель */
  member: string[];
  /** Команды, которыми руководит, вместе со всеми командами ниже. Топ-команды здесь не бывает */
  leads: string[];
  /** Все команды, задачи которых человек видит */
  visible: string[];
  /** Люди, у которых он функциональный руководитель */
  functional: string[];
};

export async function loadTeamNodes(db: Db): Promise<TeamNode[]> {
  const rows = await db.team.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { members: { select: { personId: true } } },
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    leaderId: t.leaderId,
    parentId: t.parentId,
    unitId: t.unitId,
    active: t.active,
    sortOrder: t.sortOrder,
    members: t.members.map((m) => m.personId),
  }));
}

/** Команда и все команды ниже неё. Защита от петли: каждую команду обходим один раз */
export function subtreeOf(nodes: TeamNode[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = children.get(n.parentId) ?? [];
    list.push(n.id);
    children.set(n.parentId, list);
  }
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const child of children.get(id) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return [...seen];
}

/** Цепочка команд вверх от команды: она сама, её родитель и так до верха */
export function ancestorsOf(nodes: TeamNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    chain.push(cur.id);
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
}

export function seesAll(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "OBSERVER";
}

export function scopeOf(nodes: TeamNode[], person: { id: string; role: Role }, functional: string[] = []): Scope {
  const active = nodes.filter((n) => n.active);
  const member = active.filter((n) => n.leaderId === person.id || n.members.includes(person.id)).map((n) => n.id);
  const leads = new Set<string>();
  for (const n of active) {
    if (n.leaderId !== person.id || n.id === TOP_TEAM) continue;
    for (const id of subtreeOf(active, n.id)) if (id !== TOP_TEAM) leads.add(id);
  }
  const all = seesAll(person.role);
  const visible = all ? nodes.map((n) => n.id) : [...new Set([...member, ...leads])];
  return { all, member, leads: [...leads], visible, functional };
}

export async function loadScope(db: Db, person: { id: string; role: Role }): Promise<Scope> {
  const [nodes, functional] = await Promise.all([
    loadTeamNodes(db),
    db.person.findMany({ where: { functionalManagerId: person.id }, select: { id: true } }),
  ]);
  return scopeOf(nodes, person, functional.map((p) => p.id));
}

/** Условие на задачи, которые человек видит: команды из scope и свои задачи в любой команде */
export function visibleTasksWhere(scope: Scope, personId: string): Prisma.TaskWhereInput {
  if (scope.all) return {};
  return {
    OR: [
      { teamId: { in: scope.visible } },
      { ownerId: personId },
      { createdById: personId },
      { coExecutors: { some: { personId } } },
      ...(scope.functional.length ? [{ ownerId: { in: scope.functional } }] : []),
    ],
  };
}

/** Люди команды: руководитель и участники, по порядку из настроек */
export function teamPeopleIds(node: TeamNode): string[] {
  return [...new Set([...(node.leaderId ? [node.leaderId] : []), ...node.members])];
}
