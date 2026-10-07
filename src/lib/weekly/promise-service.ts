// Обещания недели на сервере (этап 22, модуль М6): итоги планов прошлой недели, перенос невыполненного в план этой,
// сводка для отчёта CEO. Итог хранится в неделе, за которую пишут weekly: прошлая неделя может быть закрыта.

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { PromiseResult } from "@/generated/prisma/enums";
import type { PersonSlug, WeekKey, WeeklyEntry } from "@/domain/types";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { dbDate, isoFromDbDate, moscowToday } from "@/lib/tasks/dates";
import { taskListInclude, toTaskDto } from "@/lib/tasks/dto";
import { cleanDash, splitWhat } from "./rules";
import { isWeekKey, shiftWeek, weekEndOf, weekNumberOf } from "./weeks";
import { audit, canEdit, entryInclude, toEntryDto, weekContext } from "./service";
import {
  EMPTY_SUMMARY,
  PROMISE_NOTE_MAX,
  addSummary,
  canCarry,
  entryPromiseText,
  promiseNeedsNote,
  promiseResultOf,
  promiseTasks,
  summarize,
  taskPromiseOutcome,
  type EntryPromise,
  type PromiseResultCode,
  type PromiseSummary,
} from "./promises";

type Tx = Prisma.TransactionClient;

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

const RESULT_DB: Record<PromiseResultCode, PromiseResult> = { done: "DONE", partial: "PARTIAL", "not-done": "NOT_DONE", dropped: "DROPPED" };
const RESULT_CODE: Record<PromiseResult, PromiseResultCode> = { DONE: "done", PARTIAL: "partial", NOT_DONE: "not-done", DROPPED: "dropped" };

const promiseInclude = {
  type: { select: { code: true } },
  week: { select: { start: true } },
  author: { select: { slug: true } },
  tasks: { select: { id: true }, take: 1 },
  promiseReview: { include: { carried: { select: { id: true, what: true } } } },
} satisfies Prisma.WeeklyEntryInclude;

type PromiseRow = Prisma.WeeklyEntryGetPayload<{ include: typeof promiseInclude }>;

/** Записи прошлой недели, которые могут быть обещаниями: планы и записи с «что делаем дальше» */
const candidate: Prisma.WeeklyEntryWhereInput = { OR: [{ type: { code: "plan" } }, { next: { not: null } }] };

function toPromise(e: PromiseRow): EntryPromise | null {
  const r = e.promiseReview;
  // Итог уже поставлен, а запись потом поменяли (сделали по ней задачу, сменили тип): обещание остаётся с текстом итога
  const p = entryPromiseText({ type: e.type.code, what: e.what, next: e.next, hasTask: e.tasks.length > 0 }) ?? (r ? { kind: e.type.code === "plan" ? ("plan" as const) : ("next" as const), what: r.what } : null);
  if (!p) return null;
  return {
    entryId: e.id,
    kind: p.kind,
    what: p.what,
    ...(p.kind === "next" ? { from: e.what } : {}),
    ...(r
      ? {
          review: {
            result: RESULT_CODE[r.result],
            ...(r.note ? { note: r.note } : {}),
            ...(r.carried ? { carried: { id: r.carried.id, what: r.carried.what } } : {}),
          },
        }
      : {}),
  };
}

/** Обещания человека из weekly прошлой недели для сдачи weekly недели key */
export async function entryPromises(personId: string, key: WeekKey): Promise<EntryPromise[]> {
  if (!isWeekKey(key)) return [];
  const prev = await prisma.week.findUnique({ where: { start: dbDate(shiftWeek(key, -1)) }, select: { id: true } });
  if (!prev) return [];
  const rows = await prisma.weeklyEntry.findMany({
    where: { AND: [{ weekId: prev.id, authorId: personId }, candidate] },
    include: promiseInclude,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toPromise).filter((p): p is EntryPromise => p !== null);
}

/**
 * Запись как обещание: она должна быть обещанием и неделя итога (следующая за её неделей) должна быть открыта автору.
 * Замок по записи: итог и перенос одного обещания не идут одновременно, двойное нажатие не создаст два плана
 */
async function promiseContext(tx: Tx, actor: Actor, entryId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`promise:${String(entryId)}`}))::text`;
  const entry = await tx.weeklyEntry.findUnique({ where: { id: String(entryId) }, include: promiseInclude });
  if (!entry) return fail("Запись уже удалена");
  if (!entry.authorId) return fail("У общей записи нет автора: итог по ней не ставят");
  const promise = toPromise(entry);
  if (!promise) return fail(entry.tasks.length ? "По записи есть задача: итог это статус задачи" : "В записи нет плана: итог ставят планам и «что делаем дальше»");
  const key = shiftWeek(isoFromDbDate(entry.week.start), 1);
  const { row, info, reporting } = await weekContext(tx, key, entry.authorId);
  if (key > reporting) fail("Итог плана ставят в weekly следующей недели");
  canEdit(info, reporting, actor, (entry.author?.slug as PersonSlug | undefined) ?? null);
  return { entry, promise: promise!, week: row, info };
}

/** Итог обещания: сделано, частично, не сделано или снято. Кроме «сделано» нужна фраза */
export async function reviewPromise(actor: Actor, entryId: string, result: string, note?: string | null): Promise<EntryPromise> {
  const code = result as PromiseResultCode;
  if (!Object.hasOwn(RESULT_DB, code)) fail("Выберите итог: сделано, частично, не сделано или снято");
  const text = cleanDash(String(note ?? "")).trim();
  if (text.length > PROMISE_NOTE_MAX) fail(`Фраза итога: не длиннее ${PROMISE_NOTE_MAX} знаков`);
  if (promiseNeedsNote(code) && !text) fail(code === "dropped" ? "Напишите одной фразой, почему сняли" : code === "partial" ? "Напишите одной фразой, что сделано и что осталось" : "Напишите одной фразой, что помешало");
  return prisma.$transaction(async (tx) => {
    const { entry, promise, week, info } = await promiseContext(tx, actor, entryId);
    const before = entry.promiseReview;
    if (before?.carriedId && !canCarry(code)) fail("Обещание уже перенесено в план этой недели: сначала удалите перенесённую запись");
    const data = { result: RESULT_DB[code], note: text || null, what: promise.what.slice(0, 1000) };
    if (before && before.result === data.result && (before.note ?? null) === data.note) fail("Итог не изменился");
    await tx.promiseReview.upsert({
      where: { entryId: entry.id },
      update: data,
      create: { ...data, entryId: entry.id, weekId: week.id, authorId: entry.authorId! },
    });
    const label = (r: PromiseResultCode, n: string | null | undefined) => `${promiseResultOf(r).label}${n ? `. ${n}` : ""}`;
    await audit(
      tx,
      actor,
      "weekly.promise",
      "weekly-entry",
      entry.id,
      `Итог обещания, неделя ${info.number}: ${promise.what.slice(0, 120)}`,
      before ? label(RESULT_CODE[before.result], before.note) : null,
      label(code, text),
    );
    return toPromise(await tx.weeklyEntry.findUniqueOrThrow({ where: { id: entry.id }, include: promiseInclude }))!;
  });
}

/** Невыполненное обещание в план этой недели: новая запись типа «План» с тем же продуктом и блоком */
export async function carryPromise(actor: Actor, entryId: string): Promise<{ promise: EntryPromise; entry: WeeklyEntry }> {
  return prisma.$transaction(async (tx) => {
    const { entry, promise, week, info } = await promiseContext(tx, actor, entryId);
    const review = entry.promiseReview;
    if (!review) return fail("Сначала поставьте итог обещания");
    if (!canCarry(RESULT_CODE[review.result])) fail("В план переносят только то, что сделано частично или не сделано");
    if (review.carriedId) fail("Уже в плане этой недели");
    const plan = await tx.dictionaryItem.findFirst({ where: { kind: "ENTRY_TYPE", code: "plan", active: true } });
    if (!plan) return fail("Тип записи «План» скрыт в справочнике: перенести не получится");
    const text = splitWhat(promise.what);
    const count = await tx.weeklyEntry.count({ where: { weekId: week.id, authorId: entry.authorId } });
    const created = await tx.weeklyEntry.create({
      data: {
        weekId: week.id,
        authorId: entry.authorId,
        directionId: entry.directionId,
        blockId: entry.blockId,
        typeId: plan.id,
        what: text.what,
        details: text.details ?? null,
        sortOrder: count,
      },
      include: entryInclude,
    });
    await tx.weeklyReport.upsert({
      where: { weekId_authorId: { weekId: week.id, authorId: entry.authorId! } },
      update: {},
      create: { weekId: week.id, authorId: entry.authorId!, state: "DRAFT" },
    });
    await tx.promiseReview.update({ where: { id: review.id }, data: { carriedId: created.id } });
    await audit(tx, actor, "weekly.entry.create", "weekly-entry", created.id, "Запись weekly", null, `Неделя ${info.number}: ${text.what}. Перенесено из плана прошлой недели`);
    const fresh = await tx.weeklyEntry.findUniqueOrThrow({ where: { id: entry.id }, include: promiseInclude });
    return { promise: toPromise(fresh)!, entry: toEntryDto(created) };
  });
}

/** Итоги обещаний недели key по людям: планы прошлой недели и задачи со сроком на неделе */
export async function promiseSummaries(key: WeekKey, personIds: string[]): Promise<{ people: { slug: PersonSlug; summary: PromiseSummary }[]; total: PromiseSummary }> {
  if (!isWeekKey(key) || !personIds.length) return { people: [], total: EMPTY_SUMMARY };
  const week = { start: key, end: weekEndOf(key) };
  const [people, prev, taskRows] = await Promise.all([
    prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, slug: true }, orderBy: { sortOrder: "asc" } }),
    prisma.week.findUnique({ where: { start: dbDate(shiftWeek(key, -1)) }, select: { id: true } }),
    prisma.task.findMany({
      where: {
        ownerId: { in: personIds },
        archivedAt: null,
        status: { not: "PROPOSED" },
        OR: [{ due: { gte: dbDate(week.start), lte: dbDate(week.end) } }, { transfers: { some: { fromDue: { gte: dbDate(week.start), lte: dbDate(week.end) } } } }],
      },
      include: taskListInclude,
    }),
  ]);
  const entries = prev
    ? await prisma.weeklyEntry.findMany({ where: { AND: [{ weekId: prev.id, authorId: { in: personIds } }, candidate] }, include: promiseInclude })
    : [];
  const tasks = taskRows.map((row) => toTaskDto({ ...row, comments: [] }));
  const today = moscowToday();
  const rows = people.map((p) => {
    const slug = p.slug as PersonSlug;
    const fromEntries = entries
      .filter((e) => e.authorId === p.id)
      .map(toPromise)
      .filter((x): x is EntryPromise => x !== null)
      .map((x) => x.review?.result);
    const fromTasks = promiseTasks(tasks, slug, week).map((t) => taskPromiseOutcome(t, week, today).result);
    return { slug, summary: summarize([...fromEntries, ...fromTasks]) };
  });
  return { people: rows.filter((r) => r.summary.total > 0), total: rows.reduce((acc, r) => addSummary(acc, r.summary), EMPTY_SUMMARY) };
}

/** Вернуть сданный weekly в черновик, пока неделя открыта. Повторная сдача после срока будет с опозданием */
export async function reopenWeekly(actor: Actor, key: WeekKey): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { row, info, reporting } = await weekContext(tx, key, actor.personId);
    // Даже управлению: закрытая неделя уже разобрана на встрече, её weekly остаётся сданным
    if (info.closed) fail(`Неделя ${info.number} закрыта: weekly остаётся сданным`);
    canEdit(info, reporting, actor, actor.slug);
    const report = await tx.weeklyReport.findUnique({ where: { weekId_authorId: { weekId: row.id, authorId: actor.personId } } });
    if (!report || report.state === "DRAFT") return fail("Weekly ещё не сдан");
    const changed = await tx.weeklyReport.updateMany({ where: { id: report.id, state: { not: "DRAFT" } }, data: { state: "DRAFT", submittedAt: null } });
    if (!changed.count) fail("Weekly уже в черновике");
    await audit(tx, actor, "weekly.reopen", "weekly", `${key}/${actor.slug}`, `Weekly за неделю ${info.number}`, report.state === "LATE" ? "Сдан с опозданием" : "Сдан", "Черновик");
  });
}

// ---------- Снимок недели и личная статистика (этап 22б) ----------

type PromiseView = { people: { slug: PersonSlug; summary: PromiseSummary }[]; total: PromiseSummary };
type SnapshotData = { promises: PromiseView };

/**
 * Снимок итогов обещаний на момент закрытия недели, по всем людям департамента: дальше правки задач его не меняют.
 * Отчёт CEO и личная статистика берут из него своих людей
 */
export async function takeWeekSnapshot(key: WeekKey): Promise<void> {
  const week = await prisma.week.findUnique({ where: { start: dbDate(key) }, select: { id: true } });
  if (!week) return;
  const everyone = await prisma.person.findMany({ where: { active: true, role: { not: "OBSERVER" } }, select: { id: true } });
  const data: SnapshotData = { promises: await promiseSummaries(key, everyone.map((p) => p.id)) };
  const json = data as unknown as Prisma.InputJsonValue;
  try {
    await prisma.weekSnapshot.upsert({ where: { weekId: week.id }, update: { data: json, takenAt: new Date() }, create: { weekId: week.id, data: json } });
  } catch (error) {
    // Два первых чтения закрытой недели одновременно: снимок уже сделал соседний запрос
    if ((error as { code?: string }).code !== "P2002") throw error;
  }
}

/** Неделю открыли снова: снимок больше не нужен, при следующем закрытии он сделается заново */
export async function dropWeekSnapshot(key: WeekKey): Promise<void> {
  await prisma.weekSnapshot.deleteMany({ where: { week: { start: dbDate(key) } } });
}

/** Снимок, который годится: сделан после закрытия недели. Более ранний остался от прошлого закрытия */
function validSnapshot(week: { closedAt: Date | null; snapshot: { takenAt: Date; data: unknown } | null }) {
  return week.closedAt && week.snapshot && week.snapshot.takenAt >= week.closedAt ? week.snapshot : null;
}

/** Из снимка всего департамента только нужные люди и итог по ним */
function fromSnapshot(data: unknown, wanted: Set<string>): PromiseView {
  const people = (data as SnapshotData).promises.people.filter((p) => wanted.has(p.slug));
  return { people, total: people.reduce((acc, p) => addSummary(acc, p.summary), EMPTY_SUMMARY) };
}

/**
 * Итоги обещаний нескольких недель одним заходом: у закрытых недель из снимка, у открытых живые. Закрытая неделя без
 * снимка (закрыта до этапа 22б) считается вживую, снимок при чтении не пишется. snapshotAt: когда сделан снимок
 */
export async function weekPromisesMany(keys: WeekKey[], personIds: string[]): Promise<Map<WeekKey, PromiseView & { snapshotAt?: string }>> {
  const out = new Map<WeekKey, PromiseView & { snapshotAt?: string }>();
  const valid = keys.filter(isWeekKey);
  if (!valid.length || !personIds.length) return out;
  const [weeks, people] = await Promise.all([
    prisma.week.findMany({ where: { start: { in: valid.map(dbDate) } }, select: { start: true, closedAt: true, snapshot: { select: { takenAt: true, data: true } } } }),
    prisma.person.findMany({ where: { id: { in: personIds } }, select: { slug: true } }),
  ]);
  const wanted = new Set(people.map((p) => p.slug));
  const byKey = new Map(weeks.map((w) => [isoFromDbDate(w.start), w]));
  const live: WeekKey[] = [];
  for (const k of valid) {
    const snap = byKey.has(k) ? validSnapshot(byKey.get(k)!) : null;
    if (snap) out.set(k, { ...fromSnapshot(snap.data, wanted), snapshotAt: snap.takenAt.toISOString() });
    else live.push(k);
  }
  const computed = await Promise.all(live.map((k) => promiseSummaries(k, personIds)));
  live.forEach((k, i) => out.set(k, computed[i]!));
  return out;
}

/** Итоги обещаний одной недели для отчёта CEO */
export async function weekPromises(key: WeekKey, personIds: string[]): Promise<PromiseView & { snapshotAt?: string }> {
  return (await weekPromisesMany([key], personIds)).get(key) ?? { people: [], total: EMPTY_SUMMARY };
}

/** Сколько недель показывать в личной статистике и после скольких недель с обещаниями она включается */
export const STATS_WEEKS = 8;
export const STATS_MIN_WEEKS = 6;

export type PromiseHistory = {
  slug: PersonSlug;
  weeks: { key: WeekKey; number: number; summary: PromiseSummary }[];
  /** Сумма за показанные недели */
  total: PromiseSummary;
  /** Недель с обещаниями: статистика включается с STATS_MIN_WEEKS */
  active: number;
  enabled: boolean;
};

/**
 * Личная статистика «обещал и сделал» за последние 8 недель до key включительно. Видят её сам человек и директор:
 * это диагностика, а не рейтинг. Закрытые недели берутся из снимков
 */
export async function promiseHistory(personIds: string[], key: WeekKey): Promise<PromiseHistory[]> {
  if (!isWeekKey(key) || !personIds.length) return [];
  const keys = Array.from({ length: STATS_WEEKS }, (_, i) => shiftWeek(key, i - STATS_WEEKS + 1));
  const [views, people] = await Promise.all([
    weekPromisesMany(keys, personIds),
    prisma.person.findMany({ where: { id: { in: personIds } }, select: { slug: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  return people.map((p) => {
    const slug = p.slug as PersonSlug;
    const weeks = keys.map((k) => ({ key: k, number: weekNumberOf(k), summary: views.get(k)?.people.find((x) => x.slug === slug)?.summary ?? EMPTY_SUMMARY }));
    const active = weeks.filter((w) => w.summary.total > 0).length;
    return { slug, weeks, total: weeks.reduce((acc, w) => addSummary(acc, w.summary), EMPTY_SUMMARY), active, enabled: active >= STATS_MIN_WEEKS };
  });
}
