// Кто что видит в обсуждениях (этап 20). Упоминание, комментарий и реакция доходят только до тех, кто сам видит
// предмет: упоминание не открывает чужую задачу или чужой weekly.

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { TOP_TEAM, loadTeamNodes, scopeOf, type Scope, type TeamNode } from "@/lib/org/scope";
import { seesTask } from "@/lib/tasks/watch";

type Db = PrismaClient | Prisma.TransactionClient;

/** Запись weekly для проверки доступа: автор, отметка CEO и кто поднял её наверх */
export type EntryAccess = { authorId: string | null; ceo: boolean; promotedBy: string[] };

/**
 * Видит ли человек запись weekly: так же, как лента его команд (audienceOf). Свою запись видит всегда,
 * общую запись без автора видит топ-команда, остальные записи видны участникам видимых команд и через тех, кто поднял запись
 */
export function seesEntry(scope: Scope, nodes: TeamNode[], entry: EntryAccess, personId: string): boolean {
  if (scope.all) return true;
  if (entry.authorId === personId) return true;
  const visible = new Set(scope.visible);
  if (!entry.authorId) return visible.has(TOP_TEAM);
  const authors = new Set<string>();
  for (const n of nodes) {
    if (!n.active || !visible.has(n.id)) continue;
    for (const m of n.members) authors.add(m);
    // Weekly руководителя топ-команды живёт в топ-команде, остальных руководителей в команде выше
    if (n.id === TOP_TEAM && n.leaderId) authors.add(n.leaderId);
  }
  return authors.has(entry.authorId) || entry.promotedBy.some((id) => authors.has(id));
}

export type Reader = { id: string; role: Role; scope: Scope };

/** Доступ людей одним заходом: дерево команд грузится один раз. Выключенных людей нет в ответе */
export async function readersOf(db: Db, ids: string[], nodes?: TeamNode[]): Promise<Map<string, Reader>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const [people, tree, functional] = await Promise.all([
    db.person.findMany({ where: { id: { in: unique }, active: true }, select: { id: true, role: true } }),
    nodes ? Promise.resolve(nodes) : loadTeamNodes(db),
    db.person.findMany({ where: { functionalManagerId: { in: unique } }, select: { id: true, functionalManagerId: true } }),
  ]);
  const out = new Map<string, Reader>();
  for (const p of people) {
    const scope = scopeOf(
      tree,
      { id: p.id, role: p.role },
      functional.filter((f) => f.functionalManagerId === p.id).map((f) => f.id),
    );
    out.set(p.id, { id: p.id, role: p.role, scope });
  }
  return out;
}

/** Кто из людей видит запись weekly */
export async function entryReaders(db: Db, entry: EntryAccess, ids: string[]): Promise<string[]> {
  const nodes = await loadTeamNodes(db);
  const readers = await readersOf(db, ids, nodes);
  return [...readers.values()].filter((r) => seesEntry(r.scope, nodes, entry, r.id)).map((r) => r.id);
}

type TaskAccess = { teamId: string; ownerId: string | null; createdById: string | null; archivedAt: Date | null; coExecutors: { personId: string }[] };

/** Кто из людей видит задачу. Архивную задачу видит только владелец */
export async function taskReaders(db: Db, task: TaskAccess, ids: string[]): Promise<string[]> {
  const readers = await readersOf(db, ids);
  return [...readers.values()].filter((r) => (task.archivedAt ? r.role === "OWNER" : seesTask(r.scope, task, r.id))).map((r) => r.id);
}
