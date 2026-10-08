// Календарь сроков на сервере (этап 29): личная ссылка, её выдача и отзыв, события для файла календаря.
//
// - ссылку создают в профиле при личном входе. По общему логину нельзя: там выбирают любой профиль;
// - в базе только отпечаток ссылки (sha256), саму ссылку видно один раз. Потеряли: создают новую, старая гаснет;
// - ссылка гаснет сама, если человека выключили, владелец сбросил ему пароль или человек нажал «выйти везде».

import { prisma } from "@/lib/db";
import { addDays, type IsoDate } from "@/domain/dates";
import type { WeekKey } from "@/domain/types";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { dbDate, isoFromDbDate, moscowToday } from "@/lib/tasks/dates";
import { hashToken, newToken } from "@/lib/login/service";
import { personalLogin } from "@/lib/one-on-one/rules";
import { loadTeamNodes } from "@/lib/org/scope";
import { weekSettings } from "@/lib/weekly/service";
import { deadlineOf, meetingOf, reportingKey, shiftWeek } from "@/lib/weekly/weeks";
import { buildIcs } from "./ics";
import { feedEvents, ONE_ON_ONE_DAYS_BACK, TASKS_MAX, WEEKS_AHEAD, WEEKS_BACK, type FeedWeek } from "./rules";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

/** Отметка «когда календарь забирал данные» пишется не чаще этого */
const TOUCH_MS = 15 * 60_000;
const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;

export type FeedView = { exists: boolean; withTitles: boolean; createdAt: string | null; lastUsedAt: string | null };

/** Адрес подписки: путь кончается на .ics, так его понимают все календари */
export function feedUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}/api/calendar/${token}.ics`;
}

function requirePersonal(actor: Actor) {
  if (!personalLogin(actor.via)) fail("Календарь сроков настраивается при личном входе: по общему логину можно выбрать чужой профиль");
  if (actor.role === "OBSERVER") fail("У наблюдателя нет своих сроков и встреч");
}

async function audit(actor: Actor, action: string, after: string) {
  await prisma.auditLog.create({ data: { action, actorId: actor.personId, actorName: actor.fullName, entity: "person", entityId: actor.slug, after, ip: actor.ip ?? null, via: actor.via ?? null } });
}

export async function feedFor(personId: string): Promise<FeedView> {
  const row = await prisma.calendarFeed.findUnique({ where: { personId } });
  return row
    ? { exists: true, withTitles: row.withTitles, createdAt: row.createdAt.toISOString(), lastUsedAt: row.lastUsedAt?.toISOString() ?? null }
    : { exists: false, withTitles: false, createdAt: null, lastUsedAt: null };
}

/** Новая ссылка: прежняя перестаёт работать. Возвращает токен, его показывают один раз */
export async function createFeed(actor: Actor, withTitles: boolean, now = new Date()): Promise<{ token: string }> {
  requirePersonal(actor);
  const token = newToken();
  const data = { tokenHash: hashToken(token), withTitles: !!withTitles, createdAt: now, lastUsedAt: null };
  await prisma.calendarFeed.upsert({ where: { personId: actor.personId }, update: data, create: { personId: actor.personId, ...data } });
  await audit(actor, "calendar.link.create", withTitles ? "ссылка на календарь, с названиями" : "ссылка на календарь, без названий");
  return { token };
}

export async function setFeedTitles(actor: Actor, withTitles: boolean): Promise<void> {
  requirePersonal(actor);
  const result = await prisma.calendarFeed.updateMany({ where: { personId: actor.personId }, data: { withTitles: !!withTitles } });
  if (!result.count) fail("Ссылки на календарь ещё нет: создайте её");
  await audit(actor, "calendar.link.titles", withTitles ? "названия задач в календаре включены" : "названия задач в календаре выключены");
}

export async function revokeFeed(actor: Actor): Promise<void> {
  requirePersonal(actor);
  const result = await prisma.calendarFeed.deleteMany({ where: { personId: actor.personId } });
  if (result.count) await audit(actor, "calendar.link.revoke", "ссылка на календарь отключена");
}

/** Ссылка по токену из адреса. Человек выключен или стал наблюдателем: ссылки нет */
export async function feedByToken(token: string, now = new Date()) {
  if (!TOKEN.test(token)) return null;
  const row = await prisma.calendarFeed.findUnique({ where: { tokenHash: hashToken(token) }, include: { person: { select: { id: true, active: true, role: true } } } });
  if (!row || !row.person.active || row.person.role === "OBSERVER") return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > TOUCH_MS) {
    // updateMany: ссылку могли отключить, пока календарь её забирал. Тогда отметка просто не пишется
    await prisma.calendarFeed.updateMany({ where: { id: row.id }, data: { lastUsedAt: now } });
  }
  return { id: row.id, personId: row.personId, withTitles: row.withTitles };
}

/** Файл календаря человека */
export async function calendarFile(personId: string, withTitles: boolean, base: string, now = new Date()): Promise<string> {
  const today = moscowToday(now);
  const { deadline, meeting } = await weekSettings();
  const reporting = reportingKey(now, deadline);
  const keys: WeekKey[] = [];
  for (let i = -WEEKS_BACK; i <= WEEKS_AHEAD; i++) keys.push(shiftWeek(reporting, i));
  const starts = keys.map(dbDate);

  const [tasks, nodes, weekRows, absences, pairs] = await Promise.all([
    prisma.task.findMany({
      where: { archivedAt: null, status: { in: ["IN_PROGRESS", "CLARIFY"] }, OR: [{ ownerId: personId }, { coExecutors: { some: { personId } } }] },
      select: { id: true, number: true, title: true, due: true },
      orderBy: [{ due: "asc" }, { number: "asc" }],
      take: TASKS_MAX,
    }),
    loadTeamNodes(prisma),
    prisma.week.findMany({ where: { start: { in: starts } }, select: { id: true, start: true, deadline: true, meetingDate: true } }),
    prisma.absence.findMany({ where: { personId, week: { start: { in: starts } } }, select: { week: { select: { start: true } } } }),
    prisma.oneOnOne.findMany({
      where: { status: "PLANNED", date: { gte: dbDate(addDays(today, -ONE_ON_ONE_DAYS_BACK)) }, pair: { OR: [{ managerId: personId }, { reportId: personId }] } },
      select: {
        id: true,
        date: true,
        pair: { select: { id: true, managerId: true, manager: { select: { fullName: true, active: true } }, report: { select: { fullName: true, active: true } } } },
      },
      orderBy: { date: "asc" },
    }),
  ]);
  const weekIds = weekRows.map((w) => w.id);
  const stored = weekIds.length ? await prisma.meeting.findMany({ where: { weekId: { in: weekIds } }, select: { teamId: true, date: true, week: { select: { start: true } } } }) : [];
  const absent = new Set(absences.map((a) => isoFromDbDate(a.week.start)));
  const byKey = new Map(weekRows.map((w) => [isoFromDbDate(w.start), w]));
  const weeks: FeedWeek[] = keys.map((key) => {
    const row = byKey.get(key);
    const meetings = new Map<string, IsoDate>();
    for (const m of stored) if (isoFromDbDate(m.week.start) === key) meetings.set(m.teamId, isoFromDbDate(m.date));
    return {
      key,
      deadline: row?.deadline ?? deadlineOf(key, deadline),
      meetingDate: row ? isoFromDbDate(row.meetingDate) : meetingOf(key, meeting),
      absent: absent.has(key),
      meetings,
    };
  });
  const oneOnOnes = pairs.flatMap((m) => {
    const other = m.pair.managerId === personId ? m.pair.report : m.pair.manager;
    return other.active ? [{ id: m.id, pairId: m.pair.id, date: isoFromDbDate(m.date), otherName: other.fullName }] : [];
  });
  const events = feedEvents({
    personId,
    withTitles,
    base,
    tasks: tasks.map((t) => ({ id: t.id, number: t.number, title: t.title, due: isoFromDbDate(t.due) })),
    weeks,
    nodes,
    oneOnOnes,
  });
  return buildIcs(events, { name: "Сроки weekly", description: "Сроки задач, weekly и встречи из ресурса weekly", stamp: now });
}
