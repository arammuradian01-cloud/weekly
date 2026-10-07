// Общий поиск (этап 25, модуль М10): задачи, записи weekly, комментарии, решения и люди одним запросом.
// Слова ищутся с русскими словоформами (словарь russian в PostgreSQL), последнее слово по началу, чтобы находить
// по мере набора. Человек видит в результатах только то, что видит и так: доступ проверяется теми же правилами,
// что у списков и у «Мне».

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { TOP_TEAM, loadScope, loadTeamNodes, visibleTasksWhere, type ScopeSubject } from "@/lib/org/scope";
import { seesEntry } from "@/lib/discuss/access";
import { isoFromDbDate } from "@/lib/tasks/dates";
import { statusCode } from "@/lib/tasks/codes";
import { MARK_END, MARK_START, SEARCH_MAX, SEARCH_MIN, taskNumberOf, tsQueryOf, type SearchHit, type SearchResult } from "./common";

export * from "./common";

/** Сколько результатов каждого вида приходит в командную строку и на страницу поиска */
const PER_KIND = { palette: 5, page: 30 };
/** Сколько строк берём из индекса до проверки доступа: с запасом, часть отсеется */
const RAW_LIMIT = 200;
const HEADLINE_OPTS = `MaxWords=18, MinWords=8, ShortWord=2, MaxFragments=1, StartSel=${MARK_START}, StopSel=${MARK_END}`;

type RawTask = { id: string; snippet: string; rank: number };

function clip(text: string, max = 160): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Поиск. subject: кто ищет, с учётом общего логина. scope: откуда ищут (командная строка или страница), от этого
 * зависит число результатов. Пустой или слишком короткий запрос даёт пустой ответ без обращения к базе
 */
export async function search(subject: ScopeSubject, raw: string, where: "palette" | "page" = "palette"): Promise<SearchResult> {
  const query = String(raw ?? "").trim().slice(0, SEARCH_MAX);
  if (query.length < SEARCH_MIN) return { query, hits: [], total: 0, truncated: false };
  const perKind = PER_KIND[where];
  const number = taskNumberOf(query);
  // Чистое число ищет задачу по номеру: слова и проценты с такими цифрами в записях были бы шумом
  const ts = number ? "" : tsQueryOf(query);
  const like = `%${query}%`;
  const [scope, nodes] = await Promise.all([loadScope(prisma, subject), loadTeamNodes(prisma)]);
  const taskWhere = visibleTasksWhere(scope, subject.id);
  const names = new Map((await prisma.person.findMany({ select: { id: true, slug: true, shortName: true, fullName: true } })).map((p) => [p.id, p]));

  // Задачи: по словам и по номеру. Архив не ищется: он только у владельца, и туда идут за конкретной задачей
  const rawTasks = ts
    ? await prisma.$queryRaw<RawTask[]>`
        SELECT id,
          ts_headline('russian', "title" || '. ' || "outcome" || ' ' || "whereNow", to_tsquery('russian', ${ts}), ${HEADLINE_OPTS}) AS snippet,
          ts_rank(to_tsvector('russian', "title" || ' ' || "outcome" || ' ' || "whereNow"), to_tsquery('russian', ${ts})) AS rank
        FROM tasks
        WHERE "archivedAt" IS NULL AND (to_tsvector('russian', "title" || ' ' || "outcome" || ' ' || "whereNow") @@ to_tsquery('russian', ${ts}) OR "title" ILIKE ${like})
        ORDER BY rank DESC, "updatedAt" DESC
        LIMIT ${RAW_LIMIT}`
    : [];
  const taskIds = rawTasks.map((t) => t.id);
  const taskRows = await prisma.task.findMany({
    where: { AND: [taskWhere, { archivedAt: null }, { OR: [...(taskIds.length ? [{ id: { in: taskIds } }] : []), ...(number ? [{ number }] : [])] }] },
    select: { id: true, number: true, title: true, status: true, due: true, ownerId: true, ownerAll: true, outcome: true },
  });
  const taskById = new Map(taskRows.map((t) => [t.id, t]));
  const taskHits: SearchHit[] = [];
  const byNumber = number ? taskRows.find((t) => t.number === number) : undefined;
  if (byNumber) taskHits.push(taskHit(byNumber, clip(byNumber.outcome), names));
  for (const r of rawTasks) {
    const t = taskById.get(r.id);
    if (!t || t === byNumber) continue;
    taskHits.push(taskHit(t, r.snippet, names));
    if (taskHits.length >= perKind) break;
  }

  // Записи weekly: видны по тем же правилам, что лента
  const rawEntries = ts
    ? await prisma.$queryRaw<RawTask[]>`
        SELECT id,
          ts_headline('russian', "what" || ' ' || coalesce("details", '') || ' ' || coalesce("impact", '') || ' ' || coalesce("fact", '') || ' ' || coalesce("next", '') || ' ' || coalesce("help", ''), to_tsquery('russian', ${ts}), ${HEADLINE_OPTS}) AS snippet,
          ts_rank(to_tsvector('russian', "what" || ' ' || coalesce("details", '') || ' ' || coalesce("impact", '') || ' ' || coalesce("fact", '') || ' ' || coalesce("next", '') || ' ' || coalesce("help", '')), to_tsquery('russian', ${ts})) AS rank
        FROM weekly_entries
        WHERE to_tsvector('russian', "what" || ' ' || coalesce("details", '') || ' ' || coalesce("impact", '') || ' ' || coalesce("fact", '') || ' ' || coalesce("next", '') || ' ' || coalesce("help", '')) @@ to_tsquery('russian', ${ts})
           OR "what" ILIKE ${like}
        ORDER BY rank DESC, "updatedAt" DESC
        LIMIT ${RAW_LIMIT}`
    : [];
  const entryRows = rawEntries.length
    ? await prisma.weeklyEntry.findMany({
        where: { id: { in: rawEntries.map((e) => e.id) } },
        select: { id: true, what: true, authorId: true, ceo: true, promotions: { select: { byId: true } }, week: { select: { start: true, isoNumber: true } } },
      })
    : [];
  const entryById = new Map(entryRows.map((e) => [e.id, e]));
  const seesEntryRow = (e: (typeof entryRows)[number]) => seesEntry(scope, nodes, { authorId: e.authorId, ceo: e.ceo, promotedBy: e.promotions.map((p) => p.byId) }, subject.id);
  const entryHits: SearchHit[] = [];
  for (const r of rawEntries) {
    const e = entryById.get(r.id);
    if (!e || !seesEntryRow(e)) continue;
    entryHits.push({ kind: "entry", id: e.id, week: isoFromDbDate(e.week.start), weekNumber: e.week.isoNumber, author: e.authorId ? (names.get(e.authorId)?.slug ?? null) : null, snippet: r.snippet, what: e.what });
    if (entryHits.length >= perKind) break;
  }

  // Комментарии к задачам и к записям: виден комментарий, если виден предмет
  const rawTaskComments = ts
    ? await prisma.$queryRaw<(RawTask & { taskId: string })[]>`
        SELECT id, "taskId", ts_headline('russian', "text", to_tsquery('russian', ${ts}), ${HEADLINE_OPTS}) AS snippet,
          ts_rank(to_tsvector('russian', "text"), to_tsquery('russian', ${ts})) AS rank
        FROM task_comments
        WHERE to_tsvector('russian', "text") @@ to_tsquery('russian', ${ts}) OR "text" ILIKE ${like}
        ORDER BY rank DESC, "at" DESC
        LIMIT ${RAW_LIMIT}`
    : [];
  const rawEntryComments = ts
    ? await prisma.$queryRaw<(RawTask & { entryId: string })[]>`
        SELECT id, "entryId", ts_headline('russian', "text", to_tsquery('russian', ${ts}), ${HEADLINE_OPTS}) AS snippet,
          ts_rank(to_tsvector('russian', "text"), to_tsquery('russian', ${ts})) AS rank
        FROM entry_comments
        WHERE to_tsvector('russian', "text") @@ to_tsquery('russian', ${ts}) OR "text" ILIKE ${like}
        ORDER BY rank DESC, "at" DESC
        LIMIT ${RAW_LIMIT}`
    : [];
  const [tcRows, ecRows] = await Promise.all([
    rawTaskComments.length
      ? prisma.taskComment.findMany({
          where: { id: { in: rawTaskComments.map((c) => c.id) }, task: { AND: [taskWhere, { archivedAt: null }] } },
          select: { id: true, authorId: true, task: { select: { number: true, title: true } } },
        })
      : [],
    rawEntryComments.length
      ? prisma.entryComment.findMany({
          where: { id: { in: rawEntryComments.map((c) => c.id) } },
          select: { id: true, authorId: true, entry: { select: { id: true, what: true, authorId: true, ceo: true, promotions: { select: { byId: true } }, week: { select: { start: true } } } } },
        })
      : [],
  ]);
  const tcById = new Map(tcRows.map((c) => [c.id, c]));
  const ecById = new Map(ecRows.map((c) => [c.id, c]));
  const commentHits: SearchHit[] = [];
  const commentCandidates = [
    ...rawTaskComments.map((c) => ({ ...c, source: "task" as const })),
    ...rawEntryComments.map((c) => ({ ...c, source: "entry" as const })),
  ].sort((a, b) => b.rank - a.rank);
  for (const c of commentCandidates) {
    if (c.source === "task") {
      const row = tcById.get(c.id);
      if (!row) continue;
      commentHits.push({ kind: "comment", id: row.id, snippet: c.snippet, author: names.get(row.authorId)?.slug ?? "", task: { number: row.task.number, title: row.task.title } });
    } else {
      const row = ecById.get(c.id);
      if (!row || !seesEntry(scope, nodes, { authorId: row.entry.authorId, ceo: row.entry.ceo, promotedBy: row.entry.promotions.map((p) => p.byId) }, subject.id)) continue;
      commentHits.push({ kind: "comment", id: row.id, snippet: c.snippet, author: names.get(row.authorId)?.slug ?? "", entry: { id: row.entry.id, week: isoFromDbDate(row.entry.week.start), what: row.entry.what } });
    }
    if (commentHits.length >= perKind) break;
  }

  // Решения: видны тем, кто видит команду встречи (этап 23)
  const visibleTeams = scope.all ? undefined : [...new Set([...scope.visible, ...scope.member])];
  const rawDecisions = ts
    ? await prisma.$queryRaw<RawTask[]>`
        SELECT id, ts_headline('russian', "text", to_tsquery('russian', ${ts}), ${HEADLINE_OPTS}) AS snippet,
          ts_rank(to_tsvector('russian', "text"), to_tsquery('russian', ${ts})) AS rank
        FROM decisions
        WHERE to_tsvector('russian', "text") @@ to_tsquery('russian', ${ts}) OR "text" ILIKE ${like}
        ORDER BY rank DESC, "date" DESC
        LIMIT ${RAW_LIMIT}`
    : [];
  const decisionRows = rawDecisions.length
    ? await prisma.decision.findMany({
        where: { id: { in: rawDecisions.map((d) => d.id) }, ...(visibleTeams ? { teamId: { in: visibleTeams } } : {}) },
        select: { id: true, text: true, date: true, status: true, ownerId: true },
      })
    : [];
  const decisionById = new Map(decisionRows.map((d) => [d.id, d]));
  const decisionHits: SearchHit[] = [];
  for (const r of rawDecisions) {
    const d = decisionById.get(r.id);
    if (!d) continue;
    decisionHits.push({ kind: "decision", id: d.id, snippet: r.snippet, text: d.text, date: isoFromDbDate(d.date), status: d.status === "ACTIVE" ? "active" : "cancelled", owner: d.ownerId ? (names.get(d.ownerId)?.slug ?? null) : null });
    if (decisionHits.length >= perKind) break;
  }

  // Люди: по имени и должности, без словаря. Общий логин видит только людей топ-команды, как и везде
  const peopleRows = await prisma.person.findMany({
    where: {
      active: true,
      role: { not: "OBSERVER" },
      AND: [
        { OR: [{ fullName: { contains: query, mode: "insensitive" } }, { position: { contains: query, mode: "insensitive" } }, { slug: { contains: query.toLowerCase() } }] },
        ...(subject.limited ? [{ OR: [{ teams: { some: { teamId: TOP_TEAM } } }, { leads: { some: { id: TOP_TEAM } } }] }] : []),
      ],
    },
    orderBy: { sortOrder: "asc" },
    take: perKind,
    select: { slug: true, fullName: true, position: true },
  });
  const personHits: SearchHit[] = peopleRows.map((p) => ({ kind: "person", slug: p.slug, fullName: p.fullName, position: p.position, snippet: mark(p.fullName, query) }));

  const hits = [...taskHits, ...entryHits, ...decisionHits, ...commentHits, ...personHits];
  const truncated = taskHits.length >= perKind || entryHits.length >= perKind || commentHits.length >= perKind || decisionHits.length >= perKind;
  return { query, hits, total: hits.length, truncated };
}

function taskHit(t: { number: number; title: string; status: Prisma.TaskGetPayload<{ select: { status: true } }>["status"]; due: Date; ownerId: string | null; ownerAll: boolean }, snippet: string, names: Map<string, { slug: string }>): SearchHit {
  const code = statusCode(t.status);
  return {
    kind: "task",
    number: t.number,
    title: t.title,
    snippet,
    status: code,
    due: isoFromDbDate(t.due),
    owner: t.ownerAll ? "all" : t.ownerId ? (names.get(t.ownerId)?.slug ?? null) : null,
    closed: ["done", "partial", "failed", "cancelled"].includes(code),
  };
}

/** Подсветить вхождение запроса в коротком тексте, без словаря */
function mark(text: string, query: string): string {
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return text;
  return `${text.slice(0, i)}${MARK_START}${text.slice(i, i + query.length)}${MARK_END}${text.slice(i + query.length)}`;
}
