// Забор задач из рабочего Insurance&Invest Bord в ресурс.
// Решение Арама 06.10.2026: Bord остаётся главным, пока не готова финальная версия ресурса, а ресурс получает из него задачи всех сотрудников.
// Ресурс только читает вкладку «Задачи» (служебному аккаунту хватает права «Читатель») и ничего в Bord не пишет.
//
// Как переносится:
// - строка с новым номером становится задачей ресурса;
// - поле задачи меняется в ресурсе, только если оно изменилось в Bord с прошлого забора. Правка, сделанная в ресурсе,
//   живёт, пока это поле не поменяют в Bord; тогда побеждает Bord, и это видно в журнале;
// - при первом заборе прошлого значения нет: все поля, которые расходятся с Bord, берутся из Bord;
// - задачи, заведённые в ресурсе, получают номера от 1001, чтобы не столкнуться с новыми номерами Bord.
//   Если такая задача уже стоит на номере ниже 1001, она получает новый номер и запись в журнале;
// - ответственного, которого нет среди людей ресурса, ресурс добавляет сам и показывает владельцу на странице «Синхронизация»;
// - задачу, которую удалили из Bord, ресурс не трогает и показывает в списке «нет в Bord».
// Одна битая строка забор не останавливает, поменявшийся формат вкладки останавливает целиком.

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { TaskStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { moscowDateTime } from "@/lib/week";
import type { SheetsClient } from "@/lib/sheet/client";
import { GoogleSheetsError } from "@/lib/sheet/google";
import { dbDate, isoFromDbDate, moscowToday } from "@/lib/tasks/dates";
import { IMPORT_TRANSFER_REASON, STATUS_FROM_TABLE, STATUS_TO_TABLE, whereUpdatedFrom } from "@/lib/tasks/bord-import";
import { slugify, uniqueSlug } from "@/lib/translit";
import { taskSubject } from "@/lib/inbox/notify";
import { formatLong, type IsoDate } from "@/domain/dates";
import { ALL_LEADERS, NameIndex, normName, personNameFromBord, splitOwners } from "./names";
import { BORD_RANGE, BordFormatError, parseBordGrid, type BordRow } from "./parse";

export type BordReader = Pick<SheetsClient, "getValues">;

/** С этого номера начинаются задачи, заведённые в ресурсе: номера Bord идут ниже */
export const RESOURCE_FIRST_NUMBER = 1001;
/** Метка задач, созданных забором (задачи первого импорта несут метку своей выгрузки) */
export const PULL_BATCH = "bord-pull";
export const BORD_ACTOR = "Bord";
export const BORD_ZONE = "Добавлен из Bord";
const TRANSFER_REASON = "Срок изменён в Bord";
const CLOSED_RESOLUTION = "Закрыта в Bord";
const TITLE_MAX = 120;
const OUTCOME_MAX = 1000;
const PROBLEMS_KEEP = 50;
const HISTORY_KEEP = 30;

/** Значения строки Bord на прошлом заборе. Поле без значения (проблема в нём) проверяется заново на следующем заборе */
type Snap = Partial<Omit<BordRow, "number" | "line">>;
/** Прошлые значения полей по номерам задач и Bord, из которого их прочитали: значения другого Bord не в счёт */
type Snapshot = { source: string; rows: Record<string, Snap> };

export type PullReport = {
  /** Строк задач во вкладке */
  rows: number;
  created: number[];
  updated: number[];
  /** Сколько полей задач поменялось */
  fields: number;
  /** Сколько правок, сделанных в ресурсе, заменило новое значение из Bord */
  overwritten: number;
  renumbered: { from: number; to: number }[];
  newPeople: string[];
  problems: string[];
  /** Задачи из Bord, которых в Bord больше нет: в ресурсе они остаются как были */
  missing: number[];
};

export type PullRun = { at: string; ok: boolean; how: "auto" | "manual"; created: number; updated: number; error: string | null };

/** Состояние забора для страницы «Синхронизация» и расписания */
export type PullState = {
  lastAttemptAt: string | null;
  lastOkAt: string | null;
  ok: boolean | null;
  error: string | null;
  report: PullReport | null;
  history: PullRun[];
};

export const EMPTY_PULL_STATE: PullState = { lastAttemptAt: null, lastOkAt: null, ok: null, error: null, report: null, history: [] };

const CLOSED: TaskStatus[] = ["DONE", "FAILED", "CANCELLED"];

const clipTitle = (title: string) => (title.length <= TITLE_MAX ? title : `${title.slice(0, TITLE_MAX - 3).trimEnd()}...`);
const outcomeOf = (s: Snap) => (s.outcome || s.title || "").slice(0, OUTCOME_MAX);
const ruDate = (iso: IsoDate | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");
const atMorning = (iso: IsoDate) => moscowDateTime({ year: +iso.slice(0, 4), month: +iso.slice(5, 7), day: +iso.slice(8, 10) });
/** Значения строки для следующего забора. Поля с проблемой не запоминаем: их проверим ещё раз, остальные поля это не задевает */
function snapOf(r: BordRow, bad: Set<keyof Snap> = new Set()): Snap {
  const s: Snap = { meeting: r.meeting, owner: r.owner, title: r.title, outcome: r.outcome, due: r.due, status: r.status, comment: r.comment };
  for (const f of bad) delete s[f];
  return s;
}

type Owners = { ownerId: string | null; ownerAll: boolean; co: string[] };

/**
 * Один забор: прочитать вкладку «Задачи» и перенести изменения. null: забор уже идёт в другом процессе сервера.
 * Ошибку чтения или формата бросает наружу, в базе в этом случае ничего не меняется
 */
export async function pullBord(reader: BordReader, opts: { now?: Date; db?: PrismaClient; sourceId?: string } = {}): Promise<PullReport | null> {
  const db = opts.db ?? prisma;
  const now = opts.now ?? new Date();
  const source = opts.sourceId ?? "";

  return db.$transaction(
    async (tx) => {
      // Два процесса сервера (во время выкладки) не забирают одновременно
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('bord.pull')) AS "locked"`;
      if (!lock?.locked) return null;
      // Bord читаем уже под замком: забор, который прочитал раньше, не перепишет более свежий
      const parsed = parseBordGrid(await reader.getValues(BORD_RANGE));
      if (!parsed.rows.length) throw new BordFormatError("Во вкладке «Задачи» нет ни одной задачи с номером. Забор остановлен, в ресурсе ничего не изменено");
      // Номера от 1001 у задач ресурса: такая строка в Bord скорее опечатка, и задачу ресурса она не перепишет
      const outOfRange = parsed.rows.filter((r) => r.number >= RESOURCE_FIRST_NUMBER);
      const rows = parsed.rows.filter((r) => r.number < RESOURCE_FIRST_NUMBER);

      const report: PullReport = {
        rows: rows.length,
        created: [],
        updated: [],
        fields: 0,
        overwritten: 0,
        renumbered: [],
        newPeople: [],
        problems: [
          ...parsed.problems.map((p) => p.text),
          ...outOfRange.map((r) => `строка ${r.line}: номер ${r.number} из номеров задач ресурса (от ${RESOURCE_FIRST_NUMBER}), не перенесена. Номера задач Bord ниже ${RESOURCE_FIRST_NUMBER}`),
        ],
        missing: [],
      };
      const audit = (number: number, action: string, field: string, before: string | null, after: string | null) =>
        tx.auditLog.create({ data: { action, source: "SHEET", actorName: BORD_ACTOR, entity: "task", entityId: String(number), field, before: before ?? undefined, after: after ?? undefined } });

      // ---------- Люди ----------
      const fallback = await tx.dictionaryItem.findFirst({ where: { kind: "DIRECTION", code: "department" } });
      if (!fallback) throw new Error("В справочнике нет направления «Департамент»: сначала запустите сид");
      const people = await tx.person.findMany({ select: { id: true, slug: true, fullName: true, shortName: true, sortOrder: true, defaultDirectionId: true } });
      const byId = new Map(people.map((p) => [p.id, p]));
      const index = new NameIndex(people);
      const takenSlugs = new Set([...people.map((p) => p.slug), "all", "system"]);
      let sortOrder = Math.max(0, ...people.map((p) => p.sortOrder));

      async function personFor(name: string): Promise<string | "ambiguous"> {
        const hit = index.find(name);
        if (hit.person) return hit.person.id;
        if (hit.ambiguous) return "ambiguous";
        const { fullName, shortName } = personNameFromBord(name);
        const slug = uniqueSlug(slugify(fullName.split(" ")[0] ?? fullName, 24), takenSlugs);
        takenSlugs.add(slug);
        sortOrder += 10;
        const p = await tx.person.create({
          data: { slug, fullName, shortName, role: "LEADER", zone: BORD_ZONE, defaultDirectionId: fallback!.id, sortOrder, active: true },
          select: { id: true, slug: true, fullName: true, shortName: true, sortOrder: true, defaultDirectionId: true },
        });
        byId.set(p.id, p);
        index.add(p);
        report.newPeople.push(fullName);
        await tx.auditLog.create({
          data: {
            action: "settings.person.create",
            source: "SHEET",
            actorName: BORD_ACTOR,
            entity: "person",
            entityId: slug,
            field: "Человек добавлен из Bord",
            after: `${fullName}: ответственный задачи в Bord. Роль «Лидер», направление «Департамент»`,
          },
        });
        return p.id;
      }

      /** Ответственный и соисполнители из ячейки. null: имя подходит нескольким людям, ответственного не трогаем */
      async function ownersOf(cell: string, number: number): Promise<Owners | null> {
        if (normName(cell) === normName(ALL_LEADERS)) return { ownerId: null, ownerAll: true, co: [] };
        const ids: string[] = [];
        for (const name of splitOwners(cell)) {
          if (normName(name) === normName(ALL_LEADERS)) continue;
          const id = await personFor(name);
          if (id === "ambiguous") {
            report.problems.push(`задача ${number}: «${name}» не сопоставить однозначно с человеком ресурса, ответственный не изменён. Напишите в Bord фамилию и имя полностью`);
            return null;
          }
          if (!ids.includes(id)) ids.push(id);
        }
        return { ownerId: ids[0] ?? null, ownerAll: false, co: ids.slice(1) };
      }

      const ownersText = (o: Owners) => (o.ownerAll ? ALL_LEADERS : [o.ownerId, ...o.co].map((id) => (id ? (byId.get(id)?.fullName ?? "") : "")).filter(Boolean).join(", ") || "не назначен");

      // ---------- Номера задач ресурса ----------
      const bordNumbers = rows.map((r) => r.number);
      const maxNumber = (await tx.task.aggregate({ _max: { number: true } }))._max.number ?? 0;
      let nextFree = Math.max(RESOURCE_FIRST_NUMBER, maxNumber + 1, Math.max(...bordNumbers) + 1);
      const ownMade = await tx.task.findMany({ where: { importBatch: null, number: { lt: RESOURCE_FIRST_NUMBER } }, orderBy: { number: "asc" }, select: { id: true, number: true } });
      for (const t of ownMade) {
        const to = nextFree++;
        await tx.task.update({ where: { id: t.id }, data: { number: to } });
        // События «Мне» склеиваются по номеру задачи: со старым номером они слиплись бы с задачей Bord под тем же номером
        await tx.inboxEvent.updateMany({ where: { taskId: t.id }, data: { subject: taskSubject(to) } });
        report.renumbered.push({ from: t.number, to });
        await audit(to, "task.renumber", `Номер задачи: задачи ресурса идут от ${RESOURCE_FIRST_NUMBER}, номера ниже у задач из Bord`, String(t.number), String(to));
      }
      // ---------- Задачи ----------
      const stored = (await tx.setting.findUnique({ where: { key: "bord.snapshot" } }))?.value as Snapshot | null | undefined;
      const snapshot: Record<string, Snap> = stored && stored.source === source && stored.rows ? stored.rows : {};
      const nextSnapshot: Record<string, Snap> = {};
      // Задачи с повтором номера в Bord не трогаем: их прошлые значения сохраняем как были
      for (const n of parsed.skipped) if (snapshot[String(n)]) nextSnapshot[String(n)] = snapshot[String(n)]!;
      const existing = await tx.task.findMany({ where: { number: { in: bordNumbers } }, include: { coExecutors: { select: { personId: true } } } });
      const byNumber = new Map(existing.map((t) => [t.number, t]));
      const today = moscowToday(now);

      for (const row of rows) {
        const task = byNumber.get(row.number);
        const snap = snapshot[String(row.number)];
        const status = STATUS_FROM_TABLE[row.status];
        const bad = new Set<keyof Snap>();

        if (!task) {
          if (!row.title) {
            report.problems.push(`задача ${row.number}: пустая «Задача», не перенесена`);
            continue;
          }
          if (!row.due) {
            report.problems.push(`задача ${row.number}: срок не указан или не в формате ДД.ММ.ГГГГ, не перенесена`);
            continue;
          }
          if (!status) {
            report.problems.push(`задача ${row.number}: статус «${row.status}» не из справочника, перенесена со статусом «В работе»`);
            bad.add("status");
          }
          const resolved = await ownersOf(row.owner, row.number);
          if (!resolved) bad.add("owner");
          const owners = resolved ?? { ownerId: null, ownerAll: false, co: [] };
          const moved = row.status === "Перенесена";
          const closed = !!status && CLOSED.includes(status);
          const whereUpdated = row.meeting ? whereUpdatedFrom(row.comment, row.meeting) : today;
          const data: Prisma.TaskUncheckedCreateInput = {
            number: row.number,
            title: clipTitle(row.title),
            outcome: outcomeOf(row),
            ownerId: owners.ownerId,
            ownerAll: owners.ownerAll,
            directionId: (owners.ownerId && byId.get(owners.ownerId)?.defaultDirectionId) || fallback.id,
            // Приоритета и состояния в Bord нет: «не задан», пока ответственный или владелец не выставит
            priority: null,
            state: null,
            status: status ?? "IN_PROGRESS",
            whereNow: row.comment,
            whereUpdatedAt: dbDate(whereUpdated),
            due: dbDate(row.due),
            originalDue: moved ? null : dbDate(row.due),
            sourceCode: "meeting",
            sourceNote: row.meeting ? formatLong(row.meeting) : null,
            sourceDate: row.meeting ? dbDate(row.meeting) : null,
            createdById: null,
            createdAt: row.meeting ? atMorning(row.meeting) : now,
            updatedAt: atMorning(whereUpdated),
            resolution: closed ? CLOSED_RESOLUTION : null,
            importBatch: PULL_BATCH,
            transfers: moved ? { create: [{ fromDue: null, toDue: dbDate(row.due), reason: IMPORT_TRANSFER_REASON, byId: null, at: null }] } : undefined,
            coExecutors: owners.co.length ? { create: owners.co.map((personId) => ({ personId })) } : undefined,
          };
          await tx.task.create({ data });
          await audit(
            row.number,
            "task.import",
            "Задача перенесена из Bord",
            null,
            `${clipTitle(row.title)}. ${row.meeting ? `Встреча ${formatLong(row.meeting)}, о` : "О"}тветственный ${ownersText(owners)}, срок ${ruDate(row.due)}, статус «${row.status || "В работе"}»`,
          );
          report.created.push(row.number);
          nextSnapshot[String(row.number)] = snapOf(row, bad);
          continue;
        }

        // Задача уже есть: переносим только то, что поменялось в Bord с прошлого забора
        const inBord = <T>(pick: (s: Snap) => T) => !snap || pick(snap) !== pick(row);
        const data: Prisma.TaskUncheckedUpdateInput = {};
        const changes: [string, string, string][] = [];
        const take = <T>(field: string, current: T, next: T, fromSnap: T | undefined, show: (v: T) => string, apply: () => void) => {
          if (current === next) return;
          // В ресурсе это поле правили после прошлого забора, а теперь его поменяли и в Bord: побеждает Bord
          if (snap && fromSnap !== undefined && current !== fromSnap) report.overwritten += 1;
          apply();
          changes.push([field, show(current), show(next)]);
        };

        const titleOf = (s: Snap) => (s.title === undefined ? undefined : clipTitle(s.title));
        if (row.title && inBord(titleOf)) {
          take("Задача", task.title, clipTitle(row.title), snap && titleOf(snap), String, () => (data.title = clipTitle(row.title)));
        }
        const outcome = outcomeOf(row);
        if (outcome && inBord(outcomeOf)) take("Что нужно сделать", task.outcome, outcome, snap && outcomeOf(snap), String, () => (data.outcome = outcome));
        if (inBord((s) => s.comment)) {
          take("Где сейчас", task.whereNow, row.comment, snap?.comment, String, () => {
            data.whereNow = row.comment;
            data.whereUpdatedAt = dbDate(today);
          });
        }
        if (row.meeting && inBord((s) => s.meeting)) {
          const was = task.sourceDate ? isoFromDbDate(task.sourceDate) : null;
          take("Дата встречи", was, row.meeting, snap?.meeting ?? undefined, ruDate, () => {
            data.sourceDate = dbDate(row.meeting!);
            data.sourceNote = formatLong(row.meeting!);
          });
        }
        const extra: { transfer?: Prisma.TaskTransferUncheckedCreateWithoutTaskInput } = {};
        if (inBord((s) => s.due)) {
          if (!row.due) {
            report.problems.push(`задача ${row.number}: срок в Bord не в формате ДД.ММ.ГГГГ, срок в ресурсе не изменён`);
            bad.add("due");
          } else {
            const was = isoFromDbDate(task.due);
            take("Срок", was, row.due, snap?.due ?? undefined, ruDate, () => {
              data.due = dbDate(row.due!);
              extra.transfer = { fromDue: task.due, toDue: dbDate(row.due!), reason: TRANSFER_REASON, byId: null, at: now };
            });
          }
        }
        if (inBord((s) => s.status)) {
          if (!status) {
            report.problems.push(`задача ${row.number}: статус «${row.status}» не из справочника, статус в ресурсе не изменён`);
            bad.add("status");
          } else {
            const fromSnap = snap?.status !== undefined ? STATUS_FROM_TABLE[snap.status] : undefined;
            take("Статус", task.status, status, fromSnap, (v) => STATUS_TO_TABLE[v], () => {
              data.status = status;
              const wasClosed = CLOSED.includes(task.status);
              if (CLOSED.includes(status) && !wasClosed) {
                data.closedAt = now;
                data.resolution = task.resolution ?? CLOSED_RESOLUTION;
              }
              if (!CLOSED.includes(status) && wasClosed) {
                data.closedAt = null;
                data.resolution = null;
              }
            });
          }
        }
        let co: string[] | null = null;
        if (inBord((s) => normName(s.owner ?? ""))) {
          const owners = await ownersOf(row.owner, row.number);
          if (!owners) bad.add("owner");
          else {
            const was: Owners = { ownerId: task.ownerId, ownerAll: task.ownerAll, co: task.coExecutors.map((c) => c.personId) };
            const same = was.ownerAll === owners.ownerAll && was.ownerId === owners.ownerId && was.co.length === owners.co.length && owners.co.every((id) => was.co.includes(id));
            if (!same) {
              if (snap?.owner !== undefined && normName(ownersText(was)) !== normName(snap.owner)) report.overwritten += 1;
              data.ownerId = owners.ownerId;
              data.ownerAll = owners.ownerAll;
              co = owners.co;
              changes.push(["Ответственный", ownersText(was), ownersText(owners)]);
            }
          }
        }

        // Поле с проблемой проверяем и в следующий раз: проблема остаётся на виду, пока её не поправят в Bord
        nextSnapshot[String(row.number)] = snapOf(row, bad);
        if (!changes.length) continue;
        if (co) {
          await tx.taskCoExecutor.deleteMany({ where: { taskId: task.id } });
          if (co.length) await tx.taskCoExecutor.createMany({ data: co.map((personId) => ({ taskId: task.id, personId })) });
        }
        await tx.task.update({ where: { id: task.id }, data: { ...data, ...(extra.transfer ? { transfers: { create: [extra.transfer] } } : {}) } });
        for (const [field, before, after] of changes) await audit(row.number, "task.bord", field, before, after);
        report.updated.push(row.number);
        report.fields += changes.length;
      }

      // Задачи из Bord, которые из Bord пропали: в ресурсе остаются, владелец видит список
      report.missing = (
        await tx.task.findMany({
          where: { importBatch: { not: null }, number: { notIn: [...bordNumbers, ...parsed.skipped] }, archivedAt: null },
          select: { number: true },
          orderBy: { number: "asc" },
        })
      ).map((t) => t.number);
      const value: Snapshot = { source, rows: nextSnapshot };
      await tx.setting.upsert({ where: { key: "bord.snapshot" }, update: { value }, create: { key: "bord.snapshot", value } });
      // Новые задачи ресурса начнутся после задач Bord и уже перенумерованных. Настройку меняем в конце: строку настройки
      // держит замок до конца забора, и создание задачи в это время ждало бы весь забор
      const setting = await tx.setting.findUnique({ where: { key: "tasks.nextNumber" } });
      const current = typeof setting?.value === "number" ? setting.value : 0;
      if (current < nextFree) await tx.setting.upsert({ where: { key: "tasks.nextNumber" }, update: { value: nextFree }, create: { key: "tasks.nextNumber", value: nextFree } });
      report.problems = report.problems.slice(0, PROBLEMS_KEEP);
      return report;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

/** Состояние забора из настроек */
export async function pullState(db: PrismaClient = prisma): Promise<PullState> {
  const row = await db.setting.findUnique({ where: { key: "bord.pull" } });
  return { ...EMPTY_PULL_STATE, ...((row?.value as Partial<PullState> | null) ?? {}) };
}

/** Короткий текст ошибки забора для страницы: без технических хвостов */
export function pullErrorText(error: unknown): string {
  if (error instanceof GoogleSheetsError) {
    if (/нет нужной вкладки/.test(error.message)) return "В Bord нет вкладки «Задачи»";
    if (error.status === 0 || error.status >= 400) return error.message.split(". ")[0]!;
  }
  if (error instanceof BordFormatError) return error.message;
  if (error instanceof Error && /fetch failed|timeout|aborted/i.test(error.message)) return "Google не ответил. Повторим через 15 минут";
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0]!.slice(0, 500);
}

/**
 * Забор с записью результата: для расписания и кнопки «Забрать сейчас».
 * Ошибку не бросает: она остаётся в состоянии забора и на странице «Синхронизация». null: забор уже идёт в другом процессе
 */
export async function runPull(reader: BordReader, how: PullRun["how"], opts: { now?: Date; db?: PrismaClient; sourceId?: string } = {}): Promise<{ report: PullReport | null; error: string | null } | null> {
  const db = opts.db ?? prisma;
  const now = opts.now ?? new Date();
  let report: PullReport | null = null;
  let error: string | null = null;
  try {
    report = await pullBord(reader, { now, db, sourceId: opts.sourceId });
    if (report === null) return null;
  } catch (e) {
    error = pullErrorText(e);
  }
  const before = await pullState(db);
  const state: PullState = {
    lastAttemptAt: now.toISOString(),
    lastOkAt: error ? before.lastOkAt : now.toISOString(),
    ok: !error,
    error,
    // При ошибке показываем последний удачный отчёт: что сейчас в ресурсе
    report: report ?? before.report,
    history: [{ at: now.toISOString(), ok: !error, how, created: report?.created.length ?? 0, updated: report?.updated.length ?? 0, error }, ...before.history].slice(0, HISTORY_KEEP),
  };
  await db.setting.upsert({ where: { key: "bord.pull" }, update: { value: state }, create: { key: "bord.pull", value: state } });
  return { report, error };
}

/** Таблица, из которой забираем задачи. null: забор выключен */
export function bordSourceId(): Promise<string | null> {
  return getSetting<string | null>("bord.sourceId", null);
}
