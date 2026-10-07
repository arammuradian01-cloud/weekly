// Задача из базы в том виде, в каком её показывают экраны (тип Task из src/domain/types.ts).

import type { Prisma } from "@/generated/prisma/client";
import type { DirectionCode, SourceCode } from "@/domain/dictionaries";
import type { Comment, Owner, PersonSlug, Task, Transfer } from "@/domain/types";
import { CLOSED_DB as CLOSED, priorityCode, stateCode, statusCode } from "./codes";
import { isoFromDbDate, moscowIso } from "./dates";
import { commentDto, reactionInclude } from "@/lib/discuss/common";

export const taskInclude = {
  owner: { select: { slug: true } },
  createdBy: { select: { slug: true } },
  direction: { select: { code: true } },
  coExecutors: { select: { personId: true, person: { select: { slug: true, sortOrder: true } } } },
  transfers: { orderBy: [{ at: { sort: "asc", nulls: "first" } }, { id: "asc" }], include: { by: { select: { slug: true } } } },
  comments: { orderBy: { at: "asc" }, include: { author: { select: { slug: true } }, reactions: { include: reactionInclude, orderBy: { createdAt: "asc" } } } },
  links: { orderBy: { at: "asc" } },
  goal: { select: { id: true, title: true, code: true } },
  // Какие задачи эта ждёт (этап 21): номер, срок и закрыта ли. Названия карточка грузит отдельно, с проверкой доступа
  waitsFor: { select: { blocker: { select: { number: true, due: true, status: true, archivedAt: true } } } },
} satisfies Prisma.TaskInclude;

export type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

/** Для списков: без комментариев, только их число. Комментарии своих задач подгружаются отдельным запросом */
export const taskListInclude = {
  owner: taskInclude.owner,
  createdBy: taskInclude.createdBy,
  direction: taskInclude.direction,
  coExecutors: taskInclude.coExecutors,
  transfers: taskInclude.transfers,
  links: taskInclude.links,
  goal: taskInclude.goal,
  waitsFor: taskInclude.waitsFor,
  _count: { select: { comments: true } },
} satisfies Prisma.TaskInclude;

export type TaskListRow = Prisma.TaskGetPayload<{ include: typeof taskListInclude }>;

const slug = (s: string) => s as PersonSlug;

export function ownerOf(row: Pick<TaskRow, "ownerAll" | "owner">): Owner {
  if (row.ownerAll || !row.owner) return "all";
  return slug(row.owner.slug);
}

export function toTaskDto(row: TaskRow): Task {
  const transfers: Transfer[] = row.transfers.map((t) => ({
    from: t.fromDue ? isoFromDbDate(t.fromDue) : null,
    to: isoFromDbDate(t.toDue),
    by: t.by ? slug(t.by.slug) : null,
    reason: t.reason,
    at: t.at ? moscowIso(t.at) : null,
  }));
  const comments: Comment[] = row.comments.map(commentDto);
  const due = isoFromDbDate(row.due);
  return {
    number: row.number,
    title: row.title,
    outcome: row.outcome,
    owner: ownerOf(row),
    coExecutors: row.coExecutors
      .map((c) => c.person)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => slug(p.slug)),
    direction: row.direction.code as DirectionCode,
    priority: priorityCode(row.priority),
    status: statusCode(row.status),
    state: stateCode(row.state),
    blockedBy: row.blockedBy ?? undefined,
    riskNote: row.riskNote ?? undefined,
    waitsFor: row.waitsFor.map((w) => ({ number: w.blocker.number, due: isoFromDbDate(w.blocker.due), closed: CLOSED.includes(w.blocker.status) || !!w.blocker.archivedAt })),
    where: row.whereNow,
    whereUpdatedAt: isoFromDbDate(row.whereUpdatedAt),
    due,
    originalDue: row.originalDue ? isoFromDbDate(row.originalDue) : due,
    transfers,
    source: { kind: row.sourceCode as SourceCode, note: row.sourceNote ?? "" },
    links: row.links.map((l) => ({ id: l.id, title: l.title, url: l.url })),
    comments,
    // История грузится отдельно при открытии карточки: она живёт в журнале
    history: [],
    createdBy: row.createdBy ? slug(row.createdBy.slug) : null,
    createdAt: row.sourceDate ? isoFromDbDate(row.sourceDate) : moscowIso(row.createdAt),
    updatedAt: moscowIso(row.updatedAt),
    closedAt: row.closedAt ? moscowIso(row.closedAt) : undefined,
    resolution: row.resolution ?? undefined,
    archived: row.archivedAt !== null,
    team: row.teamId,
    ...(row.goal ? { goal: { id: row.goal.id, title: row.goal.code ? `${row.goal.code}. ${row.goal.title}` : row.goal.title } } : {}),
  };
}
