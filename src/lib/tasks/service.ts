// Задачи на сервере (раздел 4 ТЗ). Каждое действие проверяет права по матрице раздела 2,
// меняет задачу в одной транзакции и пишет в журнал, что было и что стало.

import { prisma } from "@/lib/db";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Role, TaskPriority, TaskState, TaskStatus } from "@/generated/prisma/enums";
import { priorityOf, sourceLabel, stateLabel, statusOf, type PriorityCode, type StateCode, type StatusCode } from "@/domain/dictionaries";
import { formatLong, type IsoDate } from "@/domain/dates";
import type { HistoryItem, Owner, PersonSlug, Task } from "@/domain/types";
import { newTaskStatus, permissions, statusNeedsNote, type ManagementRole, type TaskPermissions, type Viewer } from "./rules";
import { CLOSED_DB, priorityCode, priorityDb, stateCode, stateDb, statusCode, statusDb } from "./codes";
import { dbDate, isIsoDate, isoFromDbDate, moscowIso, moscowTime, moscowToday } from "./dates";
import { ownerOf, taskInclude, toTaskDto, type TaskRow } from "./dto";
import { issueUndoToken, readUndoToken, type TaskSnapshot, type UndoSpec } from "./undo";

export const LIMITS = { title: 120, outcome: 1000, where: 500, note: 1000, reason: 500, comment: 2000, linkTitle: 120, url: 500, sourceNote: 200 };

/** Кто действует: профиль, роль и включённый режим управления */
export type Actor = {
  personId: string;
  slug: PersonSlug;
  fullName: string;
  role: Role;
  management: ManagementRole | null;
  ip?: string | null;
};

/** Ошибка правила: текст показывается человеку как есть */
export class TaskRuleError extends Error {}

export type TaskResult = { task: Task; undo?: string };

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

function viewerOf(actor: Actor): Viewer {
  return { slug: actor.slug, management: actor.management, observer: actor.role === "OBSERVER" };
}

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/[—–]/g, "-").replace(/\s+$/g, "").replace(/^\s+/g, "");
}

function required(text: string | null | undefined, max: number, emptyMessage: string, field: string): string {
  const value = clean(text);
  if (!value) fail(emptyMessage);
  if (value.length > max) fail(`${field}: не длиннее ${max} знаков`);
  return value;
}

function optional(text: string | null | undefined, max: number, field: string): string | null {
  const value = clean(text);
  if (!value) return null;
  if (value.length > max) fail(`${field}: не длиннее ${max} знаков`);
  return value;
}

function checkUrl(url: string): string {
  const value = clean(url);
  if (value.length > LIMITS.url) fail(`Ссылка длиннее ${LIMITS.url} знаков`);
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    return u.toString();
  } catch {
    return fail("Ссылка должна начинаться с https:// или http://");
  }
}

async function peopleBySlug(db: Db) {
  const people = await db.person.findMany({ where: { active: true } });
  return new Map(people.map((p) => [p.slug, p]));
}

async function personName(db: Db, slug: PersonSlug): Promise<string> {
  return (await db.person.findUnique({ where: { slug } }))?.fullName ?? slug;
}

function ownerLabel(row: Pick<TaskRow, "ownerAll" | "owner">, names: Map<string, string>): string {
  const o = ownerOf(row);
  return o === "all" ? "Все лидеры" : (names.get(o) ?? o);
}

async function nameMap(db: Db): Promise<Map<string, string>> {
  const people = await db.person.findMany({ select: { slug: true, fullName: true } });
  return new Map(people.map((p) => [p.slug, p.fullName]));
}

async function lockRow(tx: Tx, number: number): Promise<TaskRow> {
  // Блокировка строки: два человека не перепишут одну задачу одновременно
  await tx.$queryRaw`SELECT id FROM "tasks" WHERE "number" = ${number} FOR UPDATE`;
  const row = await tx.task.findUnique({ where: { number }, include: taskInclude });
  if (!row) fail(`Задачи ${number} нет`);
  return row!;
}

function snapshot(row: TaskRow): TaskSnapshot {
  return {
    title: row.title,
    outcome: row.outcome,
    directionId: row.directionId,
    sourceCode: row.sourceCode,
    sourceNote: row.sourceNote,
    status: row.status,
    resolution: row.resolution,
    closedAt: row.closedAt?.toISOString() ?? null,
    state: row.state,
    blockedBy: row.blockedBy,
    priority: row.priority,
    whereNow: row.whereNow,
    whereUpdatedAt: isoFromDbDate(row.whereUpdatedAt),
    due: isoFromDbDate(row.due),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

type Change = { field: string; before?: string | null; after?: string | null; action?: string };

async function audit(db: Db, actor: Actor, number: number, changes: Change[]): Promise<void> {
  if (!changes.length) return;
  await db.auditLog.createMany({
    data: changes.map((c) => ({
      action: c.action ?? "task.update",
      actorId: actor.personId,
      actorName: actor.fullName,
      source: "APP" as const,
      entity: "task",
      entityId: String(number),
      field: c.field,
      before: c.before ?? undefined,
      after: c.after ?? undefined,
      ip: actor.ip ?? null,
    })),
  });
}

type Plan = { data: Prisma.TaskUncheckedUpdateInput; changes: Change[]; undo?: Omit<Extract<UndoSpec, { kind: "restore" }>, "kind" | "number" | "snapshot" | "expectUpdatedAt"> | false };

/**
 * Общий ход правки: блокируем строку, проверяем правило, меняем, пишем журнал, отдаём новую задачу и токен отмены.
 * plan получает задачу и права и возвращает изменения. undo: false значит «эту правку не отменяют».
 */
async function mutate(actor: Actor, number: number, plan: (row: TaskRow, can: TaskPermissions, tx: Tx) => Promise<Plan>): Promise<TaskResult> {
  return prisma.$transaction(async (tx) => {
    const row = await lockRow(tx, number);
    if (row.archivedAt && actor.management !== "OWNER") fail(`Задача ${number} в архиве`);
    const can = permissions(toTaskDto(row), viewerOf(actor));
    const before = snapshot(row);
    const p = await plan(row, can, tx);
    if (!p.changes.length) fail("Ничего не изменилось");
    const updated = await tx.task.update({ where: { id: row.id }, data: p.data, include: taskInclude });
    await audit(tx, actor, number, p.changes);
    const undo =
      p.undo === false
        ? undefined
        : issueUndoToken({ kind: "restore", number, snapshot: before, expectUpdatedAt: updated.updatedAt.toISOString(), ...(p.undo ?? {}) }, actor.personId);
    return { task: toTaskDto(updated), undo };
  });
}

// ---------- Чтение ----------

export async function listTasks(opts: { archived?: boolean } = {}): Promise<Task[]> {
  const rows = await prisma.task.findMany({
    where: opts.archived ? {} : { archivedAt: null },
    include: taskInclude,
    orderBy: { number: "asc" },
  });
  return rows.map(toTaskDto);
}

export async function getTask(number: number): Promise<Task | null> {
  const row = await prisma.task.findUnique({ where: { number }, include: taskInclude });
  return row ? toTaskDto(row) : null;
}

/** История задачи из журнала: новые сверху */
export async function taskHistory(number: number): Promise<HistoryItem[]> {
  const [rows, people] = await Promise.all([
    prisma.auditLog.findMany({ where: { entity: "task", entityId: String(number) }, orderBy: [{ at: "desc" }, { id: "desc" }], take: 200 }),
    prisma.person.findMany({ select: { id: true, slug: true } }),
  ]);
  const slugOf = new Map(people.map((p) => [p.id, p.slug as PersonSlug]));
  const text = (v: unknown) => (v === null || v === undefined ? undefined : typeof v === "string" ? v : JSON.stringify(v));
  // История начинается с последнего создания или импорта задачи с этим номером: если задачу удалили
  // и завели заново (повторный импорт), прежние записи журнала остаются в журнале, но не в карточке
  const start = rows.findIndex((r) => r.action === "task.import" || r.action === "task.create" || r.action === "task.propose");
  return (start >= 0 ? rows.slice(0, start + 1) : rows).map((r) => ({
    id: String(r.id),
    at: moscowIso(r.at),
    time: r.source === "APP" ? moscowTime(r.at) : "",
    by: (r.actorId && slugOf.get(r.actorId)) || "system",
    field: r.field ?? r.action,
    before: text(r.before),
    after: text(r.after),
  }));
}

// ---------- Создание ----------

export type NewTaskInput = {
  title: string;
  outcome: string;
  owner: Owner;
  coExecutors?: PersonSlug[];
  direction: string;
  priority?: PriorityCode;
  due: IsoDate;
  source?: string;
  sourceNote?: string;
  links?: { title?: string; url: string }[];
  /** Запись weekly, из которой сделана задача («Сделать задачей») */
  weeklyEntryId?: string;
};

/** Номер новой задачи: следующий после настройки tasks.nextNumber и после самой старшей задачи в базе */
async function nextNumber(tx: Tx): Promise<number> {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    UPDATE "settings"
    SET "value" = to_jsonb(GREATEST(("value" #>> '{}')::int, (SELECT COALESCE(MAX("number"), 0) + 1 FROM "tasks")) + 1), "updatedAt" = now()
    WHERE "key" = 'tasks.nextNumber'
    RETURNING (("value" #>> '{}')::int - 1) AS n`;
  if (rows[0]) return Number(rows[0].n);
  const max = await tx.task.aggregate({ _max: { number: true } });
  const n = Math.max(52, (max._max.number ?? 0) + 1);
  await tx.setting.create({ data: { key: "tasks.nextNumber", value: n + 1 } });
  return n;
}

export async function createTask(actor: Actor, input: NewTaskInput): Promise<TaskResult> {
  const viewer = viewerOf(actor);
  if (viewer.observer) fail("Наблюдатель задачи не ставит");
  const title = required(input.title, LIMITS.title, "Напишите задачу одной мыслью", "Задача");
  const outcome = required(input.outcome, LIMITS.outcome, "Напишите, по чему понять, что задача сделана", "Что нужно сделать");
  if (!isIsoDate(input.due)) fail("Укажите срок");
  if (input.due < moscowToday()) fail("Срок не может быть в прошлом");
  const sourceNote = optional(input.sourceNote, LIMITS.sourceNote, "Подробнее об источнике");

  return prisma.$transaction(async (tx) => {
    const people = await peopleBySlug(tx);
    let ownerId: string | null = null;
    if (input.owner !== "all") {
      const p = people.get(input.owner);
      if (!p) fail("Такого ответственного нет в команде");
      ownerId = p!.id;
    }
    const direction = await tx.dictionaryItem.findFirst({ where: { kind: "DIRECTION", code: input.direction, active: true } });
    if (!direction) fail("Выберите направление из списка");
    const sourceCode = input.source ?? "other";
    const source = await tx.dictionaryItem.findFirst({ where: { kind: "TASK_SOURCE", code: sourceCode, active: true } });
    if (!source) fail("Выберите источник из списка");
    const priority: TaskPriority = input.priority && input.priority !== "unset" ? (priorityDb(input.priority) ?? fail("Нет такого приоритета")) : "MEDIUM";
    const co = [...new Set(input.coExecutors ?? [])].filter((s) => s !== input.owner);
    const coIds = co.map((s) => people.get(s)?.id ?? fail("Такого соисполнителя нет в команде"));
    const links = (input.links ?? []).map((l) => ({ title: optional(l.title, LIMITS.linkTitle, "Название ссылки") ?? new URL(checkUrl(l.url)).hostname, url: checkUrl(l.url) }));

    if (input.weeklyEntryId) {
      const entry = await tx.weeklyEntry.findUnique({ where: { id: input.weeklyEntryId }, select: { id: true } });
      if (!entry) fail("Запись weekly, из которой делается задача, не найдена");
    }
    const status = newTaskStatus(input.owner, viewer);
    const number = await nextNumber(tx);
    const today = dbDate(moscowToday());
    const row = await tx.task.create({
      data: {
        number,
        title,
        outcome,
        ownerId,
        ownerAll: input.owner === "all",
        directionId: direction!.id,
        priority,
        status: statusDb(status)!,
        state: "ON_TRACK",
        whereUpdatedAt: today,
        due: dbDate(input.due),
        originalDue: dbDate(input.due),
        sourceCode,
        sourceNote,
        sourceDate: sourceCode === "meeting" ? today : null,
        createdById: actor.personId,
        weeklyEntryId: input.weeklyEntryId ?? null,
        coExecutors: { create: coIds.map((personId) => ({ personId })) },
        links: { create: links.map((l) => ({ ...l, addedById: actor.personId })) },
      },
      include: taskInclude,
    });
    const names = await nameMap(tx);
    await audit(tx, actor, number, [
      {
        action: status === "proposed" ? "task.propose" : "task.create",
        field: status === "proposed" ? "Задача предложена" : "Задача создана",
        after: `${title}. Ответственный: ${ownerLabel(row, names)}, срок ${formatLong(input.due)}`,
      },
    ]);
    return { task: toTaskDto(row), undo: issueUndoToken({ kind: "create", number }, actor.personId) };
  });
}

// ---------- Правки ----------

export async function changeStatus(actor: Actor, number: number, next: StatusCode, note?: string): Promise<TaskResult> {
  return mutate(actor, number, async (row, can) => {
    const current = statusCode(row.status);
    if (current === "proposed" ? !can.confirm : !can.status) {
      fail(current === "proposed" ? "Предложенную задачу подтверждает владелец или администратор" : "Статус меняет ответственный, владелец или администратор");
    }
    if (next === current) fail("Статус уже такой");
    if (next === "proposed") fail("В «Предложена» задачу переносит только система");
    const db = statusDb(next) ?? fail("Нет такого статуса");
    const need = statusNeedsNote(next);
    let resolution: string | null = null;
    if (need) {
      resolution = required(
        note,
        LIMITS.note,
        need === "result" ? "Нужен короткий итог или ссылка на результат" : "Без причины так закрыть задачу нельзя",
        need === "result" ? "Итог" : "Причина",
      );
    }
    const closing = CLOSED_DB.includes(db);
    return {
      data: { status: db, resolution: closing ? resolution : null, closedAt: closing ? new Date() : null },
      changes: [{ field: "Статус", before: statusOf(current).label, after: resolution ? `${statusOf(next).label}. ${resolution}` : statusOf(next).label }],
    };
  });
}

export async function changeState(actor: Actor, number: number, next: StateCode, blockedBy?: string): Promise<TaskResult> {
  return mutate(actor, number, async (row, can) => {
    if (!can.state) fail("Состояние меняет ответственный, владелец или администратор");
    if (next === "unset") fail("Выберите состояние");
    const db: TaskState = stateDb(next) ?? fail("Нет такого состояния");
    const reason = db === "BLOCKED" ? required(blockedBy, LIMITS.reason, "Напишите, чем заблокирована задача и кто может помочь", "Чем заблокирована") : null;
    if (db === row.state && reason === row.blockedBy) fail("Состояние уже такое");
    return {
      data: { state: db, blockedBy: reason },
      changes: [{ field: "Состояние", before: stateLabel(stateCode(row.state)), after: reason ? `${stateLabel(next)}. ${reason}` : stateLabel(next) }],
    };
  });
}

export async function changePriority(actor: Actor, number: number, next: PriorityCode): Promise<TaskResult> {
  return mutate(actor, number, async (row, can) => {
    if (!can.priority) fail("Приоритет меняет тот, кто поставил задачу, владелец или администратор");
    if (next === "unset") fail("Выберите приоритет");
    const db: TaskPriority = priorityDb(next) ?? fail("Нет такого приоритета");
    if (db === row.priority) fail("Приоритет уже такой");
    return { data: { priority: db }, changes: [{ field: "Приоритет", before: priorityOf(priorityCode(row.priority)).label, after: priorityOf(next).label }] };
  });
}

export async function updateWhere(actor: Actor, number: number, text: string): Promise<TaskResult> {
  return mutate(actor, number, async (row, can) => {
    if (!can.where) fail("«Где сейчас» пишут ответственный и соисполнители");
    const value = required(text, LIMITS.where, "Напишите одну-две фразы о том, где задача сейчас", "Где сейчас");
    if (value === row.whereNow) fail("Текст не изменился");
    return {
      data: { whereNow: value, whereUpdatedAt: dbDate(moscowToday()) },
      changes: [{ field: "Где сейчас", before: row.whereNow || null, after: value }],
    };
  });
}

export async function transferDue(actor: Actor, number: number, to: IsoDate, reason: string): Promise<TaskResult> {
  const transferId = `tr_${crypto.randomUUID()}`;
  return mutate(actor, number, async (row, can, tx) => {
    if (!can.due) fail("Срок переносит ответственный, владелец или администратор");
    if (CLOSED_DB.includes(row.status)) fail("Закрытой задаче срок не переносят");
    if (!isIsoDate(to)) fail("Выберите новый срок");
    const from = isoFromDbDate(row.due);
    if (to === from) fail("Выберите новый срок");
    if (to < moscowToday()) fail("Новый срок не может быть в прошлом");
    const why = required(reason, LIMITS.reason, "Без причины перенести нельзя", "Причина переноса");
    await tx.taskTransfer.create({ data: { id: transferId, taskId: row.id, fromDue: row.due, toDue: dbDate(to), reason: why, byId: actor.personId, at: new Date() } });
    return {
      data: { due: dbDate(to) },
      changes: [{ field: "Срок", before: formatLong(from), after: `${formatLong(to)}. Причина: ${why}` }],
      undo: { removeTransferId: transferId },
    };
  });
}

export type EditInput = { title?: string; outcome?: string; direction?: string; source?: string; sourceNote?: string | null };

export async function editTask(actor: Actor, number: number, input: EditInput): Promise<TaskResult> {
  return mutate(actor, number, async (row, can, tx) => {
    if (!can.edit) fail("Задачу правит тот, кто её поставил, владелец или администратор");
    const data: Prisma.TaskUncheckedUpdateInput = {};
    const changes: Change[] = [];
    if (input.title !== undefined) {
      const v = required(input.title, LIMITS.title, "Напишите задачу одной мыслью", "Задача");
      if (v !== row.title) {
        data.title = v;
        changes.push({ field: "Задача", before: row.title, after: v });
      }
    }
    if (input.outcome !== undefined) {
      const v = required(input.outcome, LIMITS.outcome, "Напишите, по чему понять, что задача сделана", "Что нужно сделать");
      if (v !== row.outcome) {
        data.outcome = v;
        changes.push({ field: "Что нужно сделать", before: row.outcome, after: v });
      }
    }
    if (input.direction !== undefined && input.direction !== row.direction.code) {
      const d = await tx.dictionaryItem.findFirst({ where: { kind: "DIRECTION", code: input.direction, active: true } });
      if (!d) fail("Выберите направление из списка");
      const old = await tx.dictionaryItem.findUnique({ where: { id: row.directionId } });
      data.directionId = d!.id;
      changes.push({ field: "Направление", before: old?.label, after: d!.label });
    }
    if (input.source !== undefined && input.source !== row.sourceCode) {
      const s = await tx.dictionaryItem.findFirst({ where: { kind: "TASK_SOURCE", code: input.source, active: true } });
      if (!s) fail("Выберите источник из списка");
      data.sourceCode = input.source;
      changes.push({ field: "Источник", before: sourceLabel(row.sourceCode as never), after: s!.label });
    }
    if (input.sourceNote !== undefined) {
      const v = optional(input.sourceNote, LIMITS.sourceNote, "Подробнее об источнике");
      if (v !== row.sourceNote) {
        data.sourceNote = v;
        changes.push({ field: "Подробнее об источнике", before: row.sourceNote, after: v });
      }
    }
    return { data, changes };
  });
}

export async function assignOwner(actor: Actor, number: number, owner: Owner): Promise<TaskResult> {
  return mutate(actor, number, async (row, can, tx) => {
    if (!can.owner) fail("Ответственного меняют владелец или администратор");
    const names = await nameMap(tx);
    const before = ownerLabel(row, names);
    if (owner === ownerOf(row)) fail("Ответственный уже этот");
    let ownerId: string | null = null;
    if (owner !== "all") {
      const p = (await peopleBySlug(tx)).get(owner);
      if (!p) fail("Такого ответственного нет в команде");
      ownerId = p!.id;
      // Ответственный не бывает своим же соисполнителем
      await tx.taskCoExecutor.deleteMany({ where: { taskId: row.id, personId: ownerId } });
    }
    return {
      data: { ownerId, ownerAll: owner === "all" },
      changes: [{ field: "Ответственный", before, after: owner === "all" ? "Все лидеры" : (names.get(owner) ?? owner) }],
      undo: false,
    };
  });
}

export async function setCoExecutors(actor: Actor, number: number, slugs: PersonSlug[]): Promise<TaskResult> {
  return mutate(actor, number, async (row, can, tx) => {
    if (!can.coExecutors) fail("Соисполнителей назначают ответственный, владелец или администратор");
    const people = await peopleBySlug(tx);
    const owner = ownerOf(row);
    const wanted = [...new Set(slugs)].filter((s) => s !== owner);
    const ids = wanted.map((s) => people.get(s)?.id ?? fail("Такого соисполнителя нет в команде"));
    const names = await nameMap(tx);
    const before = row.coExecutors.map((c) => names.get(c.person.slug) ?? c.person.slug).join(", ");
    const after = wanted.map((s) => names.get(s) ?? s).join(", ");
    if (before === after) fail("Соисполнители не изменились");
    await tx.taskCoExecutor.deleteMany({ where: { taskId: row.id } });
    if (ids.length) await tx.taskCoExecutor.createMany({ data: ids.map((personId) => ({ taskId: row.id, personId })) });
    return { data: { updatedAt: new Date() }, changes: [{ field: "Соисполнители", before: before || "нет", after: after || "нет" }], undo: false };
  });
}

export async function addLink(actor: Actor, number: number, link: { title?: string; url: string }): Promise<TaskResult> {
  const linkId = `ln_${crypto.randomUUID()}`;
  return mutate(actor, number, async (row, can, tx) => {
    if (!can.links) fail("Ссылки добавляют участники задачи");
    const url = checkUrl(link.url);
    const title = optional(link.title, LIMITS.linkTitle, "Название ссылки") ?? new URL(url).hostname;
    if (row.links.some((l) => l.url === url)) fail("Такая ссылка уже есть");
    await tx.taskLink.create({ data: { id: linkId, taskId: row.id, title, url, addedById: actor.personId } });
    return { data: { updatedAt: new Date() }, changes: [{ field: "Ссылка", after: `${title}: ${url}` }], undo: { removeLinkId: linkId } };
  });
}

export async function removeLink(actor: Actor, number: number, linkId: string): Promise<TaskResult> {
  return mutate(actor, number, async (row, can, tx) => {
    if (!can.links) fail("Ссылки убирают участники задачи");
    const link = row.links.find((l) => l.id === linkId) ?? fail("Такой ссылки у задачи нет");
    await tx.taskLink.delete({ where: { id: link.id } });
    return { data: { updatedAt: new Date() }, changes: [{ field: "Ссылка убрана", before: `${link.title}: ${link.url}` }], undo: false };
  });
}

export async function archiveTask(actor: Actor, number: number, archived = true): Promise<TaskResult> {
  return mutate(actor, number, async (row, can) => {
    if (!can.archive) fail("В архив задачу отправляет только владелец в режиме управления");
    if (archived === (row.archivedAt !== null)) fail(archived ? "Задача уже в архиве" : "Задача не в архиве");
    return {
      data: { archivedAt: archived ? new Date() : null },
      changes: [{ action: archived ? "task.archive" : "task.restore", field: archived ? "Задача в архиве" : "Задача из архива", after: row.title }],
    };
  });
}

export async function addComment(actor: Actor, number: number, text: string): Promise<TaskResult> {
  const viewer = viewerOf(actor);
  if (viewer.observer) fail("Наблюдатель не комментирует");
  const value = required(text, LIMITS.comment, "Напишите комментарий", "Комментарий");
  return prisma.$transaction(async (tx) => {
    const row = await lockRow(tx, number);
    const comment = await tx.taskComment.create({ data: { taskId: row.id, authorId: actor.personId, text: value } });
    await audit(tx, actor, number, [{ action: "task.comment", field: "Комментарий", after: value }]);
    const updated = await tx.task.findUniqueOrThrow({ where: { id: row.id }, include: taskInclude });
    return { task: toTaskDto(updated), undo: issueUndoToken({ kind: "comment", number, commentId: comment.id }, actor.personId) };
  });
}

// ---------- Отмена ----------

/** null в ответе: задачу отменили целиком (отмена создания) */
export async function undoChange(actor: Actor, token: string): Promise<{ task: Task | null; number: number }> {
  const spec = readUndoToken(token, actor.personId);
  if (!spec) fail("Отменить уже нельзя: прошло больше минуты");
  const s = spec!;
  return prisma.$transaction(async (tx) => {
    const row = await lockRow(tx, s.number);
    if (s.kind === "create") {
      if (row.createdById !== actor.personId) fail("Отменить создание может только тот, кто создал задачу");
      if (row.comments.length || row.transfers.length) fail("По задаче уже работают: создание не отменить, можно отменить задачу статусом");
      await tx.task.delete({ where: { id: row.id } });
      await audit(tx, actor, s.number, [{ action: "task.undo", field: "Создание отменено", before: row.title }]);
      return { task: null, number: s.number };
    }
    if (s.kind === "comment") {
      const comment = row.comments.find((c) => c.id === s.commentId);
      if (!comment) fail("Комментарий уже убран");
      await tx.taskComment.delete({ where: { id: comment!.id } });
      await audit(tx, actor, s.number, [{ action: "task.undo", field: "Комментарий отменён", before: comment!.text }]);
      const updated = await tx.task.findUniqueOrThrow({ where: { id: row.id }, include: taskInclude });
      return { task: toTaskDto(updated), number: s.number };
    }
    // Возвращаем поля, только если с тех пор задачу никто не трогал: чужую правку отмена не затирает
    if (row.updatedAt.toISOString() !== s.expectUpdatedAt) fail("Задачу уже изменили после этого: отменить нельзя");
    const b = s.snapshot;
    if (s.removeTransferId) await tx.taskTransfer.deleteMany({ where: { id: s.removeTransferId, taskId: row.id } });
    if (s.removeLinkId) await tx.taskLink.deleteMany({ where: { id: s.removeLinkId, taskId: row.id } });
    const updated = await tx.task.update({
      where: { id: row.id },
      data: {
        title: b.title,
        outcome: b.outcome,
        directionId: b.directionId,
        sourceCode: b.sourceCode,
        sourceNote: b.sourceNote,
        status: b.status as TaskStatus,
        resolution: b.resolution,
        closedAt: b.closedAt ? new Date(b.closedAt) : null,
        state: b.state as TaskState | null,
        blockedBy: b.blockedBy,
        priority: b.priority as TaskPriority | null,
        whereNow: b.whereNow,
        whereUpdatedAt: dbDate(b.whereUpdatedAt),
        due: dbDate(b.due),
        archivedAt: b.archivedAt ? new Date(b.archivedAt) : null,
      },
      include: taskInclude,
    });
    await audit(tx, actor, s.number, [{ action: "task.undo", field: "Последнее действие отменено" }]);
    return { task: toTaskDto(updated), number: s.number };
  });
}

/** Человек из базы в роли действующего лица: для скриптов и тестов */
export async function actorFor(slug: string, management: ManagementRole | null = null): Promise<Actor> {
  const p = await prisma.person.findUniqueOrThrow({ where: { slug } });
  return { personId: p.id, slug: p.slug as PersonSlug, fullName: p.fullName, role: p.role, management };
}

export { personName };
