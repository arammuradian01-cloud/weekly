// Weekly на сервере (раздел 3 ТЗ): недели, сдача в три шага, черновик на сервере, лента, отчёт CEO.
// Права проверяются здесь же: экран только прячет то, что нельзя.

import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import type { DeadlineSetting } from "@/lib/week";
import type { Prisma } from "@/generated/prisma/client";
import type { WeeklyState } from "@/generated/prisma/enums";
import type { BlockCode, DirectionCode, EntryTypeCode, WeeklyStateCode } from "@/domain/dictionaries";
import { formatLong, type IsoDate } from "@/domain/dates";
import type { Link, PersonSlug, PersonWeekly, WeekInfo, WeekKey, WeekView, WeeklyEntry } from "@/domain/types";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { dbDate, isoFromDbDate } from "@/lib/tasks/dates";
import { WEEKLY_LIMITS, canEditWeekly, cleanDash, submitState, type CeoSections } from "./rules";
import { deadlineOf, isWeekKey, meetingOf, reportingKey, shiftWeek, weekEndOf, weekNumberOf, weekYearOf, type MeetingSetting } from "./weeks";

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
  return db.week.upsert({
    where: { start: dbDate(key) },
    update: {},
    create: {
      start: dbDate(key),
      isoYear: weekYearOf(key),
      isoNumber: weekNumberOf(key),
      deadline: deadlineOf(key, deadline),
      meetingDate: dbDate(meetingOf(key, meeting)),
    },
  });
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

const entryInclude = {
  week: { select: { start: true } },
  author: { select: { slug: true } },
  direction: { select: { code: true } },
  block: { select: { code: true } },
  type: { select: { code: true } },
  tasks: { select: { number: true }, orderBy: { number: "asc" as const }, take: 1 },
} satisfies Prisma.WeeklyEntryInclude;

type EntryRow = Prisma.WeeklyEntryGetPayload<{ include: typeof entryInclude }>;

function toEntryDto(e: EntryRow): WeeklyEntry {
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
  };
}

const STATE_CODE: Record<WeeklyState, WeeklyStateCode> = { DRAFT: "draft", SUBMITTED: "submitted", LATE: "late" };

// ---------- Чтение ----------

/** Неделя для ленты, режима встречи и отчёта CEO. Без ключа: отчётная, а если она пустая, последняя с записями */
export async function getWeekView(key: WeekKey | null, now = new Date()): Promise<WeekView> {
  const reporting = await currentReportingKey(now);
  let target = key && isWeekKey(key) ? key : reporting;
  let fallback = false;
  if (!key) {
    const reportingWeek = await prisma.week.findUnique({ where: { start: dbDate(reporting) }, select: { _count: { select: { entries: true } } } });
    if (!reportingWeek?._count.entries) {
      const latest = await prisma.week.findFirst({ where: { entries: { some: {} }, start: { lt: dbDate(reporting) } }, orderBy: { start: "desc" } });
      if (latest) {
        target = isoFromDbDate(latest.start);
        fallback = true;
      }
    }
  }
  if (target > reporting) target = reporting;
  const row = await ensureWeek(prisma, target);
  const [reports, entries, people] = await Promise.all([
    prisma.weeklyReport.findMany({ where: { weekId: row.id }, include: { author: { select: { slug: true } } } }),
    prisma.weeklyEntry.findMany({ where: { weekId: row.id }, include: entryInclude, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.person.findMany({ where: { active: true, role: { not: "OBSERVER" } }, orderBy: { sortOrder: "asc" } }),
  ]);
  const byAuthor = new Map(reports.map((r) => [r.author.slug, r]));
  return {
    week: weekInfo(row, reporting),
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
        state: r ? STATE_CODE[r.state] : "not-started",
        submittedAt: r?.submittedAt?.toISOString(),
      } satisfies PersonWeekly;
    }),
    entries: entries.map(toEntryDto),
  };
}

/** Мой weekly за неделю: для экрана сдачи и «Моей недели» */
export async function getMyWeekly(personId: string, key: WeekKey, now = new Date()) {
  const reporting = await currentReportingKey(now);
  const row = await ensureWeek(prisma, key);
  const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });
  const [report, entries] = await Promise.all([
    prisma.weeklyReport.findUnique({ where: { weekId_authorId: { weekId: row.id, authorId: personId } } }),
    prisma.weeklyEntry.findMany({ where: { weekId: row.id, authorId: personId }, include: entryInclude, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
  ]);
  return {
    week: weekInfo(row, reporting),
    report: {
      week: key,
      author: person.slug as PersonSlug,
      headline: report?.headline ?? "",
      state: report ? STATE_CODE[report.state] : "not-started",
      submittedAt: report?.submittedAt?.toISOString(),
    } satisfies PersonWeekly,
    entries: entries.map(toEntryDto),
  };
}

/** Состояние сдачи у всех за неделю: для «Команды» и «Моей недели» */
export async function weeklyStates(key: WeekKey): Promise<PersonWeekly[]> {
  const view = await getWeekView(key);
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

async function audit(db: Tx, actor: Actor, action: string, entity: string, entityId: string, field: string, before?: string | null, after?: string | null) {
  await db.auditLog.create({
    data: { action, actorId: actor.personId, actorName: actor.fullName, source: "APP", entity, entityId, field, before: before ?? undefined, after: after ?? undefined, ip: actor.ip ?? null },
  });
}

async function weekContext(tx: Tx, key: WeekKey) {
  const reporting = await currentReportingKey();
  const row = await ensureWeek(tx, key);
  return { row, info: weekInfo(row, reporting), reporting };
}

function canEdit(info: WeekInfo, reporting: WeekKey, actor: Actor, author: PersonSlug | null): void {
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
export async function saveHeadline(actor: Actor, key: WeekKey, headline: string): Promise<PersonWeekly> {
  const value = clean(headline);
  if (value.length > WEEKLY_LIMITS.headline) fail(`Главное: не длиннее ${WEEKLY_LIMITS.headline} знаков`);
  return prisma.$transaction(async (tx) => {
    const { row, info, reporting } = await weekContext(tx, key);
    canEdit(info, reporting, actor, actor.slug);
    const existing = await reportOf(tx, row.id, actor.personId);
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
};

async function dictId(tx: Tx, kind: "DIRECTION" | "WEEKLY_BLOCK" | "ENTRY_TYPE", code: string, message: string): Promise<string> {
  const item = await tx.dictionaryItem.findFirst({ where: { kind, code, active: true } });
  if (!item) fail(message);
  return item!.id;
}

/** Создать или поправить запись. Автор: тот, кто пишет; чужие записи правят владелец и администраторы */
export async function saveEntry(actor: Actor, input: EntryInput): Promise<WeeklyEntry> {
  const what = clean(input.what);
  if (!what) fail("Напишите одной фразой, что произошло");
  if (what.length > WEEKLY_LIMITS.what) fail(`«Что произошло» длиннее ${WEEKLY_LIMITS.what} знаков: сократите до одной фразы`);
  const details = optional(input.details, WEEKLY_LIMITS.details, "Подробнее");
  const impact = optional(input.impact, WEEKLY_LIMITS.impact, "Влияние на бизнес");
  const fact = optional(input.fact, WEEKLY_LIMITS.fact, "Цифра или факт");
  const next = optional(input.next, WEEKLY_LIMITS.next, "Что делаем дальше");
  const help = optional(input.help, WEEKLY_LIMITS.help, "Какая помощь нужна");
  const links = checkLinks(input.links ?? []);

  return prisma.$transaction(async (tx) => {
    const existing = input.id ? await tx.weeklyEntry.findUnique({ where: { id: input.id }, include: entryInclude }) : null;
    if (input.id && !existing) fail("Запись уже удалена");
    const key = existing ? isoFromDbDate(existing.week.start) : input.week;
    const { row, info, reporting } = await weekContext(tx, key);
    const author = existing ? ((existing.author?.slug as PersonSlug | undefined) ?? null) : actor.slug;
    canEdit(info, reporting, actor, author);
    const data = {
      directionId: await dictId(tx, "DIRECTION", input.direction, "Выберите направление из списка"),
      blockId: await dictId(tx, "WEEKLY_BLOCK", input.block, "Выберите блок из списка"),
      typeId: await dictId(tx, "ENTRY_TYPE", input.type, "Выберите тип записи"),
      what,
      details,
      impact,
      fact,
      next,
      help,
      links: links as unknown as Prisma.InputJsonValue,
    };
    let saved: EntryRow;
    if (existing) {
      saved = await tx.weeklyEntry.update({ where: { id: existing.id }, data, include: entryInclude });
      const report = existing.authorId ? await reportOf(tx, row.id, existing.authorId) : null;
      // Пока weekly черновик, автосохранение журнал не засоряет. После сдачи и в закрытой неделе пишем каждую правку
      if (report?.state !== "DRAFT" || info.closed) {
        const changes: [string, string | null | undefined, string | null | undefined][] = [
          ["Что произошло", existing.what, what],
          ["Подробнее", existing.details, details],
          ["Влияние на бизнес", existing.impact, impact],
          ["Цифра или факт", existing.fact, fact],
          ["Что делаем дальше", existing.next, next],
          ["Нужна помощь", existing.help, help],
          ["Блок", existing.block.code, input.block],
          ["Направление", existing.direction.code, input.direction],
          ["Тип", existing.type.code, input.type],
        ];
        for (const [field, before, after] of changes) {
          if ((before ?? null) !== (after ?? null)) await audit(tx, actor, "weekly.entry.update", "weekly-entry", existing.id, field, before, after);
        }
      }
    } else {
      const count = await tx.weeklyEntry.count({ where: { weekId: row.id, authorId: actor.personId } });
      saved = await tx.weeklyEntry.create({ data: { ...data, weekId: row.id, authorId: actor.personId, sortOrder: count }, include: entryInclude });
      await tx.weeklyReport.upsert({
        where: { weekId_authorId: { weekId: row.id, authorId: actor.personId } },
        update: {},
        create: { weekId: row.id, authorId: actor.personId, state: "DRAFT" },
      });
      await audit(tx, actor, "weekly.entry.create", "weekly-entry", saved.id, "Запись weekly", null, `Неделя ${info.number}: ${what}`);
    }
    return toEntryDto(saved);
  });
}

export async function deleteEntry(actor: Actor, id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.weeklyEntry.findUnique({ where: { id }, include: entryInclude });
    if (!existing) fail("Запись уже удалена");
    const { info, reporting } = await weekContext(tx, isoFromDbDate(existing!.week.start));
    canEdit(info, reporting, actor, (existing!.author?.slug as PersonSlug | undefined) ?? null);
    await tx.weeklyEntry.delete({ where: { id } });
    await audit(tx, actor, "weekly.entry.delete", "weekly-entry", id, "Запись weekly удалена", existing!.what, null);
  });
}

/** «Сдать»: нужна главная фраза и хотя бы одна запись. После срока: «Сдан с опозданием» */
export async function submitWeekly(actor: Actor, key: WeekKey, now = new Date()): Promise<PersonWeekly> {
  return prisma.$transaction(async (tx) => {
    const { row, info, reporting } = await weekContext(tx, key);
    canEdit(info, reporting, actor, actor.slug);
    const report = await reportOf(tx, row.id, actor.personId);
    const entries = await tx.weeklyEntry.count({ where: { weekId: row.id, authorId: actor.personId } });
    if (!report?.headline.trim()) fail("Напишите главное за неделю одной фразой");
    if (!entries) fail("Добавьте хотя бы одну запись");
    if (report!.state !== "DRAFT") fail("Weekly уже сдан");
    const state = submitState(now, row.deadline) === "submitted" ? "SUBMITTED" : "LATE";
    const saved = await tx.weeklyReport.update({ where: { id: report!.id }, data: { state, submittedAt: now } });
    await audit(tx, actor, "weekly.submit", "weekly", `${key}/${actor.slug}`, state === "LATE" ? "Weekly сдан с опозданием" : "Weekly сдан", null, `Неделя ${info.number}, записей ${entries}`);
    return { week: key, author: actor.slug, headline: saved.headline, state: STATE_CODE[saved.state], submittedAt: saved.submittedAt?.toISOString() };
  });
}

function requireManagement(actor: Actor, what: string) {
  if (!actor.management) fail(`${what}: только владелец и администраторы в режиме управления`);
}

export async function setCeoFlag(actor: Actor, id: string, ceo: boolean): Promise<WeeklyEntry> {
  requireManagement(actor, "Отметка «В отчёт CEO»");
  return prisma.$transaction(async (tx) => {
    const saved = await tx.weeklyEntry.update({ where: { id }, data: { ceo }, include: entryInclude });
    await audit(tx, actor, "weekly.entry.ceo", "weekly-entry", id, "В отчёт CEO", ceo ? "нет" : "да", ceo ? "да" : "нет");
    return toEntryDto(saved);
  });
}

/** Общей записи «Все лидеры» назначают автора: она переезжает в его weekly */
export async function assignEntryAuthor(actor: Actor, id: string, slug: PersonSlug): Promise<WeeklyEntry> {
  requireManagement(actor, "Автора записи назначают");
  return prisma.$transaction(async (tx) => {
    const person = await tx.person.findFirst({ where: { slug, active: true } });
    if (!person) fail("Такого человека нет в команде");
    const entry = await tx.weeklyEntry.findUnique({ where: { id }, include: entryInclude });
    if (!entry) fail("Запись уже удалена");
    const saved = await tx.weeklyEntry.update({ where: { id }, data: { authorId: person!.id }, include: entryInclude });
    await audit(tx, actor, "weekly.entry.author", "weekly-entry", id, "Автор записи", entry!.author?.slug ?? "Все лидеры", person!.fullName);
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
    await audit(tx, actor, closed ? "weekly.week.close" : "weekly.week.open", "week", key, closed ? "Неделя закрыта" : "Неделя открыта", null, `Неделя ${info.number}`);
    return weekInfo(saved, reporting);
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
    await audit(tx, actor, "ceo.save", "ceo-report", key, `Отчёт CEO за неделю ${info.number}`, before ? "прежняя версия" : null, `${data.main.length + data.risks.length + data.next.length} знаков`);
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
