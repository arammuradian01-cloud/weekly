// Задачи на сервере (раздел 4 ТЗ). Каждое действие проверяет права по матрице раздела 2,
// меняет задачу в одной транзакции и пишет в журнал, что было и что стало.

import { prisma } from "@/lib/db";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { LoginMethod, Role, TaskPriority, TaskState, TaskStatus } from "@/generated/prisma/enums";
import { priorityOf, stateLabel, statusOf, type PriorityCode, type StateCode, type StatusCode } from "@/domain/dictionaries";
import { formatLong, type IsoDate } from "@/domain/dates";
import type { HistoryItem, Owner, PersonSlug, Task } from "@/domain/types";
import { newTaskStatus, permissions, statusNeedsNote, type ManagementRole, type TaskPermissions, type Viewer } from "./rules";
import { CLOSED_DB, priorityCode, priorityDb, stateCode, stateDb, statusCode, statusDb } from "./codes";
import { dbDate, isIsoDate, isoFromDbDate, moscowIso, moscowTime, moscowToday } from "./dates";
import { ownerOf, taskInclude, taskListInclude, toTaskDto, type TaskRow } from "./dto";
import { issueUndoToken, readUndoToken, type TaskSnapshot, type UndoSpec } from "./undo";
import { notify, quote, taskSubject } from "@/lib/inbox/notify";
import { notifyWatchers } from "./watch";
import { REACTION_LABEL, editable, mentionsIn, namesOf } from "@/lib/discuss/common";
import { taskReaders } from "@/lib/discuss/access";
import { applyReaction, dropReactionEvent } from "@/lib/discuss/reactions";
import { TOP_TEAM, loadScope, visibleTasksWhere, type Scope } from "@/lib/org/scope";

export const LIMITS = { title: 120, outcome: 1000, where: 500, note: 1000, reason: 500, comment: 2000, linkTitle: 120, url: 500, sourceNote: 200 };

/** Кто действует: профиль, роль и включённый режим управления */
export type Actor = {
  personId: string;
  slug: PersonSlug;
  fullName: string;
  role: Role;
  management: ManagementRole | null;
  ip?: string | null;
  /** Как вошёл: общий логин или личная ссылка. Пишется в журнал рядом с автором (этап 9) */
  via?: LoginMethod | null;
};

/** Ошибка правила: текст показывается человеку как есть */
export class TaskRuleError extends Error {}

/** warning: правка прошла, но человеку есть что сказать, например упоминание не дошло (этап 20) */
export type TaskResult = { task: Task; undo?: string; warning?: string };

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

/** Слаги людей по id: для прав, которые считаются по слагам */
async function slugsOf(db: Db, ids: string[]): Promise<PersonSlug[]> {
  if (!ids.length) return [];
  return (await db.person.findMany({ where: { id: { in: ids } }, select: { slug: true } })).map((p) => p.slug as PersonSlug);
}

function viewerOf(actor: Actor, scope?: Scope): Viewer {
  return { slug: actor.slug, management: actor.management, observer: actor.role === "OBSERVER", leads: scope?.leads ?? [], employee: actor.role === "EMPLOYEE" };
}

async function scopeOfActor(db: Db, actor: Actor): Promise<Scope> {
  // Общий логин без режима управления видит только топ-команду и ничем не руководит (этап 14)
  return loadScope(db, { id: actor.personId, role: actor.role, limited: actor.via === "TEAM" && !actor.management });
}

/** Видит ли человек задачу: её команда в его командах, или он участник задачи, или он функциональный руководитель ответственного */
export function canSeeRow(scope: Scope, row: Pick<TaskRow, "teamId" | "ownerId" | "createdById"> & { coExecutors: { personId: string }[] }, personId: string): boolean {
  if (scope.all || scope.visible.includes(row.teamId)) return true;
  if (row.ownerId === personId || row.createdById === personId) return true;
  if (row.coExecutors.some((c) => c.personId === personId)) return true;
  // Этап 16: руководитель видит задачи своих людей в любой команде, в том числе предложенные им из другой команды
  return !!row.ownerId && (scope.functional.includes(row.ownerId) || (row.teamId !== TOP_TEAM && scope.leadPeople.includes(row.ownerId)));
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
  // Ответственными и соисполнителями бывают только включённые люди; наблюдатель задач не ведёт
  const people = await db.person.findMany({ where: { active: true, role: { not: "OBSERVER" } } });
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

async function lockRow(tx: Tx, number: number, scope?: { scope: Scope; personId: string }): Promise<TaskRow> {
  // Блокировка строки: два человека не перепишут одну задачу одновременно
  await tx.$queryRaw`SELECT id FROM "tasks" WHERE "number" = ${number} FOR UPDATE`;
  const row = await tx.task.findUnique({ where: { number }, include: taskInclude });
  if (!row) fail(`Задачи ${number} нет`);
  // Чужая команда: задачу не видно, поэтому и номер не подтверждаем
  if (scope && !canSeeRow(scope.scope, row!, scope.personId)) fail(`Задачи ${number} нет`);
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
      via: actor.via ?? null,
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
    const scope = await scopeOfActor(tx, actor);
    const row = await lockRow(tx, number, { scope, personId: actor.personId });
    if (row.archivedAt && actor.management !== "OWNER") fail(`Задача ${number} в архиве`);
    const can = permissions(toTaskDto(row), { ...viewerOf(actor, scope), people: await slugsOf(tx, scope.leadPeople) });
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

/** Кто читает задачи. limited: общий логин без режима управления, видит только топ-команду */
export type TaskReader = { personId: string; role: Role; limited?: boolean };

/**
 * Задачи для экранов. reader: только то, что человек видит (этап 14). team: задачи этой команды
 * и свои задачи в любой команде, чтобы «Мои задачи» и «Моя неделя» были полными
 */
export async function listTasks(opts: { archived?: boolean; reader?: TaskReader; team?: string } = {}): Promise<Task[]> {
  const and: Prisma.TaskWhereInput[] = [opts.archived ? {} : { archivedAt: null }];
  if (opts.reader) {
    const scope = await loadScope(prisma, { id: opts.reader.personId, role: opts.reader.role, limited: opts.reader.limited });
    and.push(visibleTasksWhere(scope, opts.reader.personId));
    if (opts.team) {
      const me = opts.reader.personId;
      // И просьбы к людям команды из других команд (этап 16): предложенные им задачи
      const team = await prisma.team.findUnique({ where: { id: opts.team }, include: { members: { select: { personId: true } } } });
      const people = team ? [...(team.leaderId ? [team.leaderId] : []), ...team.members.map((m) => m.personId)] : [];
      and.push({
        OR: [
          { teamId: opts.team },
          { ownerId: me },
          { createdById: me },
          { coExecutors: { some: { personId: me } } },
          ...(people.length && opts.team !== TOP_TEAM ? [{ status: "PROPOSED" as const, ownerId: { in: people } }] : []),
        ],
      });
    }
  } else if (opts.team) {
    and.push({ teamId: opts.team });
  }
  // Текст комментариев нужен только по своим задачам («Моя неделя»): у остальных приходит их число,
  // карточка дозагружает задачу целиком при открытии. Так список из сотен задач остаётся лёгким
  const rows = await prisma.task.findMany({ where: { AND: and }, include: taskListInclude, orderBy: { number: "asc" } });
  const me = opts.reader?.personId;
  const own = rows.filter((r) => !me || r.ownerId === me || r.createdById === me || r.coExecutors.some((c) => c.personId === me) || r._count.comments <= 3);
  const comments = own.length
    ? await prisma.taskComment.findMany({ where: { taskId: { in: own.map((r) => r.id) } }, orderBy: { at: "asc" }, include: taskInclude.comments.include })
    : [];
  const byTask = new Map<string, typeof comments>();
  for (const c of comments) byTask.set(c.taskId, [...(byTask.get(c.taskId) ?? []), c]);
  const withComments = new Set(own.map((r) => r.id));
  return rows.map((r) => {
    const { _count, ...rest } = r;
    const dto = toTaskDto({ ...rest, comments: byTask.get(r.id) ?? [] });
    return withComments.has(r.id) ? dto : { ...dto, partial: true, commentCount: _count.comments };
  });
}

/** Одна задача. reader: null, если человек её не видит */
export async function getTask(number: number, reader?: TaskReader): Promise<Task | null> {
  const row = await prisma.task.findUnique({ where: { number }, include: taskInclude });
  if (!row) return null;
  if (reader) {
    const scope = await loadScope(prisma, { id: reader.personId, role: reader.role, limited: reader.limited });
    if (!canSeeRow(scope, row, reader.personId)) return null;
  }
  return toTaskDto(row);
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
  /** Команда задачи (этап 14). Не задана: топ-команда, если человек в ней, иначе первая его команда */
  team?: string;
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
  if (actor.role === "OBSERVER") fail("Наблюдатель задачи не ставит");
  const title = required(input.title, LIMITS.title, "Напишите задачу одной мыслью", "Задача");
  const outcome = required(input.outcome, LIMITS.outcome, "Напишите, по чему понять, что задача сделана", "Что нужно сделать");
  if (!isIsoDate(input.due)) fail("Укажите срок");
  if (input.due < moscowToday()) fail("Срок не может быть в прошлом");
  const sourceNote = optional(input.sourceNote, LIMITS.sourceNote, "Подробнее об источнике");

  return prisma.$transaction(async (tx) => {
    const scope = await scopeOfActor(tx, actor);
    const viewer = viewerOf(actor, scope);
    const teamId = pickTeam(scope, actor, input.team);
    const team = await tx.team.findUnique({ where: { id: teamId }, select: { active: true } });
    if (!team?.active) fail("Команда выключена: задачу в неё не поставить");
    if (input.owner === "all" && teamId !== TOP_TEAM) fail("«Все лидеры» бывают только у задач топ-команды");
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
    let status = newTaskStatus(input.owner, viewer, teamId);
    // Руководитель команды ставит сразу «В работе» только людям своих команд. Остальным задачу можно только предложить
    if (status === "in-progress" && !actor.management && ownerId && ownerId !== actor.personId && !scope.leadPeople.includes(ownerId)) status = "proposed";
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
        teamId,
        coExecutors: { create: coIds.map((personId) => ({ personId })) },
        links: { create: links.map((l) => ({ ...l, addedById: actor.personId })) },
      },
      include: taskInclude,
    });
    // «Мне»: ответственному поставили или предложили задачу, соисполнителей добавили
    const subject = taskSubject(number);
    await notify(tx, {
      kind: status === "proposed" ? "TASK_PROPOSED" : "TASK_ASSIGNED",
      recipients: [ownerId],
      actor,
      subject,
      taskId: row.id,
      text: status === "proposed" ? (teamId === TOP_TEAM ? "Вам предложена задача, её подтвердит владелец или администратор" : "Вам предложена задача, её подтвердит руководитель команды") : "Новая задача для вас",
    });
    await notify(tx, { kind: "TASK_COEXECUTOR", recipients: coIds, actor, subject, taskId: row.id, text: "Вы соисполнитель" });
    const names = await nameMap(tx);
    await audit(tx, actor, number, [
      {
        action: status === "proposed" ? "task.propose" : "task.create",
        field: status === "proposed" ? "Задача предложена" : "Задача создана",
        after: `${title}. Ответственный: ${ownerLabel(row, names)}, срок ${formatLong(input.due)}`,
      },
    ]);
    return { task: toTaskDto(row), undo: issueUndoToken({ kind: "create", number, expectUpdatedAt: row.updatedAt.toISOString() }, actor.personId) };
  });
}

/**
 * В какую команду ставится задача. Ставить можно в свои команды и в команды, которыми руководишь;
 * владелец и администраторы в режиме управления: в любую
 */
function pickTeam(scope: Scope, actor: Actor, wanted: string | undefined): string {
  const own = [...new Set([...scope.member, ...scope.leads])];
  if (!wanted) {
    if (own.includes(TOP_TEAM) || (actor.management && scope.all)) return TOP_TEAM;
    return own[0] ?? fail("Вас ещё не добавили ни в одну команду: задачу поставить некуда");
  }
  if (own.includes(wanted)) return wanted;
  if (actor.management && scope.visible.includes(wanted)) return wanted;
  return fail("В эту команду задачу поставить нельзя: вы в ней не состоите");
}

// ---------- Правки ----------

export async function changeStatus(actor: Actor, number: number, next: StatusCode, note?: string): Promise<TaskResult> {
  return mutate(actor, number, async (row, can, tx) => {
    const current = statusCode(row.status);
    if (current === "proposed" ? !can.confirm : !can.status) {
      fail(
        current === "proposed"
          ? row.teamId === TOP_TEAM
            ? "Предложенную задачу подтверждает владелец или администратор"
            : "Предложенную задачу подтверждает адресат, его руководитель или руководитель команды"
          : "Статус меняет ответственный, владелец или администратор",
      );
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
    await notifyWatchers(tx, row.id, `Статус: ${statusOf(next).label}${resolution ? `. ${quote(resolution)}` : ""}`, actor);
    // Предложенную задачу подтвердили: ответственный и тот, кто предлагал, узнают об этом в «Мне»
    if (current === "proposed") {
      // Адресат или его руководитель решают только «принять» или «отклонить»; остальные статусы у режима управления
      // и руководителя команды задачи (этап 16)
      if (!can.status && next !== "in-progress" && next !== "cancelled") fail("Предложенную задачу можно принять в работу или отклонить с причиной");
      const declined = next === "cancelled";
      await notify(tx, {
        kind: "TASK_CONFIRMED",
        recipients: declined ? [row.createdById, row.ownerId] : [row.ownerId, row.createdById],
        actor,
        subject: taskSubject(number),
        taskId: row.id,
        text: declined ? `Предложение отклонено: ${quote(resolution ?? "")}` : "Задача подтверждена",
      });
    }
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
    // Срок моей задачи перенёс кто-то другой: ответственный должен об этом знать
    await notify(tx, { kind: "TASK_DUE", recipients: [row.ownerId], actor, subject: taskSubject(number), taskId: row.id, text: `Срок перенесён на ${formatLong(to)}: ${quote(why)}` });
    await notifyWatchers(tx, row.id, `Срок перенесён на ${formatLong(to)}: ${quote(why)}`, actor, [row.ownerId]);
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
      const old = await tx.dictionaryItem.findFirst({ where: { kind: "TASK_SOURCE", code: row.sourceCode } });
      data.sourceCode = input.source;
      changes.push({ field: "Источник", before: old?.label ?? row.sourceCode, after: s!.label });
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
    if (owner === "all" && row.teamId !== TOP_TEAM) fail("«Все лидеры» бывают только у задач топ-команды");
    let ownerId: string | null = null;
    if (owner !== "all") {
      const p = (await peopleBySlug(tx)).get(owner);
      if (!p) fail("Такого ответственного нет в команде");
      ownerId = p!.id;
    }
    // Руководитель команды без режима управления передаёт задачу только людям своих команд
    if (!actor.management && ownerId && ownerId !== actor.personId) {
      const scope = await scopeOfActor(tx, actor);
      if (!scope.leadPeople.includes(ownerId)) fail("Передать задачу можно человеку из ваших команд. Другим её можно предложить новой задачей");
    }
    const changes: Change[] = [{ field: "Ответственный", before, after: owner === "all" ? "Все лидеры" : (names.get(owner) ?? owner) }];
    await notify(tx, { kind: "TASK_ASSIGNED", recipients: [ownerId], actor, subject: taskSubject(number), taskId: row.id, text: "Задача передана вам" });
    // Ответственный не бывает своим же соисполнителем: если он им был, это тоже правка и она в журнале
    if (ownerId && row.coExecutors.some((c) => c.person.slug === owner)) {
      await tx.taskCoExecutor.deleteMany({ where: { taskId: row.id, personId: ownerId } });
      const list = (slugs: string[]) => slugs.map((x) => names.get(x) ?? x).join(", ") || "нет";
      const co = row.coExecutors.map((c) => c.person.slug);
      changes.push({ field: "Соисполнители", before: list(co), after: list(co.filter((x) => x !== owner)) });
    }
    return { data: { ownerId, ownerAll: owner === "all" }, changes, undo: false };
  });
}

export async function setCoExecutors(actor: Actor, number: number, slugs: PersonSlug[]): Promise<TaskResult> {
  return mutate(actor, number, async (row, can, tx) => {
    if (!can.coExecutors) fail("Соисполнителей назначают ответственный, владелец или администратор");
    const people = await peopleBySlug(tx);
    const owner = ownerOf(row);
    const wanted = [...new Set(slugs)].filter((s) => s !== owner);
    // Уже назначенного оставить можно, даже если его выключили: иначе задачу не отредактировать
    const current = new Map(row.coExecutors.map((c) => [c.person.slug, c.personId]));
    const ids = wanted.map((s) => people.get(s)?.id ?? current.get(s) ?? fail("Такого соисполнителя нет в команде"));
    // Руководитель команды (не ответственный и без режима управления) зовёт соисполнителей только из своих команд
    if (!actor.management && row.ownerId !== actor.personId) {
      const scope = await scopeOfActor(tx, actor);
      const already = new Set(row.coExecutors.map((c) => c.personId));
      const outside = ids.filter((id) => !already.has(id) && !scope.leadPeople.includes(id) && id !== actor.personId);
      if (outside.length) fail("Соисполнителями руководитель команды зовёт людей своих команд");
    }
    const names = await nameMap(tx);
    const before = row.coExecutors.map((c) => names.get(c.person.slug) ?? c.person.slug).join(", ");
    const after = wanted.map((s) => names.get(s) ?? s).join(", ");
    if (before === after) fail("Соисполнители не изменились");
    await tx.taskCoExecutor.deleteMany({ where: { taskId: row.id } });
    if (ids.length) await tx.taskCoExecutor.createMany({ data: ids.map((personId) => ({ taskId: row.id, personId })) });
    const added = ids.filter((id) => !row.coExecutors.some((c) => c.personId === id));
    await notify(tx, { kind: "TASK_COEXECUTOR", recipients: added, actor, subject: taskSubject(number), taskId: row.id, text: "Вы соисполнитель" });
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
      changes: [{ action: archived ? "task.archive" : "task.restore", field: `Архив: ${row.title}`, before: archived ? "в работе" : "в архиве", after: archived ? "в архиве" : "в работе" }],
    };
  });
}

export async function addComment(actor: Actor, number: number, text: string): Promise<TaskResult> {
  if (actor.role === "OBSERVER") fail("Наблюдатель не комментирует");
  const value = required(text, LIMITS.comment, "Напишите комментарий", "Комментарий");
  return prisma.$transaction(async (tx) => {
    const scope = await scopeOfActor(tx, actor);
    const row = await lockRow(tx, number, { scope, personId: actor.personId });
    if (row.archivedAt && actor.management !== "OWNER") fail(`Задача ${number} в архиве`);
    // Функциональный руководитель задачи своих людей только смотрит
    const participant = row.ownerId === actor.personId || row.createdById === actor.personId || row.coExecutors.some((c) => c.personId === actor.personId);
    // Руководитель ответственного комментирует задачу своего человека и в чужой команде, например, просьбу к нему (этап 16)
    const ownersLeader = !!row.ownerId && scope.leadPeople.includes(row.ownerId) && row.teamId !== TOP_TEAM;
    if (!scope.all && !scope.visible.includes(row.teamId) && !participant && !ownersLeader) fail("Функциональный руководитель видит задачу, но не комментирует её");
    // Упоминания (этап 20): доходят только до тех, кто видит задачу
    const mentioned = await mentionsIn(tx, [value], actor.personId);
    const reach = mentioned.length ? await taskReaders(tx, row, mentioned) : [];
    const comment = await tx.taskComment.create({ data: { taskId: row.id, authorId: actor.personId, text: value, mentions: reach } });
    const participants = [row.ownerId, row.createdById, ...row.coExecutors.map((c) => c.personId)];
    await mentionTask(tx, actor, row, comment.id, reach, participants, value);
    // Комментарий видят в «Мне» ответственный, соисполнители и тот, кто поставил задачу. Упомянутые получают упоминание
    await notify(tx, {
      kind: "TASK_COMMENT",
      recipients: participants.filter((id) => !id || !reach.includes(id)),
      actor,
      subject: taskSubject(number),
      taskId: row.id,
      commentId: comment.id,
      text: `Комментарий: «${quote(value)}»`,
    });
    // Подписчики задачи (этап 16) тоже видят комментарии
    await notifyWatchers(tx, row.id, `Комментарий: «${quote(value)}»`, actor, [...participants, ...reach]);
    await audit(tx, actor, number, [{ action: "task.comment", field: "Комментарий", after: value }]);
    const updated = await tx.task.findUniqueOrThrow({ where: { id: row.id }, include: taskInclude });
    return {
      task: toTaskDto(updated),
      undo: issueUndoToken({ kind: "comment", number, commentId: comment.id }, actor.personId),
      ...(await unreachedWarning(tx, mentioned, reach, "эту задачу")),
    };
  });
}

/** Событие упомянутым и подписка на задачу: упомянутый дальше видит её изменения в «Мне» (этап 20) */
async function mentionTask(tx: Tx, actor: Actor, row: TaskRow, commentId: string, reach: string[], participants: (string | null)[], text: string) {
  if (!reach.length) return;
  const watchers = reach.filter((id) => !participants.includes(id));
  if (watchers.length) await tx.taskWatch.createMany({ data: watchers.map((personId) => ({ taskId: row.id, personId })), skipDuplicates: true });
  await notify(tx, { kind: "MENTION", recipients: reach, actor, subject: taskSubject(row.number), taskId: row.id, commentId, text: `Упоминание: «${quote(text)}»` });
}

/** Упомянули тех, кто не видит предмет: правка прошла, человеку говорим, до кого упоминание не дошло */
async function unreachedWarning(db: Db, mentioned: string[], reach: string[], what: string): Promise<{ warning?: string }> {
  const lost = mentioned.filter((id) => !reach.includes(id));
  if (!lost.length) return {};
  const names = await namesOf(db, lost);
  return { warning: `Упоминание не дошло: ${names.join(", ")} ${names.length > 1 ? "не видят" : "не видит"} ${what}` };
}

async function lockComment(tx: Tx, actor: Actor, number: number, commentId: string) {
  const scope = await scopeOfActor(tx, actor);
  const row = await lockRow(tx, number, { scope, personId: actor.personId });
  if (row.archivedAt && actor.management !== "OWNER") fail(`Задача ${number} в архиве`);
  const comment = row.comments.find((c) => c.id === commentId);
  if (!comment) fail("Комментарий уже удалён");
  return { row, comment: comment! };
}

/** Свой комментарий можно поправить 15 минут: появится пометка «изменено», в журнале было и стало (этап 20) */
export async function editComment(actor: Actor, number: number, commentId: string, text: string, now = new Date()): Promise<TaskResult> {
  if (actor.role === "OBSERVER") fail("Наблюдатель не комментирует");
  const value = required(text, LIMITS.comment, "Напишите комментарий", "Комментарий");
  return prisma.$transaction(async (tx) => {
    const { row, comment } = await lockComment(tx, actor, number, commentId);
    if (comment.authorId !== actor.personId) fail("Править можно только свой комментарий");
    if (!editable(comment.at, now)) fail("Комментарий правят 15 минут после отправки. Напишите новый");
    if (comment.text === value) return { task: toTaskDto(row) };
    // Новые упоминания получают событие, прежние повторно нет
    const mentioned = (await mentionsIn(tx, [value], actor.personId)).filter((id) => !comment.mentions.includes(id));
    const reach = mentioned.length ? await taskReaders(tx, row, mentioned) : [];
    await tx.taskComment.update({ where: { id: comment.id }, data: { text: value, editedAt: now, mentions: [...comment.mentions, ...reach] } });
    await mentionTask(tx, actor, row, comment.id, reach, [row.ownerId, row.createdById, ...row.coExecutors.map((c) => c.personId)], value);
    await audit(tx, actor, number, [{ action: "task.comment.edit", field: "Комментарий изменён", before: comment.text, after: value }]);
    const updated = await tx.task.findUniqueOrThrow({ where: { id: row.id }, include: taskInclude });
    return { task: toTaskDto(updated), ...(await unreachedWarning(tx, mentioned, reach, "эту задачу")) };
  });
}

/** Удалить комментарий: свой или любой в режиме управления. Текст остаётся в журнале (этап 20) */
export async function deleteComment(actor: Actor, number: number, commentId: string): Promise<TaskResult> {
  return prisma.$transaction(async (tx) => {
    const { row, comment } = await lockComment(tx, actor, number, commentId);
    if (comment.authorId !== actor.personId && !actor.management) fail("Удалить можно только свой комментарий");
    await tx.taskComment.delete({ where: { id: comment.id } });
    await audit(tx, actor, number, [{ action: "task.comment.delete", field: "Комментарий удалён", before: comment.text }]);
    const updated = await tx.task.findUniqueOrThrow({ where: { id: row.id }, include: taskInclude });
    return { task: toTaskDto(updated) };
  });
}

/** Реакция на комментарий к задаче (этап 20). Автор комментария видит её в «Мне» */
export async function reactToComment(actor: Actor, number: number, commentId: string, kind: unknown, question?: string | null): Promise<TaskResult> {
  return prisma.$transaction(async (tx) => {
    const { row, comment } = await lockComment(tx, actor, number, commentId);
    const change = await applyReaction(tx, actor, { taskCommentId: comment.id }, kind, question);
    if (change.on && change.kind === "discuss") {
      await audit(tx, actor, number, [{ action: "task.discuss", field: "Обсудить на встрече", before: change.was?.question ?? null, after: change.question }]);
    } else if (!change.on && change.kind === "discuss") {
      await audit(tx, actor, number, [{ action: "task.discuss", field: "Обсудить на встрече снято", before: change.was?.question ?? null }]);
    }
    if (change.on) {
      await notify(tx, {
        kind: "REACTION",
        recipients: [comment.authorId],
        actor,
        subject: taskSubject(number),
        taskId: row.id,
        commentId: comment.id,
        text: change.question ? `${REACTION_LABEL[change.kind]}: «${quote(change.question)}»` : `«${REACTION_LABEL[change.kind]}» к вашему комментарию`,
      });
    } else if (change.was) {
      await dropReactionEvent(tx, actor, { commentId: comment.id }, change.was.createdAt);
    }
    const updated = await tx.task.findUniqueOrThrow({ where: { id: row.id }, include: taskInclude });
    return { task: toTaskDto(updated) };
  });
}

// ---------- Отмена ----------

/** Что вернула отмена: по каждому полю, которое отличается от снимка, «было» сейчас и «стало» как до правки */
async function restoreChanges(tx: Tx, row: TaskRow, b: TaskSnapshot): Promise<Change[]> {
  const out: Change[] = [];
  const add = (field: string, before: string | null | undefined, after: string | null | undefined) => {
    if ((before ?? "") !== (after ?? "")) out.push({ action: "task.undo", field: `${field} (отмена)`, before: before || null, after: after || null });
  };
  const status = (v: string) => statusOf(statusCode(v as TaskStatus)).label;
  add("Статус", status(row.status), status(b.status));
  add("Итог или причина", row.resolution, b.resolution);
  add("Состояние", stateLabel(stateCode(row.state)), stateLabel(stateCode(b.state as TaskState | null)));
  add("Чем заблокирована", row.blockedBy, b.blockedBy);
  add("Приоритет", priorityOf(priorityCode(row.priority)).label, priorityOf(priorityCode(b.priority as TaskPriority | null)).label);
  add("Где сейчас", row.whereNow, b.whereNow);
  add("Срок", formatLong(isoFromDbDate(row.due)), formatLong(b.due));
  add("Задача", row.title, b.title);
  add("Что нужно сделать", row.outcome, b.outcome);
  add("Подробнее об источнике", row.sourceNote, b.sourceNote);
  add("В архиве", row.archivedAt ? "да" : "нет", b.archivedAt ? "да" : "нет");
  if (row.directionId !== b.directionId) {
    const items = await tx.dictionaryItem.findMany({ where: { id: { in: [row.directionId, b.directionId] } } });
    add("Направление", items.find((i) => i.id === row.directionId)?.label, items.find((i) => i.id === b.directionId)?.label);
  }
  if (row.sourceCode !== b.sourceCode) {
    const items = await tx.dictionaryItem.findMany({ where: { kind: "TASK_SOURCE", code: { in: [row.sourceCode, b.sourceCode] } } });
    add("Источник", items.find((i) => i.code === row.sourceCode)?.label ?? row.sourceCode, items.find((i) => i.code === b.sourceCode)?.label ?? b.sourceCode);
  }
  return out;
}

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
      // Чужую правку отмена создания не стирает: если задачу уже поменяли, удалить её нельзя
      if (s.expectUpdatedAt && row.updatedAt.toISOString() !== s.expectUpdatedAt) fail("Задачу уже изменили после создания: отменить нельзя");
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
    const changes = await restoreChanges(tx, row, b);
    // Отмена вернула статус или срок: подписчики узнают и об этом (этап 16)
    const watched = changes.filter((c) => c.field === "Статус (отмена)" || c.field === "Срок (отмена)").map((c) => `${c.field.replace(" (отмена)", "")} снова: ${c.after ?? ""}`);
    if (watched.length) await notifyWatchers(tx, row.id, `Правку отменили. ${watched.join(", ")}`, actor);
    if (s.removeTransferId) {
      const t = row.transfers.find((x) => x.id === s.removeTransferId);
      await tx.taskTransfer.deleteMany({ where: { id: s.removeTransferId, taskId: row.id } });
      if (t) changes.push({ action: "task.undo", field: "Перенос срока отменён", before: `${formatLong(isoFromDbDate(t.toDue))}. Причина: ${t.reason}` });
    }
    if (s.removeLinkId) {
      const l = row.links.find((x) => x.id === s.removeLinkId);
      await tx.taskLink.deleteMany({ where: { id: s.removeLinkId, taskId: row.id } });
      if (l) changes.push({ action: "task.undo", field: "Ссылка отменена", before: `${l.title}: ${l.url}` });
    }
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
    await audit(tx, actor, s.number, changes.length ? changes : [{ action: "task.undo", field: "Последнее действие отменено" }]);
    return { task: toTaskDto(updated), number: s.number };
  });
}

/** Человек из базы в роли действующего лица: для скриптов и тестов */
export async function actorFor(slug: string, management: ManagementRole | null = null): Promise<Actor> {
  const p = await prisma.person.findUniqueOrThrow({ where: { slug } });
  return { personId: p.id, slug: p.slug as PersonSlug, fullName: p.fullName, role: p.role, management };
}

export { personName };

// ---------- Задачи команд (этап 16) ----------

/** Подписаться на задачу или отписаться: событие в «Мне», когда меняются статус или срок */
export async function watchTask(actor: Actor, number: number, on: boolean): Promise<{ watching: boolean }> {
  return prisma.$transaction(async (tx) => {
    const scope = await scopeOfActor(tx, actor);
    const row = await tx.task.findUnique({ where: { number }, include: taskInclude });
    if (!row || !canSeeRow(scope, row, actor.personId)) return fail(`Задачи ${number} нет`);
    if (row.archivedAt && on) fail(`Задача ${number} в архиве`);
    if (on) await tx.taskWatch.createMany({ data: [{ taskId: row.id, personId: actor.personId }], skipDuplicates: true });
    else await tx.taskWatch.deleteMany({ where: { taskId: row.id, personId: actor.personId } });
    return { watching: on };
  });
}

/** Следит ли человек за задачами: номера задач с подпиской */
export async function watchedNumbers(personId: string): Promise<number[]> {
  return (await prisma.taskWatch.findMany({ where: { personId }, select: { task: { select: { number: true } } } })).map((w) => w.task.number);
}

/** Сколько часов ждать, прежде чем снова просить обновить ту же задачу */
const ASK_AGAIN_HOURS = 20;

/**
 * «Попросить обновить»: руководитель команды задачи, руководитель ответственного или режим управления просит
 * ответственного обновить задачу. Ответственный получает событие в «Мне». Одна просьба на задачу в день
 */
export async function requestUpdate(actor: Actor, number: number, now = new Date()): Promise<{ asked: string }> {
  if (actor.role === "OBSERVER") fail("Наблюдатель только смотрит");
  return prisma.$transaction(async (tx) => {
    const scope = await scopeOfActor(tx, actor);
    const row = await lockRow(tx, number, { scope, personId: actor.personId });
    if (row.archivedAt) fail(`Задача ${number} в архиве`);
    if (!row.ownerId) fail("У задачи «Все лидеры» нет одного ответственного: попросите на встрече");
    if (row.ownerId === actor.personId) fail("Это ваша задача: обновите её сами");
    if (!["IN_PROGRESS", "CLARIFY"].includes(row.status)) fail("Обновить просят только задачу в работе");
    const leads = actor.management || scope.leads.includes(row.teamId) || (row.teamId !== TOP_TEAM && scope.leadPeople.includes(row.ownerId!));
    if (!leads) fail("Попросить обновить может руководитель команды или ответственного");
    const since = new Date(now.getTime() - ASK_AGAIN_HOURS * 60 * 60 * 1000);
    const recent = await tx.inboxEvent.count({ where: { kind: "UPDATE_REQUEST", subject: taskSubject(number), recipientId: row.ownerId!, actorId: actor.personId, createdAt: { gt: since } } });
    if (recent) fail("Вы уже просили обновить эту задачу сегодня");
    await notify(tx, { kind: "UPDATE_REQUEST", recipients: [row.ownerId], actor, subject: taskSubject(number), taskId: row.id, text: "Просят обновить задачу: где сейчас, состояние и срок" }, now);
    const owner = await tx.person.findUnique({ where: { id: row.ownerId! }, select: { fullName: true } });
    await audit(tx, actor, number, [{ action: "task.ask", field: "Попросили обновить", after: owner?.fullName ?? null }]);
    return { asked: owner?.fullName ?? "" };
  });
}
