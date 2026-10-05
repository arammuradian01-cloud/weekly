// Задача из базы в том виде, в каком её показывают экраны (тип Task из src/domain/types.ts).

import type { Prisma } from "@/generated/prisma/client";
import type { DirectionCode, SourceCode } from "@/domain/dictionaries";
import type { Comment, Owner, PersonSlug, Task, Transfer } from "@/domain/types";
import { priorityCode, stateCode, statusCode } from "./codes";
import { isoFromDbDate, moscowIso, moscowTime } from "./dates";

export const taskInclude = {
  owner: { select: { slug: true } },
  createdBy: { select: { slug: true } },
  direction: { select: { code: true } },
  coExecutors: { select: { personId: true, person: { select: { slug: true, sortOrder: true } } } },
  transfers: { orderBy: [{ at: { sort: "asc", nulls: "first" } }, { id: "asc" }], include: { by: { select: { slug: true } } } },
  comments: { orderBy: { at: "asc" }, include: { author: { select: { slug: true } } } },
  links: { orderBy: { at: "asc" } },
} satisfies Prisma.TaskInclude;

export type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

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
  const comments: Comment[] = row.comments.map((c) => ({
    id: c.id,
    author: slug(c.author.slug),
    text: c.text,
    at: moscowIso(c.at),
    time: moscowTime(c.at),
  }));
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
  };
}
