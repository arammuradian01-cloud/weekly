// Отправленные отчёты руководителю (этап 73+81): один отчёт это команда и неделя. У команды страхования и инвестиций
// (топ-команда) отчёт хранится в ceo_reports, у остальных команд в team_weekly_reports. Отправленная версия уже
// хранится снимком с этапа 66, здесь она только читается: ничего не пересобирается и не перезаписывается.
//
// Цифры в блоках урезаются по уровню зрителя (этап 57), как на экранах отчёта CEO и отчёта команды: получатель без
// доступа к цифрам видит вместо них «Цифры видны только с доступом к цифрам».

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { WeekKey } from "@/domain/types";
import type { Actor } from "@/lib/tasks/service";
import { dbDate, isoFromDbDate } from "@/lib/tasks/dates";
import { TOP_TEAM } from "@/lib/org/scope";
import { numbersLevel } from "@/lib/plan/access";
import { blocksForLevel, cleanBlocks, sentBlocks, type ReportBlock, type ViewerLevel } from "@/lib/weekly-blocks/types";
import { reportRoles, type ReportRoles } from "./rules";

type Tx = Prisma.TransactionClient | typeof prisma;

/** Отчёт команды страхования и инвестиций это отчёт CEO: он хранится отдельной таблицей */
export const isCeoReport = (teamId: string) => teamId === TOP_TEAM;

/** Отправленный отчёт как его читает раздел: кто отправил, кому, что ушло */
export type SentReport = {
  teamId: string;
  teamName: string;
  /** Команда ещё работает. false: её расформировали, отчёт остался историей, но открыть её экран уже нельзя */
  teamActive: boolean;
  week: WeekKey;
  weekNumber: number;
  /** ceo: отчёт топ-команды из ceo_reports; team: отчёт команды из team_weekly_reports */
  kind: "ceo" | "team";
  at: string;
  by: string | null;
  sentById: string | null;
  to: { id: string; name: string }[];
  /** После отправки отчёт правили: в разделе показывается именно отправленная версия */
  editedAfter: boolean;
  /** Руководитель команды на сегодня: он имеет доступ к истории как преемник отправителя */
  leaderId: string | null;
  /** Видимые блоки отправленной версии, цифры по уровню зрителя */
  blocks: ReportBlock[];
};

const toList = (value: unknown): { id: string; name: string }[] =>
  Array.isArray(value)
    ? value.flatMap((v) => {
        if (!v || typeof v !== "object") return [];
        const row = v as { id?: unknown; name?: unknown };
        return row.id ? [{ id: String(row.id), name: String(row.name ?? "") }] : [];
      })
    : [];

/** Блоки из снимка: у отчёта команды снимок это список блоков, у отчёта CEO объект со блоками внутри */
function snapshotBlocks(snapshot: unknown): ReportBlock[] {
  if (Array.isArray(snapshot)) return sentBlocks(cleanBlocks(snapshot, null));
  if (snapshot && typeof snapshot === "object") {
    const inner = (snapshot as { blocks?: unknown }).blocks;
    if (Array.isArray(inner)) return sentBlocks(cleanBlocks(inner, null));
  }
  return [];
}

export const levelOf = (actor: Actor): Promise<ViewerLevel> =>
  numbersLevel({ personId: actor.personId, role: actor.role, management: actor.management, via: actor.via });

type Row = {
  teamId: string;
  teamName: string;
  teamActive: boolean;
  week: WeekKey;
  weekNumber: number;
  kind: "ceo" | "team";
  sentAt: Date;
  sentById: string | null;
  sentTo: unknown;
  updatedAt: Date;
  snapshot: unknown;
  leaderId: string | null;
};

/** Отчёты CEO, отправленные за эти недели (или за все, если недели не заданы) */
async function ceoRows(db: Tx, keys: WeekKey[] | null, take: number): Promise<Row[]> {
  const top = await db.team.findUnique({ where: { id: TOP_TEAM }, select: { id: true, name: true, leaderId: true, active: true } });
  if (!top) return [];
  const rows = await db.ceoReport.findMany({
    where: { sentAt: { not: null }, ...(keys ? { week: { start: { in: keys.map((k) => dbDate(k)) } } } : {}) },
    include: { week: { select: { start: true, isoNumber: true } } },
    orderBy: { week: { start: "desc" } },
    take,
  });
  return rows.map((r) => ({
    teamId: top.id,
    teamName: top.name,
    teamActive: top.active,
    week: isoFromDbDate(r.week.start) as WeekKey,
    weekNumber: r.week.isoNumber,
    kind: "ceo" as const,
    sentAt: r.sentAt!,
    sentById: r.sentById,
    sentTo: r.sentTo,
    updatedAt: r.updatedAt,
    snapshot: r.sentSnapshot,
    leaderId: top.leaderId,
  }));
}

/**
 * Отчёты команд, отправленные за эти недели (или за все). Команда выключена - отчёт остаётся: отправленное за прошлую
 * неделю это история, и расформирование команды её не отменяет. Иначе получатель терял и отчёт, и всё обсуждение, а
 * раздел обещает обратное
 */
async function teamRows(db: Tx, keys: WeekKey[] | null, take: number): Promise<Row[]> {
  const rows = await db.teamWeeklyReport.findMany({
    where: { sentAt: { not: null }, ...(keys ? { week: { start: { in: keys.map((k) => dbDate(k)) } } } : {}) },
    include: { week: { select: { start: true, isoNumber: true } }, team: { select: { id: true, name: true, leaderId: true, active: true } } },
    orderBy: { sentAt: "desc" },
    take,
  });
  return rows.map((r) => ({
    teamId: r.team.id,
    teamName: r.team.name,
    teamActive: r.team.active,
    week: isoFromDbDate(r.week.start) as WeekKey,
    weekNumber: r.week.isoNumber,
    kind: "team" as const,
    sentAt: r.sentAt!,
    sentById: r.sentById,
    sentTo: r.sentTo,
    updatedAt: r.updatedAt,
    snapshot: r.sentSnapshot,
    leaderId: r.team.leaderId,
  }));
}

/** Сколько отправленных отчётов читаем за раз: раздел показывает недели, а не всю историю целиком */
const TAKE = 200;

async function namesOf(db: Tx, ids: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((id): id is string => !!id))];
  if (!list.length) return new Map();
  const people = await db.person.findMany({ where: { id: { in: list } }, select: { id: true, fullName: true } });
  return new Map(people.map((p) => [p.id, p.fullName]));
}

async function toSent(db: Tx, rows: Row[], level: ViewerLevel): Promise<SentReport[]> {
  const names = await namesOf(db, rows.map((r) => r.sentById));
  return rows.map((r) => ({
    teamId: r.teamId,
    teamName: r.teamName,
    teamActive: r.teamActive,
    week: r.week,
    weekNumber: r.weekNumber,
    kind: r.kind,
    at: r.sentAt.toISOString(),
    by: r.sentById ? (names.get(r.sentById) ?? null) : null,
    sentById: r.sentById,
    to: toList(r.sentTo),
    editedAfter: r.updatedAt.getTime() > r.sentAt.getTime(),
    leaderId: r.leaderId,
    blocks: blocksForLevel(snapshotBlocks(r.snapshot), level),
  }));
}

/** Один отправленный отчёт по команде и неделе. null: за эту неделю отчёт этой команды не отправляли */
export async function sentReport(actor: Actor, teamId: string, key: WeekKey, db: Tx = prisma): Promise<SentReport | null> {
  const level = await levelOf(actor);
  const rows = isCeoReport(teamId) ? await ceoRows(db, [key], 1) : (await teamRows(db, [key], TAKE)).filter((r) => r.teamId === teamId);
  const list = await toSent(db, rows.slice(0, 1), level);
  return list[0] ?? null;
}

/** Роли зрителя у отчёта: автор, получатель, владелец */
export const rolesOf = (actor: Actor, report: Pick<SentReport, "leaderId" | "sentById" | "to">): ReportRoles =>
  reportRoles({ personId: actor.personId, via: actor.via, management: actor.management }, { leaderId: report.leaderId, sentById: report.sentById, to: report.to });

/**
 * Отчёты, которые отправил этот человек: он руководитель команды отчёта или он нажал «Отправить». Владелец в режиме
 * управления видит отправленные отчёты всех команд: он и так ведёт отчёт CEO и отчёты команд. Общий логин не видит
 * ничего: профиль по нему выбирают сами, чужая переписка с руководителем по нему не открывается
 */
export async function sentReportsOf(actor: Actor, keys: WeekKey[] | null = null): Promise<SentReport[]> {
  if (actor.via === "TEAM") return [];
  const level = await levelOf(actor);
  const [ceo, teams] = await Promise.all([ceoRows(prisma, keys, TAKE), teamRows(prisma, keys, TAKE)]);
  const owner = actor.management === "OWNER";
  const mine = [...ceo, ...teams].filter((r) => owner || r.leaderId === actor.personId || r.sentById === actor.personId);
  const list = await toSent(prisma, mine, level);
  return list.sort((a, b) => (a.week === b.week ? a.teamName.localeCompare(b.teamName, "ru") : a.week < b.week ? 1 : -1));
}

/** Отчёты, отправленные этому человеку: только при личном входе, даже в режиме управления */
export async function receivedReportsOf(actor: Actor, keys: WeekKey[] | null = null): Promise<SentReport[]> {
  if (actor.via === "TEAM") return [];
  const level = await levelOf(actor);
  const [ceo, teams] = await Promise.all([ceoRows(prisma, keys, TAKE), teamRows(prisma, keys, TAKE)]);
  const mine = [...ceo, ...teams].filter((r) => toList(r.sentTo).some((t) => t.id === actor.personId));
  const list = await toSent(prisma, mine, level);
  return list.sort((a, b) => (a.week === b.week ? a.teamName.localeCompare(b.teamName, "ru") : a.week < b.week ? 1 : -1));
}

/**
 * Недели, за которые человеку есть что показать в разделе, и есть ли у него вообще отправленное и полученное. Без
 * снимков: отчёты за все недели читать целиком незачем, снимок это тяжёлый JSON
 */
export async function reportWeeksOf(actor: Actor): Promise<{ weeks: { key: WeekKey; number: number }[]; hasSent: boolean; hasReceived: boolean }> {
  if (actor.via === "TEAM") return { weeks: [], hasSent: false, hasReceived: false };
  const owner = actor.management === "OWNER";
  const week = { select: { start: true, isoNumber: true } } as const;
  const [top, ceo, teams] = await Promise.all([
    prisma.team.findUnique({ where: { id: TOP_TEAM }, select: { leaderId: true } }),
    prisma.ceoReport.findMany({ where: { sentAt: { not: null } }, select: { sentById: true, sentTo: true, week }, orderBy: { week: { start: "desc" } }, take: TAKE }),
    prisma.teamWeeklyReport.findMany({
      // Выключенная команда отчёт не уносит: он уже отправлен, и неделя остаётся в списке раздела
      where: { sentAt: { not: null } },
      select: { sentById: true, sentTo: true, team: { select: { leaderId: true } }, week },
      orderBy: { sentAt: "desc" },
      take: TAKE,
    }),
  ]);
  const rows = [
    ...ceo.map((r) => ({ leaderId: top?.leaderId ?? null, sentById: r.sentById, to: r.sentTo, week: r.week })),
    ...teams.map((r) => ({ leaderId: r.team.leaderId, sentById: r.sentById, to: r.sentTo, week: r.week })),
  ];
  const seen = new Map<WeekKey, number>();
  let hasSent = false;
  let hasReceived = false;
  for (const r of rows) {
    const author = owner || r.leaderId === actor.personId || r.sentById === actor.personId;
    const recipient = toList(r.to).some((t) => t.id === actor.personId);
    if (!author && !recipient) continue;
    hasSent = hasSent || author;
    hasReceived = hasReceived || recipient;
    seen.set(isoFromDbDate(r.week.start) as WeekKey, r.week.isoNumber);
  }
  return { weeks: [...seen.entries()].map(([key, number]) => ({ key, number })).sort((a, b) => (a.key < b.key ? 1 : -1)), hasSent, hasReceived };
}
