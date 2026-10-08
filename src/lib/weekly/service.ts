// Weekly на сервере (раздел 3 ТЗ): недели, сдача в четыре шага, черновик на сервере, лента, отчёт CEO.
// Права проверяются здесь же: экран только прячет то, что нельзя.

import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import type { DeadlineSetting } from "@/lib/week";
import type { Prisma } from "@/generated/prisma/client";
import type { WeeklyState } from "@/generated/prisma/enums";
import { ENTRY_TYPE_CODES, type BlockCode, type DirectionCode, type EntryTypeCode, type WeeklyStateCode } from "@/domain/dictionaries";
import { formatLong, type IsoDate } from "@/domain/dates";
import type { Link, PersonSlug, PersonWeekly, WeekInfo, WeekKey, WeekView, WeeklyEntry } from "@/domain/types";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { dbDate, isoFromDbDate } from "@/lib/tasks/dates";
import { colleaguesOf } from "@/lib/org/people";
import { loadScope, loadTeamNodes, TOP_TEAM } from "@/lib/org/scope";
import { closedFor, expectingTeams, leadersOf, personDeadline, promotableFrom, teamDeadline } from "@/lib/org/rhythm";
import { WEEKLY_LIMITS, canEditWeekly, cleanDash, submitState, type CeoSections } from "./rules";
import { deadlineOf, isWeekKey, meetingOf, reportingKey, shiftWeek, weekEndOf, weekNumberOf, weekYearOf, type MeetingSetting } from "./weeks";
import type { EntrySnapshot } from "./undo";
import { commentDto, mentionsIn, namesOf, reactionDto, reactionInclude } from "@/lib/discuss/common";
import { entryReaders } from "@/lib/discuss/access";
import { entrySubject, notify, quote } from "@/lib/inbox/notify";

export { TaskRuleError as WeeklyRuleError };

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

type Tx = Prisma.TransactionClient;

export async function weekSettings() {
  const [deadline, meeting] = await Promise.all([
    getSetting<DeadlineSetting>("week.deadline", { weekday: 1, time: "18:00" }),
    getSetting<MeetingSetting>("week.meeting", { weekday: 2 }),
  ]);
  return { deadline, meeting };
}

export async function currentReportingKey(now = new Date()): Promise<WeekKey> {
  const { deadline } = await weekSettings();
  return reportingKey(now, deadline);
}

/** Строка недели: создаётся при первом обращении со сроком и днём встречи из настроек */
export async function ensureWeek(db: Tx | typeof prisma, key: WeekKey) {
  if (!isWeekKey(key)) fail("Неделя задаётся понедельником");
  const found = await db.week.findUnique({ where: { start: dbDate(key) } });
  if (found) return found;
  const { deadline, meeting } = await weekSettings();
  // Два запроса создают неделю одновременно: вставка без конфликта по любому ключу, затем чтение. Внутри транзакции
  // ошибку уникальности не перехватить, Postgres прервал бы всю транзакцию
  const id = `w_${crypto.randomUUID()}`;
  await db.$executeRaw`INSERT INTO weeks (id, start, "isoYear", "isoNumber", deadline, "meetingDate")
    VALUES (${id}, ${dbDate(key)}, ${weekYearOf(key)}, ${weekNumberOf(key)}, ${deadlineOf(key, deadline)}, ${dbDate(meetingOf(key, meeting))})
    ON CONFLICT DO NOTHING`;
  return db.week.findUniqueOrThrow({ where: { start: dbDate(key) } });
}

type WeekRow = Awaited<ReturnType<typeof ensureWeek>>;

function weekInfo(row: WeekRow, reporting: WeekKey): WeekInfo {
  const key = isoFromDbDate(row.start);
  return {
    key,
    number: row.isoNumber,
    year: row.isoYear,
    start: key,
    end: weekEndOf(key),
    deadline: row.deadline.toISOString(),
    meetingDate: isoFromDbDate(row.meetingDate),
    closed: row.closedAt !== null,
    reporting: key === reporting,
  };
}

export const entryInclude = {
  week: { select: { start: true } },
  author: { select: { slug: true } },
  direction: { select: { code: true, label: true } },
  block: { select: { code: true, label: true } },
  type: { select: { code: true, label: true } },
  tasks: { select: { number: true }, orderBy: { number: "asc" as const }, take: 1 },
  promotions: { select: { note: true, byId: true, by: { select: { slug: true } } }, orderBy: { createdAt: "asc" as const } },
  // Обсуждение под записью (этап 20)
  comments: { orderBy: { at: "asc" as const }, include: { author: { select: { slug: true } }, reactions: { include: reactionInclude, orderBy: { createdAt: "asc" as const } } } },
  reactions: { include: reactionInclude, orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.WeeklyEntryInclude;

export type EntryRow = Prisma.WeeklyEntryGetPayload<{ include: typeof entryInclude }>;

export function toEntryDto(e: EntryRow): WeeklyEntry {
  return {
    id: e.id,
    week: isoFromDbDate(e.week.start),
    author: (e.author?.slug as PersonSlug | undefined) ?? null,
    direction: e.direction.code as DirectionCode,
    block: e.block.code as BlockCode,
    type: e.type.code as EntryTypeCode,
    what: e.what,
    details: e.details ?? undefined,
    impact: e.impact ?? undefined,
    fact: e.fact ?? undefined,
    next: e.next ?? undefined,
    help: e.help ?? undefined,
    links: Array.isArray(e.links) ? (e.links as Link[]) : [],
    ceo: e.ceo,
    taskNumber: e.tasks[0]?.number,
    updatedAt: e.updatedAt.toISOString(),
    ...(e.factKey ? { factKey: e.factKey } : {}),
    ...(e.promotions.length ? { promoted: e.promotions.map((p) => ({ by: p.by.slug as PersonSlug, ...(p.note ? { note: p.note } : {}) })) } : {}),
    ...(e.comments.length ? { comments: e.comments.map(commentDto) } : {}),
    ...(e.reactions.length ? { reactions: e.reactions.map(reactionDto) } : {}),
  };
}

export const STATE_CODE: Record<WeeklyState, WeeklyStateCode> = { DRAFT: "draft", SUBMITTED: "submitted", LATE: "late" };

// ---------- Чтение ----------

/**
 * Чей weekly показывать (этапы 14-15).
 * - personIds: от кого ждём weekly, их состояние сдачи в полосе «сдали N из M»;
 * - authorIds: чьи записи в ленте (все участники команды, и те специалисты, от кого weekly не ждут);
 *   и записи, которые эти люди подняли наверх из своих команд;
 * - shared: общие записи без автора («Все лидеры» из таблицы), бывают только у топ-команды;
 * - ceo: и записи любой команды с отметкой «В отчёт CEO»;
 * - teamIds: какие команды показаны: по ним срок и закрытие недели в шапке ленты.
 * Без аудитории: все включённые люди, как до команд
 */
export type WeekAudience = { personIds: string[]; authorIds?: string[]; shared: boolean; ceo?: boolean; teamIds?: string[] };

function entryScope(audience: WeekAudience | undefined): Prisma.WeeklyEntryWhereInput {
  if (!audience) return {};
  const authors = audience.authorIds ?? audience.personIds;
  return {
    OR: [
      { authorId: { in: authors } },
      { promotions: { some: { byId: { in: authors } } } },
      ...(audience.shared ? [{ authorId: null }] : []),
      ...(audience.ceo ? [{ ceo: true }] : []),
    ],
  };
}

/** Команды и закрытия недели командами: для сроков людей и закрытия недели (этап 15) */
async function weekTeams(db: Tx | typeof prisma, weekId: string) {
  const [nodes, closes] = await Promise.all([loadTeamNodes(db), db.teamWeekClose.findMany({ where: { weekId }, select: { teamId: true } })]);
  return { nodes, leaders: leadersOf(nodes), closedTeams: new Set(closes.map((c) => c.teamId)) };
}
type WeekTeams = Awaited<ReturnType<typeof weekTeams>>;

/** Неделя закрыта для показанных команд: закрыта неделя департамента или все показанные команды её закрыли */
function viewClosed(row: WeekRow, teams: WeekTeams, teamIds: string[] | undefined): boolean {
  if (row.closedAt) return true;
  if (!teamIds?.length) return false;
  return teamIds.every((id) => id !== TOP_TEAM && teams.closedTeams.has(id));
}

/** Неделя для ленты, режима встречи и отчёта CEO. Без ключа: отчётная, а если она пустая, последняя с записями */
export async function getWeekView(key: WeekKey | null, now = new Date(), audience?: WeekAudience): Promise<WeekView> {
  const reporting = await currentReportingKey(now);
  let target = key && isWeekKey(key) ? key : reporting;
  let fallback = false;
  const scope = entryScope(audience);
  if (!key) {
    const reportingWeek = await prisma.week.findUnique({ where: { start: dbDate(reporting) }, select: { id: true } });
    const filled = reportingWeek ? await prisma.weeklyEntry.count({ where: { AND: [{ weekId: reportingWeek.id }, scope] } }) : 0;
    if (!filled) {
      const latest = await prisma.week.findFirst({ where: { entries: { some: scope }, start: { lt: dbDate(reporting) } }, orderBy: { start: "desc" } });
      if (latest) {
        target = isoFromDbDate(latest.start);
        fallback = true;
      }
    }
  }
  if (target > reporting) target = reporting;
  const row = await ensureWeek(prisma, target);
  const [reports, entries, people, absences, teams] = await Promise.all([
    prisma.weeklyReport.findMany({ where: { weekId: row.id }, include: { author: { select: { slug: true } } } }),
    prisma.weeklyEntry.findMany({ where: { AND: [{ weekId: row.id }, scope] }, include: entryInclude, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    // Люди ленты: от кого ждём weekly и остальные участники, которые могут сдать по желанию (этап 15)
    prisma.person.findMany({
      where: { active: true, role: { not: "OBSERVER" }, ...(audience ? { id: { in: [...new Set([...audience.personIds, ...(audience.authorIds ?? [])])] } } : {}) },
      orderBy: { sortOrder: "asc" },
    }),
    absenceMap(row.id),
    weekTeams(prisma, row.id),
  ]);
  const byAuthor = new Map(reports.map((r) => [r.author.slug, r]));
  const expected = audience ? new Set(audience.personIds) : null;
  const authorSlugs = audience ? await slugsOfIds(audience.authorIds ?? audience.personIds) : null;
  const info = weekInfo(row, reporting);
  info.closed = viewClosed(row, teams, audience?.teamIds);
  // Срок показанной команды: у одной команды её срок, у нескольких срок департамента
  const shown = audience?.teamIds?.length === 1 ? teams.nodes.find((n) => n.id === audience.teamIds![0]) : undefined;
  if (shown) info.deadline = teamDeadline(target, shown, row.deadline).toISOString();
  return {
    week: info,
    prev: shiftWeek(target, -1),
    next: target < reporting ? shiftWeek(target, 1) : null,
    reportingKey: reporting,
    reportingNumber: weekNumberOf(reporting),
    fallback,
    reports: people.map((p) => {
      const r = byAuthor.get(p.slug);
      return {
        week: target,
        author: p.slug as PersonSlug,
        headline: r?.headline ?? "",
        ...(r?.thanks ? { thanks: r.thanks } : {}),
        state: r ? STATE_CODE[r.state] : "not-started",
        submittedAt: r?.submittedAt?.toISOString(),
        ...(absences.has(p.id) ? { absent: { substitute: absences.get(p.id)! } } : {}),
        ...deadlineField(p.id, target, row, teams),
        ...(expected && !expected.has(p.id) ? { optional: true } : {}),
      } satisfies PersonWeekly;
    }),
    // Фраза руководителя к поднятой записи видна только в ленте, где он сам автор: автору записи её не показываем
    entries: entries.map((e) => keepNotes(toEntryDto(e), (slug) => !authorSlugs || authorSlugs.includes(slug))),
    departmentClosed: row.closedAt !== null,
    ...(authorSlugs ? { authors: authorSlugs } : {}),
  };
}

/** Одна запись с обсуждением, без проверки доступа: её делает вызывающий (страница записи, этап 20) */
export async function getEntry(id: string): Promise<WeeklyEntry | null> {
  const row = await prisma.weeklyEntry.findUnique({ where: { id: String(id) }, include: entryInclude });
  // Фразы руководителей к поднятой записи на отдельной странице не показываем: они видны только в их ленте
  return row ? keepNotes(toEntryDto(row), () => false) : null;
}

/** Оставить фразы только тех, кто поднял запись и кому её можно показать */
function keepNotes(e: WeeklyEntry, allowed: (slug: PersonSlug) => boolean): WeeklyEntry {
  if (!e.promoted) return e;
  return { ...e, promoted: e.promoted.map((p) => (allowed(p.by) ? p : { by: p.by })) };
}

async function slugsOfIds(ids: string[]): Promise<PersonSlug[]> {
  if (!ids.length) return [];
  return (await prisma.person.findMany({ where: { id: { in: ids } }, select: { slug: true } })).map((p) => p.slug as PersonSlug);
}

/** Свой срок человека, если он раньше срока департамента: команда ниже сдаёт раньше */
function deadlineField(personId: string, key: WeekKey, row: WeekRow, teams: WeekTeams): { deadline?: string } {
  const d = personDeadline(personId, key, teams.nodes, row.deadline, teams.leaders);
  return d.getTime() < row.deadline.getTime() ? { deadline: d.toISOString() } : {};
}

/** Мой weekly за неделю: для экрана сдачи и «Моей недели» */
export async function getMyWeekly(personId: string, key: WeekKey, now = new Date()) {
  const reporting = await currentReportingKey(now);
  const row = await ensureWeek(prisma, key);
  const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });
  const [report, entries, absence, teams, promoted] = await Promise.all([
    prisma.weeklyReport.findUnique({ where: { weekId_authorId: { weekId: row.id, authorId: personId } } }),
    prisma.weeklyEntry.findMany({ where: { weekId: row.id, authorId: personId }, include: entryInclude, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.absence.findUnique({ where: { personId_weekId: { personId, weekId: row.id } }, include: { substitute: { select: { slug: true } } } }),
    weekTeams(prisma, row.id),
    prisma.weeklyEntry.findMany({ where: { weekId: row.id, promotions: { some: { byId: personId } } }, include: entryInclude, orderBy: [{ createdAt: "asc" }] }),
  ]);
  const info = weekInfo(row, reporting);
  info.deadline = personDeadline(personId, key, teams.nodes, row.deadline, teams.leaders).toISOString();
  info.closed = closedFor(personId, teams.nodes, row.closedAt !== null, teams.closedTeams, teams.leaders);
  const expecting = expectingTeams(personId, teams.nodes, teams.leaders);
  return {
    week: info,
    /** Команды, которые ждут weekly человека. Пусто: weekly от него не ждут, достаточно обновлять задачи */
    expectedIn: expecting.map((n) => ({ id: n.id, name: n.name })),
    /** Записи людей его команд, которые он поднял в свой weekly */
    promoted: promoted.map((e) => keepNotes(toEntryDto(e), (slug) => slug === person.slug)),
    report: {
      week: key,
      author: person.slug as PersonSlug,
      headline: report?.headline ?? "",
      ...(report?.thanks ? { thanks: report.thanks } : {}),
      state: report ? STATE_CODE[report.state] : "not-started",
      submittedAt: report?.submittedAt?.toISOString(),
      ...(absence ? { absent: { substitute: (absence.substitute?.slug as PersonSlug | undefined) ?? null } } : {}),
    } satisfies PersonWeekly,
    entries: entries.map((e) => keepNotes(toEntryDto(e), () => false)),
  };
}

/** Состояние сдачи у всех за неделю: для «Команды» и «Моей недели» */
export async function weeklyStates(key: WeekKey, audience?: WeekAudience): Promise<PersonWeekly[]> {
  const view = await getWeekView(key, new Date(), audience);
  return view.reports;
}

// ---------- Правки ----------

function viewerOf(actor: Actor) {
  return { slug: actor.slug, management: actor.management, observer: actor.role === "OBSERVER" };
}

function clean(text: string | null | undefined): string {
  return cleanDash(text ?? "").trim();
}

function optional(text: string | null | undefined, max: number, field: string): string | null {
  const v = clean(text);
  if (!v) return null;
  if (v.length > max) fail(`${field}: не длиннее ${max} знаков`);
  return v;
}

function checkLinks(links: unknown): Link[] {
  if (!Array.isArray(links)) return [];
  return links.slice(0, 10).map((l) => {
    const raw = clean((l as Link)?.url);
    let url: URL;
    try {
      url = new URL(raw);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    } catch {
      return fail("Ссылка должна начинаться с https:// или http://");
    }
    if (raw.length > WEEKLY_LIMITS.url) fail(`Ссылка длиннее ${WEEKLY_LIMITS.url} знаков`);
    const title = optional((l as Link)?.title, WEEKLY_LIMITS.linkTitle, "Название ссылки") ?? url.hostname;
    return { title, url: url.toString() };
  });
}

export async function audit(db: Tx, actor: Actor, action: string, entity: string, entityId: string, field: string, before?: string | null, after?: string | null) {
  await db.auditLog.create({
    data: { action, actorId: actor.personId, actorName: actor.fullName, source: "APP", entity, entityId, field, before: before ?? undefined, after: after ?? undefined, ip: actor.ip ?? null, via: actor.via ?? null },
  });
}

/**
 * Неделя для правки weekly. author: чей weekly правят. Неделя закрыта для него, если её закрыл администратор
 * или все команды, которые ждут его weekly (этап 15). Общие записи без автора закрываются только с неделей департамента
 */
export async function weekContext(tx: Tx, key: WeekKey, authorId?: string | null) {
  const reporting = await currentReportingKey();
  const row = await ensureWeek(tx, key);
  const info = weekInfo(row, reporting);
  if (authorId && !info.closed) {
    const teams = await weekTeams(tx, row.id);
    info.closed = closedFor(authorId, teams.nodes, false, teams.closedTeams, teams.leaders);
  }
  return { row, info, reporting };
}

export function canEdit(info: WeekInfo, reporting: WeekKey, actor: Actor, author: PersonSlug | null): void {
  if (canEditWeekly(info, reporting, viewerOf(actor), author)) return;
  if (actor.role === "OBSERVER") fail("Наблюдатель weekly не пишет");
  if (info.closed) fail(`Неделя ${info.number} закрыта: записи правят только владелец и администраторы`);
  if (info.key > reporting) fail("За будущую неделю weekly не пишут");
  fail("Чужой weekly правят только владелец и администраторы");
}

async function reportOf(tx: Tx, weekId: string, authorId: string) {
  return tx.weeklyReport.findUnique({ where: { weekId_authorId: { weekId, authorId } } });
}

/** Главное одной фразой. Черновик сохраняется сам; после сдачи каждая правка пишется в журнал */
/** expected: главная фраза, с которой начат черновик с устройства (этап 26). На сервере уже другая: поверх не пишем */
export async function saveHeadline(actor: Actor, key: WeekKey, headline: string, expected?: string): Promise<PersonWeekly> {
  const value = clean(headline);
  if (value.length > WEEKLY_LIMITS.headline) fail(`Главное: не длиннее ${WEEKLY_LIMITS.headline} знаков`);
  return prisma.$transaction(async (tx) => {
    const { row, info, reporting } = await weekContext(tx, key, actor.personId);
    canEdit(info, reporting, actor, actor.slug);
    const existing = await reportOf(tx, row.id, actor.personId);
    if (typeof expected === "string" && clean(existing?.headline ?? "") !== clean(expected) && clean(existing?.headline ?? "") !== value) fail(HEADLINE_CONFLICT);
    const report = await tx.weeklyReport.upsert({
      where: { weekId_authorId: { weekId: row.id, authorId: actor.personId } },
      update: { headline: value },
      create: { weekId: row.id, authorId: actor.personId, headline: value, state: "DRAFT" },
    });
    if (!existing) await audit(tx, actor, "weekly.draft", "weekly", `${key}/${actor.slug}`, "Weekly начат", null, `Неделя ${info.number}`);
    else if (existing.state !== "DRAFT" && existing.headline !== value) {
      await audit(tx, actor, "weekly.update", "weekly", `${key}/${actor.slug}`, "Главное за неделю", existing.headline, value);
    }
    return { week: key, author: actor.slug, headline: report.headline, state: STATE_CODE[report.state], submittedAt: report.submittedAt?.toISOString() };
  });
}

/** «Спасибо @коллега за…» одной строкой (этап 22) */
export const THANKS_MAX = 300;

/**
 * Благодарность в weekly: необязательная строка, попадает в ленту и блок отчёта CEO. Упомянутый коллега получает
 * событие один раз, повторное сохранение его не дублирует
 */
export async function saveThanks(actor: Actor, key: WeekKey, text: string): Promise<{ thanks: string; warning?: string }> {
  const value = clean(text);
  if (value.length > THANKS_MAX) fail(`Благодарность: не длиннее ${THANKS_MAX} знаков`);
  return prisma.$transaction(async (tx): Promise<{ thanks: string; warning?: string }> => {
    const { row, info, reporting } = await weekContext(tx, key, actor.personId);
    canEdit(info, reporting, actor, actor.slug);
    const existing = await reportOf(tx, row.id, actor.personId);
    if ((existing?.thanks ?? "") === value) return { thanks: value };
    const report = await tx.weeklyReport.upsert({
      where: { weekId_authorId: { weekId: row.id, authorId: actor.personId } },
      update: { thanks: value || null },
      create: { weekId: row.id, authorId: actor.personId, thanks: value || null, state: "DRAFT" },
    });
    if (existing && existing.state !== "DRAFT") await audit(tx, actor, "weekly.update", "weekly", `${key}/${actor.slug}`, "Благодарность", existing.thanks, value || null);
    const fresh = (await mentionsIn(tx, [value], actor.personId)).filter((id) => !report.thanksMentions.includes(id));
    if (!fresh.length) return { thanks: value };
    // Событие получает только тот, кто видит weekly автора, как и при упоминании в записи
    const reach = await entryReaders(tx, { authorId: actor.personId, ceo: false, promotedBy: [] }, fresh);
    await tx.weeklyReport.update({ where: { id: report.id }, data: { thanksMentions: { push: fresh } } });
    if (reach.length) {
      await notify(tx, { kind: "THANKS", recipients: reach, actor, subject: `thanks:${key}:${actor.slug}`, text: `Благодарность в weekly за неделю ${info.number}: «${quote(value)}»` });
    }
    const lost = fresh.filter((id) => !reach.includes(id));
    if (!lost.length) return { thanks: value };
    const names = await namesOf(tx, lost);
    return { thanks: value, warning: `Благодарность не дошла: ${names.join(", ")} ${names.length > 1 ? "не видят" : "не видит"} ваш weekly` };
  });
}

export type EntryInput = {
  id?: string;
  week: WeekKey;
  direction: string;
  block: string;
  type: string;
  what: string;
  details?: string;
  impact?: string;
  fact?: string;
  next?: string;
  help?: string;
  links?: Link[];
  /** Запись из факта недели (этап 22): ставит только сервер, из экрана не приходит */
  factKey?: string;
  /**
   * Ключ черновика новой записи с устройства (этап 26). Повтор с тем же ключом после обрыва связи правит уже созданную
   * запись, а не создаёт вторую
   */
  clientKey?: string;
  /**
   * Черновик с устройства начат с версии записи от этого времени (этап 26). Запись изменили позже: черновик поверх
   * не записываем, человек узнаёт об этом
   */
  baseUpdatedAt?: string;
};

const CLIENT_KEY = /^[A-Za-z0-9_-]{8,64}$/;
export const ENTRY_CONFLICT = "Запись уже изменили на другом устройстве: черновик с этого устройства не отправлен";
export const HEADLINE_CONFLICT = "Главную фразу уже изменили на другом устройстве: черновик с этого устройства не отправлен";

/** Значение справочника по коду. Скрытое в справочнике можно оставить, если запись уже с ним, выбрать заново нельзя */
async function dictItem(tx: Tx, kind: "DIRECTION" | "WEEKLY_BLOCK" | "ENTRY_TYPE", code: string, message: string, currentId?: string) {
  const item = await tx.dictionaryItem.findFirst({ where: { kind, code } });
  if (!item || (!item.active && item.id !== currentId)) fail(message);
  return item!;
}

function linksText(value: unknown): string | null {
  const list = Array.isArray(value) ? (value as { title?: string; url?: string }[]) : [];
  return list.length ? list.map((l) => (l.title ? `${l.title}: ${l.url}` : (l.url ?? ""))).join(", ") : null;
}

/** Записанная запись. warning: упоминание не дошло до тех, кто запись не видит (этап 20) */
export type SavedEntry = WeeklyEntry & { warning?: string };

/**
 * Упоминания в записи (этап 20): событие получает только тот, кого упомянули впервые, и только если он видит запись.
 * Упомянутый подписывается на запись и дальше видит комментарии к ней
 */
async function mentionEntry(tx: Tx, actor: Actor, saved: EntryRow): Promise<{ mentions: string[]; warning?: string }> {
  const authorId = saved.authorId ?? actor.personId;
  const found = (await mentionsIn(tx, [saved.what, saved.details, saved.impact, saved.fact, saved.next, saved.help], authorId)).filter((id) => id !== actor.personId);
  const fresh = found.filter((id) => !saved.mentions.includes(id));
  if (!fresh.length) return { mentions: saved.mentions };
  const reach = await entryReaders(tx, { authorId: saved.authorId, ceo: saved.ceo, promotedBy: saved.promotions.map((p) => p.byId) }, fresh);
  // Запоминаем всех упомянутых, и тех, до кого не дошло: автосохранение не повторяет ни событие, ни предупреждение
  await tx.weeklyEntry.update({ where: { id: saved.id }, data: { mentions: [...saved.mentions, ...fresh] } });
  if (reach.length) {
    await tx.entryWatch.createMany({ data: reach.map((personId) => ({ entryId: saved.id, personId })), skipDuplicates: true });
    await notify(tx, { kind: "MENTION", recipients: reach, actor, subject: entrySubject(saved.id), entryId: saved.id, text: `Упоминание в записи weekly: «${quote(saved.what)}»` });
  }
  const lost = fresh.filter((id) => !reach.includes(id));
  if (!lost.length) return { mentions: [...saved.mentions, ...fresh] };
  const names = await namesOf(tx, lost);
  return { mentions: [...saved.mentions, ...fresh], warning: `Упоминание не дошло: ${names.join(", ")} ${names.length > 1 ? "не видят" : "не видит"} эту запись` };
}

/** Создать или поправить запись. Автор: тот, кто пишет; чужие записи правят владелец и администраторы */
export async function saveEntry(actor: Actor, input: EntryInput): Promise<SavedEntry> {
  const what = clean(input.what);
  if (!what) fail("Напишите одной фразой, что произошло");
  if (what.length > WEEKLY_LIMITS.what) fail(`«Что произошло» длиннее ${WEEKLY_LIMITS.what} знаков: сократите до одной фразы`);
  const details = optional(input.details, WEEKLY_LIMITS.details, "Подробнее");
  const impact = optional(input.impact, WEEKLY_LIMITS.impact, "Влияние на бизнес");
  const fact = optional(input.fact, WEEKLY_LIMITS.fact, "Цифра или факт");
  const next = optional(input.next, WEEKLY_LIMITS.next, "Что делаем дальше");
  const help = optional(input.help, WEEKLY_LIMITS.help, "Какая помощь нужна");
  const links = checkLinks(input.links ?? []);

  const clientKey = !input.id && typeof input.clientKey === "string" && CLIENT_KEY.test(input.clientKey) ? input.clientKey : null;

  return prisma.$transaction(async (tx) => {
    // Две отправки одного черновика (обрыв связи, повтор с телефона) идут по очереди: вторая правит запись первой
    if (clientKey) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`entry-client:${actor.personId}:${clientKey}`}))::text`;
    const existing = input.id
      ? await tx.weeklyEntry.findUnique({ where: { id: input.id }, include: entryInclude })
      : clientKey
        ? await tx.weeklyEntry.findFirst({ where: { authorId: actor.personId, clientKey }, include: entryInclude })
        : null;
    if (input.id && !existing) fail("Запись уже удалена");

    const key = existing ? isoFromDbDate(existing.week.start) : input.week;
    const { row, info, reporting } = await weekContext(tx, key, existing ? existing.authorId : actor.personId);
    const author = existing ? ((existing.author?.slug as PersonSlug | undefined) ?? null) : actor.slug;
    canEdit(info, reporting, actor, author);
    if (!(ENTRY_TYPE_CODES as string[]).includes(input.type)) fail("Выберите тип записи");
    const direction = await dictItem(tx, "DIRECTION", input.direction, "Выберите направление из списка", existing?.directionId);
    const block = await dictItem(tx, "WEEKLY_BLOCK", input.block, "Выберите блок из списка", existing?.blockId);
    const type = await dictItem(tx, "ENTRY_TYPE", input.type, "Выберите тип записи", existing?.typeId);
    const data = {
      directionId: direction.id,
      blockId: block.id,
      typeId: type.id,
      what,
      details,
      impact,
      fact,
      next,
      help,
      links: links as unknown as Prisma.InputJsonValue,
    };
    // Черновик с устройства начат со старой версии: если на сервере уже другой текст, поверх не пишем. Тот же текст
    // (ответ на прошлую отправку потерялся по дороге) не конфликт
    const base = input.baseUpdatedAt ? Date.parse(input.baseUpdatedAt) : NaN;
    if (existing && Number.isFinite(base) && existing.updatedAt.getTime() > base) {
      const same =
        existing.what === what &&
        (existing.details ?? null) === details &&
        (existing.impact ?? null) === impact &&
        (existing.fact ?? null) === fact &&
        (existing.next ?? null) === next &&
        (existing.help ?? null) === help &&
        existing.directionId === direction.id &&
        existing.blockId === block.id &&
        existing.typeId === type.id &&
        linksText(existing.links) === linksText(links);
      if (!same) fail(ENTRY_CONFLICT);
    }
    let saved: EntryRow;
    if (existing) {
      saved = await tx.weeklyEntry.update({ where: { id: existing.id }, data, include: entryInclude });
      const report = existing.authorId ? await reportOf(tx, row.id, existing.authorId) : null;
      // Пока weekly черновик, автосохранение автора журнал не засоряет. После сдачи, в закрытой неделе
      // и когда чужую запись правит владелец или администратор, пишем каждую правку
      if (report?.state !== "DRAFT" || info.closed || existing.authorId !== actor.personId) {
        const changes: [string, string | null | undefined, string | null | undefined][] = [
          ["Что произошло", existing.what, what],
          ["Подробнее", existing.details, details],
          ["Влияние на бизнес", existing.impact, impact],
          ["Цифра или факт", existing.fact, fact],
          ["Что делаем дальше", existing.next, next],
          ["Нужна помощь", existing.help, help],
          ["Блок", existing.block.label, block.label],
          ["Направление", existing.direction.label, direction.label],
          ["Тип", existing.type.label, type.label],
          ["Ссылки", linksText(existing.links), linksText(links)],
        ];
        for (const [field, before, after] of changes) {
          if ((before ?? null) !== (after ?? null)) await audit(tx, actor, "weekly.entry.update", "weekly-entry", existing.id, field, before, after);
        }
      }
    } else {
      const count = await tx.weeklyEntry.count({ where: { weekId: row.id, authorId: actor.personId } });
      // Двойное нажатие «Добавить» у факта: второй запрос ждёт первый и получает понятный отказ
      if (input.factKey) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fact:${row.id}:${actor.personId}:${input.factKey}`}))::text`;
      if (input.factKey && (await tx.weeklyEntry.findFirst({ where: { weekId: row.id, authorId: actor.personId, factKey: input.factKey }, select: { id: true } }))) {
        fail("Этот факт уже в weekly");
      }
      saved = await tx.weeklyEntry.create({ data: { ...data, weekId: row.id, authorId: actor.personId, sortOrder: count, factKey: input.factKey ?? null, clientKey }, include: entryInclude });
      await tx.weeklyReport.upsert({
        where: { weekId_authorId: { weekId: row.id, authorId: actor.personId } },
        update: {},
        create: { weekId: row.id, authorId: actor.personId, state: "DRAFT" },
      });
      await audit(tx, actor, "weekly.entry.create", "weekly-entry", saved.id, "Запись weekly", null, `Неделя ${info.number}: ${what}`);
    }
    const mention = await mentionEntry(tx, actor, saved);
    return { ...toEntryDto(saved), ...(mention.warning ? { warning: mention.warning } : {}) };
  });
}

/** Удаление возвращает полную копию записи: по ней отмена вернёт запись с тем же id */
export async function deleteEntry(actor: Actor, id: string): Promise<EntrySnapshot> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.weeklyEntry.findUnique({
      where: { id },
      include: {
        ...entryInclude,
        tasks: { select: { id: true } },
        helpRequests: { select: { id: true } },
        promotions: { select: { byId: true, note: true, createdAt: true } },
        comments: { include: { reactions: true } },
        reactions: true,
        watches: { select: { personId: true } },
        promiseReview: { select: { id: true } },
        carriedFrom: { select: { id: true } },
      },
    });
    if (!existing) return fail("Запись уже удалена");
    const { info, reporting } = await weekContext(tx, isoFromDbDate(existing.week.start), existing.authorId);
    canEdit(info, reporting, actor, (existing.author?.slug as PersonSlug | undefined) ?? null);
    const snapshot: EntrySnapshot = {
      id: existing.id,
      weekId: existing.weekId,
      authorId: existing.authorId,
      directionId: existing.directionId,
      blockId: existing.blockId,
      typeId: existing.typeId,
      what: existing.what,
      details: existing.details,
      impact: existing.impact,
      fact: existing.fact,
      next: existing.next,
      help: existing.help,
      links: existing.links,
      ceo: existing.ceo,
      sortOrder: existing.sortOrder,
      importBatch: existing.importBatch,
      factKey: existing.factKey,
      createdAt: existing.createdAt.toISOString(),
      taskIds: existing.tasks.map((t) => t.id),
      requestIds: existing.helpRequests.map((r) => r.id),
      promotions: existing.promotions.map((p) => ({ byId: p.byId, note: p.note, createdAt: p.createdAt.toISOString() })),
      mentions: existing.mentions,
      // Обсуждение возвращается вместе с записью (этап 20)
      comments: existing.comments.map((c) => ({ id: c.id, authorId: c.authorId, text: c.text, mentions: c.mentions, at: c.at.toISOString(), editedAt: c.editedAt?.toISOString() ?? null })),
      reactions: [...existing.reactions, ...existing.comments.flatMap((c) => c.reactions)].map((r) => ({
        kind: r.kind,
        personId: r.personId,
        entryCommentId: r.entryCommentId,
        question: r.question,
        discussedAt: r.discussedAt?.toISOString() ?? null,
        discussedById: r.discussedById,
        createdAt: r.createdAt.toISOString(),
      })),
      watchers: existing.watches.map((w) => w.personId),
      promiseReviewId: existing.promiseReview?.id ?? null,
      carriedFromReviewId: existing.carriedFrom?.id ?? null,
    };
    await tx.weeklyEntry.delete({ where: { id } });
    await audit(tx, actor, "weekly.entry.delete", "weekly-entry", id, "Запись weekly удалена", existing.what, null);
    return snapshot;
  });
}

/**
 * Отмена удаления: запись возвращается с тем же id, автором, порядком и связью с задачами.
 * Права те же, что на удаление: если неделю за это время закрыли, вернуть может только управление
 */
export async function restoreEntry(actor: Actor, snapshot: EntrySnapshot): Promise<WeeklyEntry> {
  return prisma.$transaction(async (tx) => {
    if (await tx.weeklyEntry.findUnique({ where: { id: snapshot.id }, select: { id: true } })) fail("Запись уже на месте");
    const week = await tx.week.findUnique({ where: { id: snapshot.weekId } });
    if (!week) return fail("Неделя этой записи больше не существует");
    const { info, reporting } = await weekContext(tx, isoFromDbDate(week.start), snapshot.authorId);
    const author = snapshot.authorId ? await tx.person.findUnique({ where: { id: snapshot.authorId }, select: { slug: true } }) : null;
    canEdit(info, reporting, actor, (author?.slug as PersonSlug | undefined) ?? null);
    const saved = await tx.weeklyEntry.create({
      data: {
        id: snapshot.id,
        weekId: snapshot.weekId,
        authorId: snapshot.authorId,
        directionId: snapshot.directionId,
        blockId: snapshot.blockId,
        typeId: snapshot.typeId,
        what: snapshot.what,
        details: snapshot.details,
        impact: snapshot.impact,
        fact: snapshot.fact,
        next: snapshot.next,
        help: snapshot.help,
        links: (snapshot.links ?? []) as Prisma.InputJsonValue,
        ceo: snapshot.ceo,
        sortOrder: snapshot.sortOrder,
        importBatch: snapshot.importBatch,
        // Тот же факт за это время добавили снова: возвращённая запись остаётся обычной
        factKey:
          snapshot.factKey && !(await tx.weeklyEntry.findFirst({ where: { weekId: snapshot.weekId, authorId: snapshot.authorId, factKey: snapshot.factKey }, select: { id: true } }))
            ? snapshot.factKey
            : null,
        createdAt: new Date(snapshot.createdAt),
        // События об упоминаниях удалились вместе с записью: следующая правка упомянет людей заново
        mentions: [],
      },
      include: entryInclude,
    });
    // Связь с задачами возвращаем прямым запросом: так у задач не меняется «Обновлена», как и при удалении записи
    if (snapshot.taskIds.length) {
      await tx.$executeRaw`UPDATE tasks SET "weeklyEntryId" = ${snapshot.id} WHERE id = ANY(${snapshot.taskIds}::text[]) AND "weeklyEntryId" IS NULL`;
    }
    if (snapshot.requestIds?.length) {
      await tx.$executeRaw`UPDATE help_requests SET "entryId" = ${snapshot.id} WHERE id = ANY(${snapshot.requestIds}::text[]) AND "entryId" IS NULL`;
    }
    // Итог обещания возвращается к записи, перенесённый план к своему итогу (этап 22), если их за это время не заняли
    if (snapshot.promiseReviewId) {
      await tx.$executeRaw`UPDATE promise_reviews SET "entryId" = ${snapshot.id} WHERE id = ${snapshot.promiseReviewId} AND "entryId" IS NULL`;
    }
    if (snapshot.carriedFromReviewId) {
      await tx.$executeRaw`UPDATE promise_reviews SET "carriedId" = ${snapshot.id} WHERE id = ${snapshot.carriedFromReviewId} AND "carriedId" IS NULL AND result IN ('PARTIAL', 'NOT_DONE')`;
    }
    // Отметки «наверх» возвращаются вместе с записью, кроме тех, чьих людей за это время удалили
    const promotions = snapshot.promotions ?? [];
    if (promotions.length) {
      const alive = new Set((await tx.person.findMany({ where: { id: { in: promotions.map((p) => p.byId) } }, select: { id: true } })).map((p) => p.id));
      await tx.weeklyPromotion.createMany({
        data: promotions.filter((p) => alive.has(p.byId)).map((p) => ({ entryId: snapshot.id, byId: p.byId, note: p.note, createdAt: new Date(p.createdAt) })),
        skipDuplicates: true,
      });
    }
    await restoreDiscussion(tx, snapshot);
    await audit(tx, actor, "weekly.entry.restore", "weekly-entry", snapshot.id, "Удаление записи weekly отменено", null, snapshot.what);
    return toEntryDto(await tx.weeklyEntry.findUniqueOrThrow({ where: { id: saved.id }, include: entryInclude }));
  });
}

/** Обсуждение удалённой записи: комментарии, реакции и подписки тех людей, кто ещё есть в базе (этап 20) */
async function restoreDiscussion(tx: Tx, snapshot: EntrySnapshot): Promise<void> {
  const comments = snapshot.comments ?? [];
  const reactions = snapshot.reactions ?? [];
  const watchers = snapshot.watchers ?? [];
  const ids = [...new Set([...comments.map((c) => c.authorId), ...reactions.map((r) => r.personId), ...watchers])];
  if (!ids.length) return;
  const alive = new Set((await tx.person.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((p) => p.id));
  const kept = comments.filter((c) => alive.has(c.authorId));
  if (kept.length) {
    await tx.entryComment.createMany({
      data: kept.map((c) => ({ id: c.id, entryId: snapshot.id, authorId: c.authorId, text: c.text, mentions: c.mentions, at: new Date(c.at), editedAt: c.editedAt ? new Date(c.editedAt) : null })),
      skipDuplicates: true,
    });
  }
  const keptComments = new Set(kept.map((c) => c.id));
  const keptReactions = reactions.filter((r) => alive.has(r.personId) && (!r.entryCommentId || keptComments.has(r.entryCommentId)));
  if (keptReactions.length) {
    await tx.reaction.createMany({
      data: keptReactions.map((r) => ({
        kind: r.kind,
        personId: r.personId,
        ...(r.entryCommentId ? { entryCommentId: r.entryCommentId } : { entryId: snapshot.id }),
        question: r.question,
        discussedAt: r.discussedAt ? new Date(r.discussedAt) : null,
        discussedById: r.discussedById && alive.has(r.discussedById) ? r.discussedById : null,
        createdAt: new Date(r.createdAt),
      })),
      skipDuplicates: true,
    });
  }
  const keptWatchers = watchers.filter((id) => alive.has(id));
  if (keptWatchers.length) await tx.entryWatch.createMany({ data: keptWatchers.map((personId) => ({ entryId: snapshot.id, personId })), skipDuplicates: true });
}

/** «Сдать»: нужна главная фраза и хотя бы одна запись. После срока: «Сдан с опозданием» */
export async function submitWeekly(actor: Actor, key: WeekKey, now = new Date()): Promise<PersonWeekly> {
  return prisma.$transaction(async (tx) => {
    const { row, info, reporting } = await weekContext(tx, key, actor.personId);
    canEdit(info, reporting, actor, actor.slug);
    const report = await reportOf(tx, row.id, actor.personId);
    const entries = await tx.weeklyEntry.count({ where: { weekId: row.id, authorId: actor.personId } });
    if (!report?.headline.trim()) fail("Напишите главное за неделю одной фразой");
    // Записи команды, поднятые наверх, тоже часть weekly руководителя (этап 15)
    const raised = entries ? 0 : await tx.weeklyPromotion.count({ where: { byId: actor.personId, entry: { weekId: row.id } } });
    if (!entries && !raised) fail("Добавьте хотя бы одну запись");
    if (report!.state !== "DRAFT") fail("Weekly уже сдан");
    // Отсутствие на неделе: сдать можно, но опозданием это не считается. Своя отметка считается, только если поставлена
    // до срока; задним числом отсутствие отмечают владелец или администратор, тогда оно считается всегда
    const absent = await tx.absence.findUnique({ where: { personId_weekId: { personId: actor.personId, weekId: row.id } } });
    // Срок человека: самый ранний из сроков его команд (этап 15)
    const teams = await weekTeams(tx, row.id);
    const deadline = personDeadline(actor.personId, key, teams.nodes, row.deadline, teams.leaders);
    const excused = absent !== null && (absent.createdById !== actor.personId || absent.createdAt <= deadline);
    const state = excused || submitState(now, deadline) === "submitted" ? "SUBMITTED" : "LATE";
    const saved = await tx.weeklyReport.update({ where: { id: report!.id }, data: { state, submittedAt: now } });
    await audit(tx, actor, "weekly.submit", "weekly", `${key}/${actor.slug}`, `Weekly за неделю ${info.number}, записей ${entries}`, "Черновик", state === "LATE" ? "Сдан с опозданием" : "Сдан");
    return { week: key, author: actor.slug, headline: saved.headline, state: STATE_CODE[saved.state], submittedAt: saved.submittedAt?.toISOString() };
  });
}

function requireManagement(actor: Actor, what: string) {
  if (!actor.management) fail(`${what}: только владелец и администраторы в режиме управления`);
}

export async function setCeoFlag(actor: Actor, id: string, ceo: boolean): Promise<WeeklyEntry> {
  requireManagement(actor, "Отметка «В отчёт CEO»");
  return prisma.$transaction(async (tx) => {
    const entry = await tx.weeklyEntry.findUnique({ where: { id }, include: entryInclude });
    if (!entry) return fail("Запись уже удалена");
    // Отметка уже стоит как надо: ничего не меняем и не пишем в журнал выдуманную правку
    if (entry.ceo === ceo) return toEntryDto(entry);
    const saved = await tx.weeklyEntry.update({ where: { id }, data: { ceo }, include: entryInclude });
    await audit(tx, actor, "weekly.entry.ceo", "weekly-entry", id, "В отчёт CEO", entry.ceo ? "да" : "нет", ceo ? "да" : "нет");
    return toEntryDto(saved);
  });
}

/** Общей записи «Все лидеры» назначают автора: она переезжает в его weekly */
export async function assignEntryAuthor(actor: Actor, id: string, slug: PersonSlug): Promise<WeeklyEntry> {
  requireManagement(actor, "Автора записи назначают");
  return prisma.$transaction(async (tx) => {
    const person = await tx.person.findFirst({ where: { slug, active: true, role: { not: "OBSERVER" } } });
    if (!person) fail("Такого человека нет в команде");
    const entry = await tx.weeklyEntry.findUnique({ where: { id }, include: entryInclude });
    if (!entry) fail("Запись уже удалена");
    const saved = await tx.weeklyEntry.update({ where: { id }, data: { authorId: person!.id }, include: entryInclude });
    // Итоги обещаний по записи и итог, из которого запись перенесена, переходят к новому автору (этап 22)
    await tx.promiseReview.updateMany({ where: { OR: [{ entryId: id }, { carriedId: id }] }, data: { authorId: person!.id } });
    const previous = entry!.authorId ? (await tx.person.findUnique({ where: { id: entry!.authorId } }))?.fullName : null;
    await audit(tx, actor, "weekly.entry.author", "weekly-entry", id, "Автор записи", previous ?? "Все лидеры", person!.fullName);
    return toEntryDto(saved);
  });
}

/** После встречи неделю закрывают: дальше записи правят только владелец и администраторы */
export async function setWeekClosed(actor: Actor, key: WeekKey, closed: boolean): Promise<WeekInfo> {
  requireManagement(actor, closed ? "Закрыть неделю" : "Открыть неделю");
  return prisma.$transaction(async (tx) => {
    const { row, info, reporting } = await weekContext(tx, key);
    if (info.closed === closed) fail(closed ? "Неделя уже закрыта" : "Неделя уже открыта");
    const saved = await tx.week.update({ where: { id: row.id }, data: { closedAt: closed ? new Date() : null, closedById: closed ? actor.personId : null } });
    await audit(tx, actor, closed ? "weekly.week.close" : "weekly.week.open", "week", key, `Неделя ${info.number}`, closed ? "открыта" : "закрыта", closed ? "закрыта" : "открыта");
    return weekInfo(saved, reporting);
  });
}

// ---------- Weekly команд (этап 15) ----------

const PROMOTION_NOTE = 150;

/**
 * «Наверх»: руководитель поднимает запись человека своей команды в свой weekly. Запись не копируется, её видно в ленте
 * команды выше под его именем, с автором и его фразой. Поднять можно и запись, которую уже поднял человек его команды:
 * так запись из сектора доходит до Арама через два уровня
 */
export async function promoteEntry(actor: Actor, id: string, note?: string | null): Promise<WeeklyEntry> {
  if (actor.role === "OBSERVER") fail("Наблюдатель weekly не пишет");
  if (actor.via === "TEAM" && !actor.management) fail("Поднимать записи наверх руководитель может, войдя лично, со своим логином и паролем");
  const value = optional(note, PROMOTION_NOTE, "Фраза от себя");
  return prisma.$transaction(async (tx) => {
    const entry = await tx.weeklyEntry.findUnique({ where: { id }, include: { week: true, promotions: true } });
    if (!entry) return fail("Запись уже удалена");
    if (!entry.authorId) fail("Общую запись без автора поднимать некуда: сначала назначьте автора");
    if (entry.authorId === actor.personId) fail("Своя запись и так в вашем weekly");
    const teams = await weekTeams(tx, entry.weekId);
    const from = promotableFrom(actor.personId, teams.nodes);
    if (!from.has(entry.authorId!) && !entry.promotions.some((p) => from.has(p.byId))) fail("Наверх поднимают записи людей своей команды");
    const { info, reporting } = await weekContext(tx, isoFromDbDate(entry.week.start), actor.personId);
    canEdit(info, reporting, actor, actor.slug);
    const existing = entry.promotions.find((p) => p.byId === actor.personId);
    if (existing && (existing.note ?? null) === value) fail("Запись уже в вашем weekly");
    if (existing) {
      await tx.weeklyPromotion.update({ where: { id: existing.id }, data: { note: value } });
      await audit(tx, actor, "weekly.entry.promote", "weekly-entry", id, "Фраза к записи наверху", existing.note, value);
    } else {
      // Двойное нажатие: вторая отметка упирается в уникальный ключ, отвечаем правилом, а не общей ошибкой
      const created = await tx.weeklyPromotion.createMany({ data: [{ entryId: id, byId: actor.personId, note: value }], skipDuplicates: true });
      if (!created.count) fail("Запись уже в вашем weekly");
      // Поднятая запись попадает в weekly руководителя: если его weekly ещё не начат, появляется черновик
      await tx.weeklyReport.upsert({
        where: { weekId_authorId: { weekId: entry.weekId, authorId: actor.personId } },
        update: {},
        create: { weekId: entry.weekId, authorId: actor.personId, state: "DRAFT" },
      });
      await audit(tx, actor, "weekly.entry.promote", "weekly-entry", id, "Наверх", null, value ? `${entry.what}. От себя: ${value}` : entry.what);
    }
    return toEntryDto(await tx.weeklyEntry.findUniqueOrThrow({ where: { id }, include: entryInclude }));
  });
}

/** Снять запись из своего weekly. Владелец и администраторы в режиме управления снимают за любого */
export async function unpromoteEntry(actor: Actor, id: string, by?: PersonSlug): Promise<WeeklyEntry> {
  if (actor.role === "OBSERVER") fail("Наблюдатель weekly не пишет");
  if (actor.via === "TEAM" && !actor.management) fail("Убирать поднятые записи руководитель может, войдя лично, со своим логином и паролем");
  return prisma.$transaction(async (tx) => {
    const entry = await tx.weeklyEntry.findUnique({ where: { id }, include: { week: true, promotions: { include: { by: true } } } });
    if (!entry) return fail("Запись уже удалена");
    const whose = by ?? actor.slug;
    if (whose !== actor.slug && !actor.management) fail("Снять запись из чужого weekly могут только владелец и администраторы");
    const promotion = entry.promotions.find((p) => p.by.slug === whose);
    if (!promotion) return fail("Этой записи уже нет в weekly");
    const { info, reporting } = await weekContext(tx, isoFromDbDate(entry.week.start), promotion.byId);
    canEdit(info, reporting, actor, whose as PersonSlug);
    const removed = await tx.weeklyPromotion.deleteMany({ where: { id: promotion.id } });
    if (!removed.count) fail("Этой записи уже нет в weekly");
    await audit(tx, actor, "weekly.entry.unpromote", "weekly-entry", id, `Наверх: ${promotion.by.fullName}`, entry.what, null);
    return toEntryDto(await tx.weeklyEntry.findUniqueOrThrow({ where: { id }, include: entryInclude }));
  });
}

/**
 * Неделя команды: руководитель закрывает её после встречи команды, дальше люди команды свой weekly не правят.
 * Неделю топ-команды закрывает администратор вместе с неделей департамента
 */
export async function setTeamWeekClosed(actor: Actor, teamId: string, key: WeekKey, closed: boolean): Promise<{ closed: boolean }> {
  if (actor.role === "OBSERVER") fail("Наблюдатель неделю не закрывает");
  if (teamId === TOP_TEAM) fail("Неделю топ-команды закрывают вместе с неделей департамента: «Закрыть неделю» в режиме управления");
  return prisma.$transaction(async (tx) => {
    const team = await tx.team.findUnique({ where: { id: teamId } });
    if (!team || !team.active) return fail("Такой команды нет");
    if (!actor.management) {
      const scope = await loadScope(tx, { id: actor.personId, role: actor.role, limited: actor.via === "TEAM" });
      if (!scope.leads.includes(teamId)) fail("Неделю команды закрывает её руководитель или руководитель выше");
    }
    const row = await ensureWeek(tx, key);
    if (row.closedAt) fail(`Неделя ${row.isoNumber} уже закрыта для всего департамента`);
    const reporting = await currentReportingKey();
    if (key > reporting) fail("Будущую неделю не закрывают");
    const existing = await tx.teamWeekClose.findUnique({ where: { teamId_weekId: { teamId, weekId: row.id } } });
    if (closed === !!existing) fail(closed ? "Неделя команды уже закрыта" : "Неделя команды уже открыта");
    // Двойное нажатие: повтор не падает общей ошибкой
    const changed = closed
      ? (await tx.teamWeekClose.createMany({ data: [{ teamId, weekId: row.id, closedById: actor.personId }], skipDuplicates: true })).count
      : (await tx.teamWeekClose.deleteMany({ where: { teamId, weekId: row.id } })).count;
    if (!changed) fail(closed ? "Неделя команды уже закрыта" : "Неделя команды уже открыта");
    await audit(tx, actor, closed ? "weekly.team.close" : "weekly.team.open", "team-week", `${teamId}/${key}`, `${team.name}, неделя ${row.isoNumber}`, closed ? "открыта" : "закрыта", closed ? "закрыта" : "открыта");
    return { closed };
  });
}

// ---------- Отчёт CEO ----------

export type CeoReportView = { sections: CeoSections | null; updatedBy?: string; updatedAt?: string };

export async function getCeoReport(key: WeekKey): Promise<CeoReportView> {
  const row = await prisma.week.findUnique({ where: { start: dbDate(key) }, include: { ceoReport: { include: { updatedBy: { select: { fullName: true } } } } } });
  const r = row?.ceoReport;
  if (!r) return { sections: null };
  return { sections: { main: r.main, risks: r.risks, next: r.next }, updatedBy: r.updatedBy?.fullName, updatedAt: r.updatedAt.toISOString() };
}

export async function saveCeoReport(actor: Actor, key: WeekKey, sections: CeoSections): Promise<CeoReportView> {
  requireManagement(actor, "Отчёт CEO правят");
  const clean3 = (t: unknown) => cleanDash(String(t ?? "")).slice(0, 10000);
  return prisma.$transaction(async (tx) => {
    const { row, info } = await weekContext(tx, key);
    const before = await tx.ceoReport.findUnique({ where: { weekId: row.id } });
    const data = { main: clean3(sections.main), risks: clean3(sections.risks), next: clean3(sections.next), updatedById: actor.personId };
    const saved = await tx.ceoReport.upsert({ where: { weekId: row.id }, update: data, create: { ...data, weekId: row.id } });
    // Было и стало по каждому разделу, который поменялся
    const parts: [string, string | null, string][] = [
      ["главное", before?.main ?? null, data.main],
      ["риски", before?.risks ?? null, data.risks],
      ["что дальше", before?.next ?? null, data.next],
    ];
    const changed = parts.filter(([, b, a]) => (b ?? "") !== a);
    for (const [part, b, a] of changed) await audit(tx, actor, "ceo.save", "ceo-report", key, `Отчёт CEO, ${part}`, b || null, a || null);
    if (!changed.length) await audit(tx, actor, "ceo.save", "ceo-report", key, "Отчёт CEO сохранён без изменений", null, null);
    return { sections: { main: saved.main, risks: saved.risks, next: saved.next }, updatedBy: actor.fullName, updatedAt: saved.updatedAt.toISOString() };
  });
}

/** История отчётов: недели, где отчёт сохранён или есть отметки «В отчёт CEO» */
export async function ceoReportHistory(limit = 20) {
  const weeks = await prisma.week.findMany({
    where: { OR: [{ ceoReport: { isNot: null } }, { entries: { some: { ceo: true } } }] },
    orderBy: { start: "desc" },
    take: limit,
    include: { ceoReport: { include: { updatedBy: { select: { fullName: true } } } }, _count: { select: { entries: { where: { ceo: true } } } } },
  });
  return weeks.map((w) => ({
    key: isoFromDbDate(w.start),
    number: w.isoNumber,
    flagged: w._count.entries,
    meeting: formatLong(isoFromDbDate(w.meetingDate)),
    savedBy: w.ceoReport?.updatedBy?.fullName,
    savedAt: w.ceoReport?.updatedAt.toISOString(),
  }));
}

export type { IsoDate };

// ---------- Отсутствие (этап 9) ----------

/** Кто отсутствует на неделе: id человека и короткое имя замещающего */
async function absenceMap(weekId: string): Promise<Map<string, PersonSlug | null>> {
  const rows = await prisma.absence.findMany({ where: { weekId }, include: { substitute: { select: { slug: true } } } });
  return new Map(rows.map((a) => [a.personId, (a.substitute?.slug as PersonSlug | undefined) ?? null]));
}

/** На сколько недель вперёд можно отметить отсутствие */
export const ABSENCE_WEEKS_AHEAD = 12;

export type AbsenceView = { week: WeekKey; number: number; start: string; end: string; substitute: PersonSlug | null };

async function absenceTarget(actor: Actor, slug: string, key: WeekKey, now: Date) {
  if (actor.role === "OBSERVER") fail("Наблюдатель отсутствие не отмечает");
  if (slug !== actor.slug) requireManagement(actor, "Отсутствие коллеги");
  if (!isWeekKey(key)) fail("Неделя задаётся понедельником");
  const reporting = await currentReportingKey(now);
  if (key < reporting) fail("Прошедшую неделю отметить нельзя: её weekly уже разобрали");
  if (key > shiftWeek(reporting, ABSENCE_WEEKS_AHEAD)) fail(`Отсутствие отмечается не дальше чем на ${ABSENCE_WEEKS_AHEAD} недель вперёд`);
  const person = await prisma.person.findUnique({ where: { slug } });
  if (!person || !person.active) fail("Человек не найден или выключен");
  if (person!.role === "OBSERVER") fail("У наблюдателя нет weekly");
  return person!;
}

/** «Нет на неделе N»: weekly за эту неделю не ждём, на встрече видно, кто замещает */
export async function setAbsence(actor: Actor, input: { slug: string; week: WeekKey; substitute: string | null }, now = new Date()): Promise<AbsenceView> {
  const person = await absenceTarget(actor, input.slug, input.week, now);
  let substitute: { id: string; slug: string; fullName: string } | null = null;
  if (input.substitute) {
    const s = await prisma.person.findUnique({ where: { slug: input.substitute } });
    if (!s || !s.active || s.role === "OBSERVER") fail("Замещающего выберите из списка команды");
    if (s!.id === person.id) fail("Замещающим не может быть сам отсутствующий");
    // Замещает коллега по команде (этап 14): человек из другой ветки не видит задач и weekly отсутствующего
    const colleague = await prisma.person.count({ where: { id: s!.id, ...colleaguesOf(person.id) } });
    if (!colleague) fail("Замещающего выберите из своей команды");
    substitute = s!;
  }
  return prisma.$transaction(async (tx) => {
    const week = await ensureWeek(tx, input.week);
    if (week.closedAt) fail(`Неделя ${week.isoNumber} закрыта: её уже разобрали на встрече`);
    // Себе задним числом отметить нельзя, иначе отметка снимала бы «сдан с опозданием». Коллеге может управление
    const teams = await weekTeams(tx, week.id);
    if (input.slug === actor.slug && now >= personDeadline(person.id, input.week, teams.nodes, week.deadline, teams.leaders)) {
      fail(`Срок сдачи недели ${week.isoNumber} уже прошёл: отметить отсутствие задним числом может владелец или администратор`);
    }
    const before = await tx.absence.findUnique({ where: { personId_weekId: { personId: person.id, weekId: week.id } }, include: { substitute: true } });
    await tx.absence.upsert({
      where: { personId_weekId: { personId: person.id, weekId: week.id } },
      update: { substituteId: substitute?.id ?? null },
      create: { personId: person.id, weekId: week.id, substituteId: substitute?.id ?? null, createdById: actor.personId, createdAt: now },
    });
    const describe = (name: string | null | undefined) => (name ? `нет, замещает ${name}` : "нет, без замещающего");
    await audit(tx, actor, "weekly.absence.set", "weekly", `${input.week}/${person.slug}`, "Отсутствие", before ? describe(before.substitute?.fullName) : "на месте", describe(substitute?.fullName));
    return { week: input.week, number: week.isoNumber, start: input.week, end: weekEndOf(input.week), substitute: (substitute?.slug as PersonSlug | undefined) ?? null };
  });
}

export async function removeAbsence(actor: Actor, slug: string, key: WeekKey, now = new Date()): Promise<void> {
  const person = await absenceTarget(actor, slug, key, now);
  await prisma.$transaction(async (tx) => {
    const week = await ensureWeek(tx, key);
    if (week.closedAt) fail(`Неделя ${week.isoNumber} закрыта: её уже разобрали на встрече`);
    const removed = await tx.absence.deleteMany({ where: { personId: person.id, weekId: week.id } });
    if (removed.count) await audit(tx, actor, "weekly.absence.remove", "weekly", `${key}/${person.slug}`, "Отсутствие", "нет", "на месте");
  });
}

/** Отсутствия человека с отчётной недели и дальше: для профиля */
export async function upcomingAbsences(personId: string, now = new Date()): Promise<AbsenceView[]> {
  const reporting = await currentReportingKey(now);
  const rows = await prisma.absence.findMany({
    where: { personId, week: { start: { gte: dbDate(reporting) } } },
    include: { week: true, substitute: { select: { slug: true } } },
    orderBy: { week: { start: "asc" } },
  });
  return rows.map((a) => {
    const key = isoFromDbDate(a.week.start);
    return { week: key, number: a.week.isoNumber, start: key, end: weekEndOf(key), substitute: (a.substitute?.slug as PersonSlug | undefined) ?? null };
  });
}

/** Отсутствия всех с отчётной недели: короткое имя человека и его недели */
export async function upcomingAbsencesAll(now = new Date()): Promise<Record<string, AbsenceView[]>> {
  const reporting = await currentReportingKey(now);
  const rows = await prisma.absence.findMany({
    where: { week: { start: { gte: dbDate(reporting) } } },
    include: { week: true, person: { select: { slug: true } }, substitute: { select: { slug: true } } },
    orderBy: { week: { start: "asc" } },
  });
  const out: Record<string, AbsenceView[]> = {};
  for (const a of rows) {
    const key = isoFromDbDate(a.week.start);
    (out[a.person.slug] ??= []).push({ week: key, number: a.week.isoNumber, start: key, end: weekEndOf(key), substitute: (a.substitute?.slug as PersonSlug | undefined) ?? null });
  }
  return out;
}

/**
 * Недели, на которые можно отметить отсутствие: отчётная и 12 следующих.
 * Себе только недели, срок сдачи которых ещё впереди; владелец отмечает коллегу и задним числом (own: false)
 */
export async function absenceWeeks(now = new Date(), opts: { own: boolean } = { own: true }): Promise<{ value: WeekKey; label: string }[]> {
  const { deadline } = await weekSettings();
  const reporting = reportingKey(now, deadline);
  return Array.from({ length: ABSENCE_WEEKS_AHEAD + 1 }, (_, i) => shiftWeek(reporting, i))
    .filter((key) => !opts.own || deadlineOf(key, deadline) > now)
    .map((key) => ({ value: key, label: `Неделя ${weekNumberOf(key)}, ${formatLong(key)} - ${formatLong(weekEndOf(key))}${key === reporting ? ", отчётная" : ""}` }));
}
