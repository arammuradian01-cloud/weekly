// Отчёт руководителю (этап 73), сервер. Решения Арама 23.10 и 26.10:
// - отчёт CEO становится отчётом руководителю: каждый руководитель делает weekly для своего руководителя;
// - отдельный пункт меню «Отчёт руководителю» с вкладками «Текущая неделя», «Отправленные», «Полученные»;
// - в «Отправленных» ровно то, что ушло (снимки отправки этапа 66), в «Полученных» отчёты подчинённых руководителей по
//   неделям: кто отправил и кто нет;
// - получатель комментирует отчёт целиком и отдельную строку, автор отвечает. Комментарии видят только автор,
//   получатель и владельцы, участники команды нет.
//
// Отчёт: команда и неделя. У команды страхования и инвестиций (топ-команда) это бывший отчёт CEO (ceo_reports), у
// остальных отчёт команды по блокам (team_weekly_reports). Права проверяются здесь, экраны только прячут.

import { cache } from "react";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { WeekKey } from "@/domain/types";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { dbDate, isoFromDbDate } from "@/lib/tasks/dates";
import { notify, quote } from "@/lib/inbox/notify";
import { TOP_TEAM, loadTeamNodes, orderTeams, scopeOf, type TeamNode } from "@/lib/org/scope";
import { canEditTop, ceoRecipients, isCeo, snapshotOf } from "@/lib/ceo/report";
import { ceoContext } from "@/lib/ceo/assembled";
import type { CeoMeeting } from "@/lib/ceo/text";
import { cleanMeetings } from "@/lib/ceo/text";
import { blocksMeta } from "@/lib/weekly-blocks/sources";
import { canLeadTeamReport } from "@/lib/weekly-blocks/team";
import { blocksForLevel, blocksToLegacy, cleanBlocks, sentBlocks, type Labels, type ReportBlock } from "@/lib/weekly-blocks/types";
import { numbersLevel } from "@/lib/plan/access";
import type { CeoSections } from "@/lib/weekly/rules";
import { currentReportingKey } from "@/lib/weekly/service";
import { isWeekKey, shiftWeek, weekNumberOf } from "@/lib/weekly/weeks";
import type { CeoLive } from "@/components/ceo/ceo-assembled";
import {
  REPORT_COMMENT_MAX,
  canReplyComment,
  canStartComment,
  cleanCommentText,
  commentSubject,
  findLine,
  recipientCandidates,
  reportRoles,
  seesComments,
  type ReportRoles,
} from "./rules";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

type Tx = Prisma.TransactionClient;

/** Команды один раз на запрос страницы: их читают права, выбор команды и полученные */
const nodesOnce = cache(() => loadTeamNodes(prisma));

const personal = (actor: Pick<Actor, "via">) => actor.via !== "TEAM";
const ownerMode = (actor: Pick<Actor, "management">) => actor.management === "OWNER";
const manageMode = (actor: Pick<Actor, "management">) => actor.management === "OWNER" || actor.management === "ADMIN";

const namesOf = (value: unknown): { id: string; name: string }[] =>
  Array.isArray(value)
    ? value.flatMap((v) => (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? [{ id: String((v as { id: string }).id), name: String((v as { name?: unknown }).name ?? "") }] : []))
    : [];

// ---------- Команды раздела ----------

export type ReportTeamOption = { id: string; name: string; depth: number; note: string | null };

/**
 * Команды, отчёт которых человек ведёт: где он руководитель (и топ-команда, если он её руководитель), команды ниже его
 * команд (их отчёт может вести руководитель выше). Владелец и администраторы в режиме управления видят все команды.
 * Общий логин без режима управления никакими командами не руководит
 */
export async function reportTeams(actor: Actor): Promise<ReportTeamOption[]> {
  if (actor.role === "OBSERVER" && !manageMode(actor)) return [];
  const nodes = (await nodesOnce()).filter((n) => n.active);
  if (manageMode(actor)) return orderTeams(nodes).map(({ node, depth }) => ({ id: node.id, name: node.name, depth, note: node.leaderId === actor.personId ? "вы руководитель" : null }));
  if (!personal(actor)) return [];
  const scope = scopeOf(nodes, { id: actor.personId, role: actor.role });
  const own = new Set(nodes.filter((n) => n.leaderId === actor.personId).map((n) => n.id));
  const ids = new Set([...own, ...scope.leads]);
  return orderTeams(nodes.filter((n) => ids.has(n.id))).map(({ node, depth }) => ({ id: node.id, name: node.name, depth, note: own.has(node.id) ? "вы руководитель" : "команда ниже" }));
}

/** Может ли человек вести отчёт команды: топ-команда по правилу отчёта CEO, остальные по правилу отчёта команды */
export async function canLeadReport(actor: Actor, teamId: string): Promise<boolean> {
  if (teamId === TOP_TEAM) return canEditTop(actor);
  return canLeadTeamReport(actor, teamId);
}

/** Получатели по структуре для всех команд сразу: команда и id получателя (или null) */
const expectedRecipients = cache(async (): Promise<Map<string, string | null>> => {
  const nodes = (await nodesOnce()).filter((n) => n.active);
  const leaders = [...new Set(nodes.map((n) => n.leaderId).filter((x): x is string => !!x))];
  const [people, ceo] = await Promise.all([
    prisma.person.findMany({ where: { id: { in: leaders } }, select: { id: true, managerId: true } }),
    ceoRecipients(),
  ]);
  const managers = new Map(people.map((p) => [p.id, p.managerId]));
  const candidateIds = [...new Set(nodes.flatMap((n) => recipientCandidates(n, nodes, n.leaderId ? (managers.get(n.leaderId) ?? null) : null)))];
  const active = new Set((await prisma.person.findMany({ where: { id: { in: candidateIds }, active: true }, select: { id: true } })).map((p) => p.id));
  const out = new Map<string, string | null>();
  for (const n of nodes) {
    if (n.id === TOP_TEAM) {
      out.set(n.id, ceo[0]?.id ?? null);
      continue;
    }
    const first = recipientCandidates(n, nodes, n.leaderId ? (managers.get(n.leaderId) ?? null) : null).find((id) => active.has(id));
    out.set(n.id, first ?? null);
  }
  return out;
});

/**
 * Есть ли человеку что показать в разделе: дешёвый признак для меню. Руководитель команды, владелец, режим управления
 * или получатель отчётов (CEO и те, кому отчёт отправляли)
 */
export async function leaderReportVisible(actor: Pick<Actor, "personId" | "role" | "management" | "via">): Promise<boolean> {
  if (manageMode(actor)) return true;
  // По общему логину профиль выбирают сами: раздел только при личном входе, даже владельцу
  if (!personal(actor) || actor.role === "OBSERVER") return false;
  if (actor.role === "OWNER") return true;
  const nodes = await nodesOnce();
  if (nodes.some((n) => n.active && n.leaderId === actor.personId)) return true;
  return receivesSent(actor.personId);
}

/** Для меню: отчёт уже отправляли этому человеку или он CEO. Без расчёта получателей по структуре: это дешевле */
const receivesSent = cache(async (personId: string): Promise<boolean> => {
  const to = { array_contains: [{ id: personId }] };
  const [team, top, ceo] = await Promise.all([
    prisma.teamWeeklyReport.count({ where: { sentAt: { not: null }, sentTo: to } }),
    prisma.ceoReport.count({ where: { sentAt: { not: null }, sentTo: to } }),
    isCeo(personId),
  ]);
  return team + top > 0 || ceo;
});

/** Получает ли человек отчёты, в том числе по структуре (для вкладки по умолчанию): один раз на запрос */
const receivesAny = cache(async (personId: string): Promise<boolean> => {
  const to = { array_contains: [{ id: personId }] };
  const [team, top, ceo] = await Promise.all([
    prisma.teamWeeklyReport.count({ where: { sentAt: { not: null }, sentTo: to } }),
    prisma.ceoReport.count({ where: { sentAt: { not: null }, sentTo: to } }),
    isCeo(personId),
  ]);
  if (team + top > 0 || ceo) return true;
  return [...(await expectedRecipients()).values()].includes(personId);
});

// ---------- Отправленные версии ----------

type SentRow = {
  teamId: string;
  weekId: string;
  week: WeekKey;
  number: number;
  sentAt: Date;
  updatedAt: Date;
  sentById: string | null;
  sentBy: string | null;
  to: { id: string; name: string }[];
  blocks: ReportBlock[] | null;
  sections: CeoSections | null;
  meetings: CeoMeeting[];
};

/** Отправленные версии отчёта команды, свежие первыми. week: только эта неделя */
async function loadSent(teamId: string, opts: { week?: WeekKey; take?: number } = {}): Promise<SentRow[]> {
  const weekWhere = opts.week ? { week: { start: dbDate(opts.week) } } : {};
  if (teamId === TOP_TEAM) {
    const rows = await prisma.ceoReport.findMany({
      where: { sentAt: { not: null }, ...weekWhere },
      include: { week: { select: { start: true, isoNumber: true } }, sentBy: { select: { fullName: true } } },
      orderBy: { week: { start: "desc" } },
      take: opts.take ?? 60,
    });
    return rows.map((r) => {
      const snap = snapshotOf(r.sentSnapshot) ?? { main: r.main, risks: r.risks, next: r.next, meetings: cleanMeetings(r.meetings), blocks: Array.isArray(r.blocks) ? cleanBlocks(r.blocks, null) : null };
      return {
        teamId,
        weekId: r.weekId,
        week: isoFromDbDate(r.week.start),
        number: r.week.isoNumber,
        sentAt: r.sentAt!,
        updatedAt: r.updatedAt,
        sentById: r.sentById,
        sentBy: r.sentBy?.fullName ?? null,
        to: namesOf(r.sentTo),
        blocks: snap.blocks ? sentBlocks(snap.blocks) : null,
        sections: { main: snap.main, risks: snap.risks, next: snap.next },
        meetings: snap.meetings,
      };
    });
  }
  const rows = await prisma.teamWeeklyReport.findMany({
    where: { teamId, sentAt: { not: null }, ...weekWhere },
    include: { week: { select: { start: true, isoNumber: true } } },
    orderBy: { week: { start: "desc" } },
    take: opts.take ?? 60,
  });
  const people = await prisma.person.findMany({ where: { id: { in: rows.map((r) => r.sentById).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
  return rows.map((r) => ({
    teamId,
    weekId: r.weekId,
    week: isoFromDbDate(r.week.start),
    number: r.week.isoNumber,
    sentAt: r.sentAt!,
    updatedAt: r.updatedAt,
    sentById: r.sentById,
    sentBy: people.find((p) => p.id === r.sentById)?.fullName ?? null,
    to: namesOf(r.sentTo),
    blocks: sentBlocks(cleanBlocks(r.sentSnapshot, null)),
    sections: null,
    meetings: [],
  }));
}

function nodeOf(nodes: TeamNode[], teamId: string): TeamNode {
  const node = nodes.find((n) => n.id === String(teamId));
  if (!node) return fail("Такой команды нет");
  return node;
}

const rolesOf = (actor: Actor, node: TeamNode, row: Pick<SentRow, "sentById" | "to">): ReportRoles => reportRoles(actor, { leaderId: node.leaderId, sentById: row.sentById, to: row.to });

export type ArchiveItem = { week: WeekKey; number: number; sentAt: string; sentBy: string | null; to: string[]; editedAfter: boolean; comments: number | null };

/**
 * «Отправленные»: недели, за которые отчёт команды ушёл руководителю, свежие первыми. Видят те, кто ведёт отчёт
 * команды, и владельцы в режиме управления. Число комментариев только тем, кто их видит
 */
export async function sentArchive(actor: Actor, teamId: string): Promise<ArchiveItem[]> {
  const nodes = await nodesOnce();
  const node = nodeOf(nodes, teamId);
  if (!ownerMode(actor) && !(await canLeadReport(actor, node.id))) fail("Отправленные отчёты команды видят те, кто ведёт её отчёт, и владельцы");
  const rows = await loadSent(node.id);
  const counts = rows.length
    ? await prisma.leaderReportComment.groupBy({ by: ["weekId"], where: { teamId: node.id, weekId: { in: rows.map((r) => r.weekId) } }, _count: { _all: true } })
    : [];
  return rows.map((r) => ({
    week: r.week,
    number: r.number,
    sentAt: r.sentAt.toISOString(),
    sentBy: r.sentBy,
    to: r.to.map((t) => t.name),
    editedAfter: r.updatedAt.getTime() > r.sentAt.getTime(),
    comments: seesComments(rolesOf(actor, node, r)) ? (counts.find((c) => c.weekId === r.weekId)?._count._all ?? 0) : null,
  }));
}

export type ReportCommentView = {
  id: string;
  parentId: string | null;
  author: string;
  /** Чья сторона: получатель или автор отчёта */
  side: "recipient" | "author";
  text: string;
  at: string;
  /** К строке: блок и текст строки. lineHidden: строка с цифрами, которых зритель не видит, цитата не показывается */
  blockKey: string | null;
  lineText: string | null;
  lineHidden: boolean;
  /** Строки с таким текстом в отправленной версии больше нет (отчёт отправили ещё раз) */
  lineGone: boolean;
};

export type SentReportView = {
  team: { id: string; name: string };
  week: WeekKey;
  number: number;
  sentAt: string;
  sentBy: string | null;
  to: string[];
  editedAfter: boolean;
  /** Отправленные блоки по уровню цифр зрителя. null: отчёт в прежнем виде (разделы) */
  blocks: ReportBlock[] | null;
  sections: CeoSections | null;
  meetings: CeoMeeting[];
  /** Живые части отчёта топ-команды: решения и благодарности недели, цифры для прежнего вида */
  live: CeoLive | null;
  labels: Labels;
  order: string[];
  roles: ReportRoles;
  canStart: boolean;
  canReply: boolean;
  /** null: комментарии зрителю не видны (участник команды, руководитель выше, администратор) */
  comments: ReportCommentView[] | null;
};

/**
 * Отправленная версия отчёта команды за неделю: ровно то, что ушло, с пометкой, если после отправки правили. Видят те,
 * кто ведёт отчёт команды, получатель (при личном входе) и владельцы в режиме управления. null: за неделю не отправляли
 */
export async function sentReportView(actor: Actor, teamId: string, week: WeekKey): Promise<SentReportView | null> {
  if (!isWeekKey(week)) fail("Неделя задаётся понедельником");
  const nodes = await nodesOnce();
  const node = nodeOf(nodes, teamId);
  const [row] = await loadSent(node.id, { week, take: 1 });
  if (!row) {
    if (!ownerMode(actor) && !(await canLeadReport(actor, node.id))) fail("Отчёт этой команды вам не отправляли");
    return null;
  }
  const roles = rolesOf(actor, node, row);
  if (!roles.recipient && !roles.owner && !roles.author && !(await canLeadReport(actor, node.id))) fail("Отчёт этой команды вам не отправляли");
  const [meta, level, comments] = await Promise.all([
    blocksMeta(),
    numbersLevel({ personId: actor.personId, role: actor.role, management: actor.management }),
    seesComments(roles) ? loadComments(node.id, row.weekId) : Promise.resolve(null),
  ]);
  const blocks = row.blocks ? blocksForLevel(row.blocks, level) : null;
  const live = node.id === TOP_TEAM ? await ceoContext(actor, row.week, { recipient: true }) : null;
  const sections = row.sections && blocks && level !== "full" ? blocksToLegacy(blocks, meta.labels, meta.order) : row.sections;
  const to = new Set(row.to.map((t) => t.id));
  return {
    team: { id: node.id, name: node.name },
    week: row.week,
    number: row.number,
    sentAt: row.sentAt.toISOString(),
    sentBy: row.sentBy,
    to: row.to.map((t) => t.name),
    editedAfter: row.updatedAt.getTime() > row.sentAt.getTime(),
    blocks,
    sections,
    meetings: row.meetings,
    live: live ? { decisions: live.decisions, thanks: live.thanks, numbers: live.numbers, plan: live.plan } : null,
    labels: meta.labels,
    order: meta.order,
    roles,
    canStart: canStartComment(roles),
    canReply: canReplyComment(roles),
    comments: comments
      ? comments.map((c) => {
          const lineAt = c.blockKey && c.lineText !== null ? findLine(row.blocks ?? [], c.blockKey, c.lineText, c.lineIndex) : -1;
          const visible = c.blockKey && c.lineText !== null ? findLine(blocks ?? [], c.blockKey, c.lineText) >= 0 : true;
          return {
            id: c.id,
            parentId: c.parentId,
            author: c.author.fullName,
            side: to.has(c.authorId) ? "recipient" : "author",
            text: c.text,
            at: c.createdAt.toISOString(),
            blockKey: c.blockKey,
            lineText: c.blockKey && visible ? c.lineText : null,
            lineHidden: !!c.blockKey && !visible && lineAt >= 0,
            lineGone: !!c.blockKey && lineAt < 0,
          } satisfies ReportCommentView;
        })
      : null,
  };
}

function loadComments(teamId: string, weekId: string) {
  return prisma.leaderReportComment.findMany({ where: { teamId, weekId }, include: { author: { select: { fullName: true } } }, orderBy: { createdAt: "asc" } });
}

// ---------- Комментарии ----------

export type CommentInput = { teamId: string; week: WeekKey; text: string; parentId?: string | null; blockKey?: string | null; lineText?: string | null };

/**
 * Комментарий к отправленному отчёту. Получатель пишет к отчёту целиком или к строке, автор и получатель отвечают.
 * Только при личном входе. Новый комментарий даёт событие второй стороне: комментарий получателя автору (руководитель
 * команды и тот, кто отправил), ответ автора получателю. Каждый комментарий в журнале
 */
export async function addReportComment(actor: Actor, input: CommentInput, now = new Date()): Promise<SentReportView | null> {
  if (!personal(actor)) fail("Комментировать отчёт можно при личном входе: так видно, кто пишет");
  if (actor.role === "OBSERVER") fail("Наблюдатель отчёты не комментирует");
  const text = cleanCommentText(input?.text);
  if (!text) fail("Напишите комментарий");
  if (text.length > REPORT_COMMENT_MAX) fail(`Комментарий не длиннее ${REPORT_COMMENT_MAX} знаков`);
  if (!isWeekKey(input.week)) fail("Неделя задаётся понедельником");
  const nodes = await nodesOnce();
  const node = nodeOf(nodes, input.teamId);
  const [row] = await loadSent(node.id, { week: input.week, take: 1 });
  if (!row) return fail("Комментировать можно отправленный отчёт");
  const roles = rolesOf(actor, node, row);
  await prisma.$transaction(async (tx) => {
    let parentId: string | null = null;
    let line: { blockKey: string; lineIndex: number; lineText: string } | null = null;
    if (input.parentId) {
      if (!canReplyComment(roles)) fail("Отвечать на комментарии могут автор отчёта и получатель");
      const parent = await tx.leaderReportComment.findUnique({ where: { id: String(input.parentId) }, select: { id: true, parentId: true, teamId: true, weekId: true } });
      if (!parent || parent.teamId !== node.id || parent.weekId !== row.weekId) return fail("Комментарий, на который вы отвечаете, уже удалён");
      // Ветка в один уровень: ответ на ответ встаёт в ту же ветку
      parentId = parent.parentId ?? parent.id;
    } else {
      if (!canStartComment(roles)) fail("Комментарии к отчёту пишет тот, кому его отправили; автор отвечает на них");
      if (input.blockKey) {
        const lineText = String(input.lineText ?? "");
        const index = findLine(row.blocks ?? [], String(input.blockKey), lineText);
        if (index < 0) fail("Такой строки в отправленном отчёте нет: обновите страницу");
        line = { blockKey: String(input.blockKey), lineIndex: index, lineText };
      }
    }
    const created = await tx.leaderReportComment.create({
      data: { teamId: node.id, weekId: row.weekId, authorId: actor.personId, parentId, text, createdAt: now, ...(line ?? {}) },
    });
    await tx.auditLog.create({
      data: {
        action: "report.comment",
        actorId: actor.personId,
        actorName: actor.fullName,
        source: "APP",
        entity: "leader-report",
        entityId: `${node.id}/${row.week}`,
        field: parentId ? "Ответ на комментарий к отчёту руководителю" : line ? "Комментарий к строке отчёта руководителю" : "Комментарий к отчёту руководителю",
        after: line ? `«${quote(line.lineText)}»: ${text}` : text,
        ip: actor.ip ?? null,
        via: actor.via ?? null,
      },
    });
    await notifyOtherSide(tx, actor, node, row, roles, text, created.id, now);
  });
  return sentReportView(actor, node.id, row.week);
}

async function notifyOtherSide(tx: Tx, actor: Actor, node: TeamNode, row: SentRow, roles: ReportRoles, text: string, _commentId: string, now: Date) {
  const authors = [node.leaderId, row.sentById].filter((x): x is string => !!x);
  const recipients = row.to.map((t) => t.id);
  // Получатель пишет: событие автору. Автор отвечает: получателю. Тот, кто сразу и там и там, событие себе не получает
  if (roles.recipient && !roles.author) {
    await notify(tx, { kind: "REPORT_COMMENT", recipients: authors, actor, subject: commentSubject("sent", node.id, row.week), text: `Комментарий к отчёту руководителю за неделю ${row.number} («${node.name}»): «${quote(text)}»` }, now);
  } else {
    await notify(tx, { kind: "REPORT_COMMENT", recipients, actor, subject: commentSubject("received", node.id, row.week), text: `Ответ на комментарий к отчёту руководителю за неделю ${row.number} («${node.name}»): «${quote(text)}»` }, now);
    if (roles.recipient && roles.author) {
      await notify(tx, { kind: "REPORT_COMMENT", recipients: authors, actor, subject: commentSubject("sent", node.id, row.week), text: `Комментарий к отчёту руководителю за неделю ${row.number} («${node.name}»): «${quote(text)}»` }, now);
    }
  }
}

// ---------- Полученные ----------

export type ReceivedItem = {
  team: { id: string; name: string };
  leader: string | null;
  /** Отправлен мне: когда, кем, правили ли после отправки, сколько комментариев */
  sentAt: string | null;
  sentBy: string | null;
  editedAfter: boolean;
  comments: number;
  /** Отчёт ждут от этой команды по сегодняшней структуре (получатель по правилу этапа 66) */
  expected: boolean;
};

export type ReceivedWeek = {
  week: WeekKey;
  number: number;
  reporting: WeekKey;
  /** Неделя раньше: null, если раньше недель в ресурсе нет */
  prev: WeekKey | null;
  next: WeekKey | null;
  items: ReceivedItem[];
};

/** Самая ранняя неделя в ресурсе: дальше назад листать незачем */
const firstWeek = cache(async (): Promise<WeekKey | null> => {
  const w = await prisma.week.findFirst({ orderBy: { start: "asc" }, select: { start: true } });
  return w ? isoFromDbDate(w.start) : null;
});

/**
 * «Полученные» за неделю: отчёты, которые отправили мне, и команды, от которых отчёт ждут по сегодняшней структуре
 * (получатель по правилу этапа 66; у топ-команды CEO). Только при личном входе. Строки недель не создаются
 */
export async function receivedWeek(actor: Actor, wanted?: string | null): Promise<ReceivedWeek> {
  const reporting = await currentReportingKey();
  const first = await firstWeek();
  let key = isWeekKey(wanted) && wanted <= reporting ? wanted : reporting;
  if (first && key < first) key = first;
  const base = { week: key, number: weekNumberOf(key), reporting, prev: first && shiftWeek(key, -1) >= first ? shiftWeek(key, -1) : null, next: key < reporting ? shiftWeek(key, 1) : null };
  if (!personal(actor)) return { ...base, items: [] };
  const [nodes, expected, weekRow] = await Promise.all([nodesOnce(), expectedRecipients(), prisma.week.findUnique({ where: { start: dbDate(key) }, select: { id: true } })]);
  const to = { array_contains: [{ id: actor.personId }] };
  const [teamRows, topRow] = weekRow
    ? await Promise.all([
        prisma.teamWeeklyReport.findMany({ where: { weekId: weekRow.id, sentAt: { not: null }, sentTo: to }, select: { teamId: true, sentAt: true, sentById: true, updatedAt: true } }),
        prisma.ceoReport.findFirst({ where: { weekId: weekRow.id, sentAt: { not: null } }, select: { sentAt: true, sentById: true, updatedAt: true, sentTo: true } }),
      ])
    : [[], null];
  const sent = new Map<string, { sentAt: Date; sentById: string | null; updatedAt: Date }>();
  for (const r of teamRows) sent.set(r.teamId, { sentAt: r.sentAt!, sentById: r.sentById, updatedAt: r.updatedAt });
  if (topRow?.sentAt && namesOf(topRow.sentTo).some((t) => t.id === actor.personId)) sent.set(TOP_TEAM, { sentAt: topRow.sentAt, sentById: topRow.sentById, updatedAt: topRow.updatedAt });
  const expectedTeams = [...expected.entries()].filter(([, id]) => id === actor.personId).map(([teamId]) => teamId);
  const ids = [...new Set([...expectedTeams, ...sent.keys()])];
  const shown = orderTeams(nodes.filter((n) => ids.includes(n.id))).map((x) => x.node);
  const people = await prisma.person.findMany({
    where: { id: { in: [...shown.map((n) => n.leaderId), ...[...sent.values()].map((s) => s.sentById)].filter((x): x is string => !!x) } },
    select: { id: true, fullName: true, active: true },
  });
  const counts = weekRow && sent.size ? await prisma.leaderReportComment.groupBy({ by: ["teamId"], where: { weekId: weekRow.id, teamId: { in: [...sent.keys()] } }, _count: { _all: true } }) : [];
  const nameOf = (id: string | null) => {
    const p = people.find((x) => x.id === id);
    return p ? `${p.fullName}${p.active ? "" : " (выключен)"}` : null;
  };
  return {
    ...base,
    items: shown.map((n) => {
      const s = sent.get(n.id);
      return {
        team: { id: n.id, name: n.name },
        leader: nameOf(n.leaderId),
        sentAt: s?.sentAt.toISOString() ?? null,
        sentBy: s ? nameOf(s.sentById) : null,
        editedAfter: !!s && s.updatedAt.getTime() > s.sentAt.getTime(),
        comments: counts.find((c) => c.teamId === n.id)?._count._all ?? 0,
        expected: expectedTeams.includes(n.id),
      };
    }),
  };
}

/** Есть ли у человека полученные отчёты или команды, от которых отчёт ждут: для вкладки по умолчанию */
export async function hasReceived(actor: Actor): Promise<boolean> {
  if (!personal(actor)) return false;
  return receivesAny(actor.personId);
}

/** Получатель отчёта команды по структуре (для подписи «Отправить руководителю: ФИО») */
export async function expectedRecipientName(teamId: string): Promise<string | null> {
  const id = (await expectedRecipients()).get(teamId) ?? null;
  if (!id) return null;
  return (await prisma.person.findUnique({ where: { id }, select: { fullName: true } }))?.fullName ?? null;
}

/** Получатель ли человек отправленного отчёта команды за неделю (для вкладки по умолчанию) */
export async function isRecipientOf(actor: Actor, teamId: string, week: WeekKey | null): Promise<boolean> {
  if (!personal(actor)) return false;
  if (week) {
    const [row] = await loadSent(teamId, { week, take: 1 });
    if (row) return row.to.some((t) => t.id === actor.personId);
  }
  return (await expectedRecipients()).get(teamId) === actor.personId;
}
