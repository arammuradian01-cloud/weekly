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
import { SYSTEM_ACTOR_ID, notify, quote, taskSubject } from "@/lib/inbox/notify";
import { notifyWatchers } from "./watch";
import { notifyDependents } from "./dependents";
import { finishRequestsOfTask, refinishRequestsOfTask, reopenRequestsOfTask, syncRequestDue, type TaskOutcome } from "@/lib/requests/hooks";
import { REACTION_LABEL, editable, mentionsIn, namesOf } from "@/lib/discuss/common";
import { taskReaders } from "@/lib/discuss/access";
import { applyReaction } from "@/lib/discuss/reactions";
import { TOP_TEAM, loadScope, visibleTasksWhere, type Scope } from "@/lib/org/scope";
import { nextRepeatDue, repeatLabel, type RepeatKindCode, type RepeatModeCode } from "./repeat";
import { foreignGoal, taskPeople } from "@/lib/goals/personal";
import type { RepeatKind, RepeatMode } from "@/generated/prisma/enums";

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
    riskNote: row.riskNote,
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
      actorId: actor.personId === SYSTEM_ACTOR_ID ? null : actor.personId,
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
  return prisma.$transaction((tx) => mutateIn(tx, actor, number, plan));
}

/** Тот же ход правки внутри чужой транзакции: так «Заблокирована, ждёт человека» создаёт просьбу и меняет задачу разом */
async function mutateIn(tx: Tx, actor: Actor, number: number, plan: (row: TaskRow, can: TaskPermissions, tx: Tx) => Promise<Plan>): Promise<TaskResult> {
  const scope = await scopeOfActor(tx, actor);
  const row = await lockRow(tx, number, { scope, personId: actor.personId });
  if (row.archivedAt && actor.management !== "OWNER") fail(`Задача ${number} в архиве`);
  const can = permissions(toTaskDto(row), { ...viewerOf(actor, scope), people: await slugsOf(tx, scope.leadPeople) });
  const before = snapshot(row);
  const p = await plan(row, can, tx);
  if (!p.changes.length) fail("Ничего не изменилось");
  // Сменили ответственного или убрали соисполнителя: личная цель человека, которого больше нет в задаче, снимается
  if (row.goalId) {
    const ownerId = p.data.ownerId !== undefined ? (p.data.ownerId as string | null) : row.ownerId;
    const co = await tx.taskCoExecutor.findMany({ where: { taskId: row.id }, select: { personId: true } });
    const left = await foreignGoal(tx, { goalId: row.goalId, teamId: (p.data.teamId as string | undefined) ?? row.teamId, people: taskPeople({ ownerId, coExecutors: co }) });
    if (left) {
      p.data = { ...p.data, goalId: null };
      p.changes.push({ field: "Цель", before: left, after: "нет: это личная цель человека, которого больше нет в задаче" });
    }
  }
  const updated = await tx.task.update({ where: { id: row.id }, data: p.data, include: taskInclude });
  await audit(tx, actor, number, p.changes);
  const undo =
    p.undo === false
      ? undefined
      : issueUndoToken({ kind: "restore", number, snapshot: before, expectUpdatedAt: updated.updatedAt.toISOString(), ...(p.undo ?? {}) }, actor.personId);
  return { task: toTaskDto(updated), undo };
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
  /** Повтор (этап 25): еженедельно или ежемесячно, следующая при закрытии или по расписанию */
  repeat?: RepeatInput | null;
};

export type RepeatInput = { kind: RepeatKindCode; mode?: RepeatModeCode };

function repeatDb(input: RepeatInput | null | undefined): { repeat: RepeatKind | null; repeatMode: RepeatMode } {
  if (!input) return { repeat: null, repeatMode: "ON_CLOSE" };
  const repeat: RepeatKind = input.kind === "weekly" ? "WEEKLY" : input.kind === "monthly" ? "MONTHLY" : fail("Повтор бывает еженедельным или ежемесячным");
  const repeatMode: RepeatMode = !input.mode || input.mode === "on-close" ? "ON_CLOSE" : input.mode === "schedule" ? "SCHEDULE" : fail("Следующая задача создаётся при закрытии или по расписанию");
  return { repeat, repeatMode };
}

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
  return prisma.$transaction((tx) => createTaskIn(tx, actor, input));
}

/** Новая задача внутри чужой транзакции: так её ставит, например, «Сделать задачей» у просьбы (этап 21) */
export async function createTaskIn(tx: Tx, actor: Actor, input: NewTaskInput): Promise<TaskResult> {
  if (actor.role === "OBSERVER") fail("Наблюдатель задачи не ставит");
  const title = required(input.title, LIMITS.title, "Напишите задачу одной мыслью", "Задача");
  const outcome = required(input.outcome, LIMITS.outcome, "Напишите, по чему понять, что задача сделана", "Что нужно сделать");
  if (!isIsoDate(input.due)) fail("Укажите срок");
  if (input.due < moscowToday()) fail("Срок не может быть в прошлом");
  const sourceNote = optional(input.sourceNote, LIMITS.sourceNote, "Подробнее об источнике");

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
      ...repeatDb(input.repeat),
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
    text: status === "proposed" ? "Вам предложена задача: примите её или отклоните с причиной" : "Новая задача для вас",
  });
  await notify(tx, { kind: "TASK_COEXECUTOR", recipients: coIds, actor, subject, taskId: row.id, text: "Вы соисполнитель" });
  const names = await nameMap(tx);
  await audit(tx, actor, number, [
    {
      action: status === "proposed" ? "task.propose" : "task.create",
      field: status === "proposed" ? "Задача предложена" : "Задача создана",
      after: `${title}. Ответственный: ${ownerLabel(row, names)}, срок ${formatLong(input.due)}${row.repeat ? `. Повтор: ${repeatLabel(row.repeat === "MONTHLY" ? "monthly" : "weekly", row.repeatMode === "SCHEDULE" ? "schedule" : "on-close").toLowerCase()}` : ""}`,
    },
  ]);
  return { task: toTaskDto(row), undo: issueUndoToken({ kind: "create", number, expectUpdatedAt: row.updatedAt.toISOString() }, actor.personId) };
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
      fail(current === "proposed" ? "Предложенную задачу принимает адресат, его руководитель или руководитель команды" : "Статус меняет ответственный, владелец или администратор");
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
        need === "result" ? "Нужен короткий итог или ссылка на результат" : need === "partial" ? "Напишите, что сделано и что нет" : "Без причины так закрыть задачу нельзя",
        need === "reason" ? "Причина" : "Итог",
      );
    }
    const closing = CLOSED_DB.includes(db);
    const wasClosed = CLOSED_DB.includes(row.status);
    // Задача из просьбы закрыта: просьба закрывается вместе с ней, автор просьбы узнаёт об этом. Закрытую задачу
    // открыли снова: просьба снова принята (этап 21). У закрытой сменили итог: у просьбы тот же новый итог (этап 22)
    if (closing && wasClosed) await refinishRequestsOfTask(tx, { id: row.id, number }, db as TaskOutcome, resolution, actor);
    else if (closing) await finishRequestsOfTask(tx, { id: row.id, number }, db as TaskOutcome, resolution, actor);
    else if (wasClosed) await reopenRequestsOfTask(tx, { id: row.id, number }, actor);
    // Задачу ждали другие: их ответственные узнают, что её закрыли (этап 21)
    if (closing && !wasClosed) await notifyDependents(tx, { id: row.id }, actor, (dep) => `Задача ${number}, которую ждёт ваша задача ${dep.number}: ${statusOf(next).label.toLowerCase()}`);
    // Повтор при закрытии (этап 25): следующая задача серии, если её ещё нет. Предложенную и отклонённую задачу
    // серия не продолжает: «Отменена» останавливает повтор у самой задачи
    let spawned: Task | null = null;
    const stopSeries = !!row.repeat && next === "cancelled";
    if (closing && !wasClosed && !stopSeries && current !== "proposed" && row.repeat && row.repeatMode === "ON_CLOSE" && !row.repeatNext) spawned = await spawnRepeatIn(tx, row, actor);
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
      data: { status: db, resolution: closing ? resolution : null, closedAt: closing ? new Date() : null, ...(stopSeries ? { repeat: null } : {}) },
      changes: [
        { field: "Статус", before: statusOf(current).label, after: `${resolution ? `${statusOf(next).label}. ${resolution}` : statusOf(next).label}${spawned ? `. Создан повтор: задача ${spawned.number}` : ""}` },
        ...(stopSeries ? [{ field: "Повтор", before: repeatLabel(row.repeat === "MONTHLY" ? "monthly" : "weekly", row.repeatMode === "SCHEDULE" ? "schedule" : "on-close"), after: "Без повтора: задача отменена" }] : []),
      ],
      // Созданный повтор отменой закрытия не исчезает, поэтому и само закрытие не отменяется кнопкой
      ...(spawned ? { undo: false as const } : {}),
    };
  });
}

/** Чего ждёт задача, когда её блокируют (этап 21): другую задачу по номеру. Человека ждут через просьбу (requests) */
export type StateOptions = { waitTask?: number | null };

/**
 * Состояние задачи (этап 21, модуль М5). «Заблокирована» требует ссылку: задачу, которую эта ждёт, или открытую
 * просьбу по задаче. Текст остаётся пояснением. «Есть риск» требует фразу: что вернёт задачу в график
 */
export async function changeState(actor: Actor, number: number, next: StateCode, note?: string | null, opts: StateOptions = {}): Promise<TaskResult> {
  if (opts.waitTask === undefined || opts.waitTask === null) return mutate(actor, number, (row, can, tx) => statePlan(tx, actor, row, can, next, note, opts));
  return prisma.$transaction(async (tx) => {
    await lockGraph(tx);
    return mutateIn(tx, actor, number, (row, can, t) => statePlan(t, actor, row, can, next, note, opts));
  });
}

/**
 * Замок на граф связей до замка строк задач: две связи, поставленные одновременно, не замкнут круг и не упрутся
 * друг в друга (A ждёт B и B ждёт A в одну секунду)
 */
async function lockGraph(tx: Tx): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('task-dependencies'))::text`;
}

/** То же внутри чужой транзакции: «ждёт человека» сначала создаёт просьбу, потом блокирует задачу */
export async function changeStateIn(tx: Tx, actor: Actor, number: number, next: StateCode, note?: string | null, opts: StateOptions = {}): Promise<TaskResult> {
  return mutateIn(tx, actor, number, (row, can, t) => statePlan(t, actor, row, can, next, note, opts));
}

async function statePlan(tx: Tx, actor: Actor, row: TaskRow, can: TaskPermissions, next: StateCode, note: string | null | undefined, opts: StateOptions): Promise<Plan> {
  if (!can.state) fail("Состояние меняет ответственный, владелец или администратор");
  if (next === "unset") fail("Выберите состояние");
  const db: TaskState = stateDb(next) ?? fail("Нет такого состояния");
  const text = optional(note, LIMITS.reason, db === "AT_RISK" ? "Что вернёт задачу в график" : "Пояснение");
  const changes: Change[] = [];
  let blockedBy: string | null = null;
  let riskNote: string | null = null;
  if (db === "AT_RISK") {
    if (!text) fail("Напишите одной фразой, что вернёт задачу в график");
    riskNote = text;
  }
  if (db === "BLOCKED") {
    if (opts.waitTask !== undefined && opts.waitTask !== null) {
      const link = await linkDependency(tx, actor, row, Number(opts.waitTask));
      if (link.created) changes.push({ field: "Ждёт задачу", after: `${link.number}. ${link.title}` });
      blockedBy = text ?? `Ждёт задачу ${link.number}`;
    } else {
      const waits = await openWaits(tx, row.id);
      if (!waits) fail("Укажите, кого ждёт задача: другую задачу или человека");
      blockedBy = text ?? waits;
    }
  }
  if (db === row.state && blockedBy === row.blockedBy && riskNote === row.riskNote && !changes.length) fail("Состояние уже такое");
  const label = stateLabel(next);
  const detail = blockedBy ?? riskNote;
  const linked = changes.length > 0;
  changes.unshift({ field: "Состояние", before: stateLabel(stateCode(row.state)), after: detail ? `${label}. ${detail}` : label });
  // Новую связь отмена состояния не убрала бы: такую правку не отменяют, связь снимают в карточке
  return { data: { state: db, blockedBy, riskNote }, changes, ...(linked ? { undo: false as const } : {}) };
}

/** Есть ли у задачи открытая ссылка: задача, которую она ждёт, или просьба по ней. Ответ: подпись для «Чем заблокирована» */
async function openWaits(tx: Tx, taskId: string): Promise<string | null> {
  const [request, dep] = await Promise.all([
    tx.helpRequest.findFirst({ where: { taskId, status: { in: ["OPEN", "ACCEPTED"] } }, orderBy: { createdAt: "desc" }, select: { addressee: { select: { fullName: true } } } }),
    tx.taskDependency.findFirst({ where: { taskId, blocker: { status: { notIn: CLOSED_DB }, archivedAt: null } }, orderBy: { createdAt: "desc" }, select: { blocker: { select: { number: true } } } }),
  ]);
  if (request) return `Ждёт ответа: ${request.addressee.fullName}`;
  if (dep) return `Ждёт задачу ${dep.blocker.number}`;
  return null;
}

/**
 * Связать задачу с задачей, которую она ждёт. Обе видны тому, кто связывает, круга не будет. Ответственному
 * за ту задачу событие: её ждут (без названия зависимой: он может её не видеть)
 */
async function linkDependency(tx: Tx, actor: Actor, row: TaskRow, blockerNumber: number): Promise<{ created: boolean; number: number; title: string }> {
  if (!Number.isInteger(blockerNumber) || blockerNumber < 1 || blockerNumber > 2_147_483_647) fail("Укажите номер задачи, которую ждёт эта");
  if (blockerNumber === row.number) fail("Задача не может ждать сама себя");
  const blocker = await tx.task.findUnique({
    where: { number: blockerNumber },
    select: { id: true, number: true, title: true, status: true, teamId: true, ownerId: true, createdById: true, archivedAt: true, coExecutors: { select: { personId: true } } },
  });
  const scope = await scopeOfActor(tx, actor);
  if (!blocker || blocker.archivedAt || !canSeeRow(scope, blocker, actor.personId)) fail(`Задачи ${blockerNumber} нет`);
  if (CLOSED_DB.includes(blocker!.status)) fail(`Задача ${blockerNumber} уже закрыта: ждать её не нужно`);
  const exists = await tx.taskDependency.findUnique({ where: { taskId_blockerId: { taskId: row.id, blockerId: blocker!.id } } });
  if (exists) return { created: false, number: blocker!.number, title: blocker!.title };
  // Круг: та задача сама (через другие) уже ждёт эту
  let frontier = [blocker!.id];
  const seen = new Set(frontier);
  for (let depth = 0; frontier.length && depth < 50; depth++) {
    const next = await tx.taskDependency.findMany({ where: { taskId: { in: frontier } }, select: { blockerId: true } });
    if (next.some((d) => d.blockerId === row.id)) fail(`Связь замкнётся в круг: задача ${blocker!.number} уже ждёт эту`);
    frontier = next.map((d) => d.blockerId).filter((id) => !seen.has(id));
    for (const id of frontier) seen.add(id);
  }
  await tx.taskDependency.createMany({ data: [{ taskId: row.id, blockerId: blocker!.id, createdById: actor.personId }], skipDuplicates: true });
  await notify(tx, { kind: "TASK_DEPENDENCY", recipients: [blocker!.ownerId], actor, subject: taskSubject(blocker!.number), taskId: blocker!.id, text: `Вашу задачу ждёт задача ${row.number}` });
  return { created: true, number: blocker!.number, title: blocker!.title };
}

/** Связь «ждёт задачу» вручную, из карточки (этап 21) */
export async function addDependency(actor: Actor, number: number, blockerNumber: number): Promise<TaskResult> {
  return prisma.$transaction(async (tx) => {
    await lockGraph(tx);
    return mutateIn(tx, actor, number, async (row, can, t) => {
      if (!can.state) fail("Связи задачи меняет ответственный, владелец или администратор");
      const link = await linkDependency(t, actor, row, Number(blockerNumber));
      if (!link.created) fail("Эта связь уже есть");
      return { data: { updatedAt: new Date() }, changes: [{ field: "Ждёт задачу", after: `${link.number}. ${link.title}` }], undo: false };
    });
  });
}

export async function removeDependency(actor: Actor, number: number, blockerNumber: number): Promise<TaskResult> {
  return mutate(actor, number, async (row, can, tx) => {
    if (!can.state) fail("Связи задачи меняет ответственный, владелец или администратор");
    const blocker = await tx.task.findUnique({ where: { number: Number(blockerNumber) }, select: { id: true, number: true } });
    const removed = blocker ? await tx.taskDependency.deleteMany({ where: { taskId: row.id, blockerId: blocker.id } }) : { count: 0 };
    if (!removed.count) fail("Этой связи уже нет");
    // Заблокированная задача без единой ссылки снова стала бы «текстом без адресата»
    if (row.state === "BLOCKED" && !(await openWaits(tx, row.id))) fail("Задача заблокирована и больше ничего не ждёт: сначала смените состояние или добавьте другую ссылку");
    return { data: { updatedAt: new Date() }, changes: [{ field: "Ждёт задачу", before: String(blocker!.number), after: "связь снята" }], undo: false };
  });
}

export type TaskLinkView = { number: number; title: string | null; due: IsoDate; status: StatusCode; owner: PersonSlug | null; late: boolean };

/** Связи задачи для карточки: что она ждёт и кто ждёт её. Чужие задачи без названия */
export async function taskLinks(actor: Actor, number: number): Promise<{ waitsFor: TaskLinkView[]; blocks: TaskLinkView[]; canEdit: boolean; existing: string | null } | null> {
  const scope = await scopeOfActor(prisma, actor);
  const row = await prisma.task.findUnique({ where: { number }, include: taskInclude });
  if (!row || !canSeeRow(scope, row, actor.personId)) return null;
  const select = { id: true, number: true, title: true, due: true, status: true, teamId: true, ownerId: true, createdById: true, archivedAt: true, owner: { select: { slug: true } }, coExecutors: { select: { personId: true } } } as const;
  const [waits, blocks] = await Promise.all([
    prisma.taskDependency.findMany({ where: { taskId: row.id }, select: { blocker: { select } }, orderBy: { createdAt: "asc" } }),
    prisma.taskDependency.findMany({ where: { blockerId: row.id }, select: { task: { select } }, orderBy: { createdAt: "asc" } }),
  ]);
  const view = (t: (typeof waits)[number]["blocker"], late: boolean): TaskLinkView => {
    const visible = !t.archivedAt && canSeeRow(scope, t, actor.personId);
    return { number: t.number, title: visible ? t.title : null, due: isoFromDbDate(t.due), status: statusCode(t.status), owner: visible ? ((t.owner?.slug as PersonSlug | undefined) ?? null) : null, late };
  };
  const open = (s: TaskStatus) => !CLOSED_DB.includes(s);
  const can = permissions(toTaskDto(row), { ...viewerOf(actor, scope), people: await slugsOf(prisma, scope.leadPeople) });
  return {
    waitsFor: waits.map((w) => view(w.blocker, open(row.status) && open(w.blocker.status) && !w.blocker.archivedAt && w.blocker.due > row.due)),
    blocks: blocks.map((b) => view(b.task, open(row.status) && open(b.task.status) && row.due > b.task.due)),
    canEdit: can.state,
    // Чего задача уже ждёт: открытая задача или просьба. Окно «Заблокирована» предлагает обойтись без новой ссылки
    existing: await prisma.$transaction((tx) => openWaits(tx, row.id)),
  };
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
    const today = moscowToday();
    if (value === row.whereNow) {
      // Тот же текст: подтверждение, что по задаче всё так же (этап 22, «В графике не подтверждено»)
      if (isoFromDbDate(row.whereUpdatedAt) === today) fail("Текст не изменился");
      return { data: { whereUpdatedAt: dbDate(today) }, changes: [{ field: "Где сейчас", before: null, after: "Подтверждено без изменений" }], undo: false };
    }
    return {
      data: { whereNow: value, whereUpdatedAt: dbDate(today) },
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
    // Задача из просьбы: у просьбы тот же срок, что у задачи (этап 21)
    await syncRequestDue(tx, { id: row.id, number }, dbDate(to), actor);
    // Задачи, которые ждут эту: срок ушёл позже их срока, их ответственные узнают (этап 21)
    const newDue = dbDate(to);
    await notifyDependents(tx, { id: row.id }, actor, (dep) => (dep.due < newDue ? `Срок задачи ${number}, которую ждёт ваша задача ${dep.number}, перенесён на ${formatLong(to)}: позже вашего срока` : null));
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

/**
 * Передать задачу (этап 21, модуль М5): новый ответственный и комментарий, прежний становится соисполнителем.
 * Ответственный передаёт человеку из команды задачи, руководитель команды людям своих команд, режим управления кому угодно.
 * В истории видно, кто кому и почему передал, новому ответственному событие в «Мне»
 */
export async function handOver(actor: Actor, number: number, to: PersonSlug, comment: string): Promise<TaskResult> {
  return mutate(actor, number, async (row, can, tx) => {
    if (!can.handover) fail(row.status === "PROPOSED" ? "Предложенную задачу сначала принимают, потом передают" : CLOSED_DB.includes(row.status) ? "Закрытую задачу не передают" : "Передаёт задачу ответственный, руководитель команды или режим управления");
    const why = required(comment, LIMITS.reason, "Напишите, почему передаёте: новый ответственный увидит комментарий", "Комментарий");
    const target = (await peopleBySlug(tx)).get(String(to));
    if (!target) fail("Выберите, кому передать, из списка");
    if (target!.id === row.ownerId) fail("Задача уже у этого человека");
    if (!actor.management) {
      // По общему логину можно выбрать чужой профиль: передача только при личном входе
      if (actor.via === "TEAM") fail("Передать задачу можно при личном входе");
      const scope = await scopeOfActor(tx, actor);
      const team = await tx.team.findUnique({ where: { id: row.teamId }, select: { leaderId: true, members: { select: { personId: true } } } });
      const inTeam = !!team && (team.leaderId === target!.id || team.members.some((m) => m.personId === target!.id));
      // Руководитель команды задачи передаёт и людям своих команд ниже; ответственный только внутри команды задачи
      const leadsTaskTeam = scope.leads.includes(row.teamId);
      if (!inTeam && !(leadsTaskTeam && scope.leadPeople.includes(target!.id))) fail("Передать можно человеку из команды задачи. Другому её можно предложить новой задачей или попросить его");
    }
    const names = await nameMap(tx);
    const before = ownerLabel(row, names);
    const changes: Change[] = [{ action: "task.handover", field: "Ответственный", before, after: `${target!.fullName}. Причина: ${why}` }];
    const prevId = row.ownerAll ? null : row.ownerId;
    // Прежний ответственный остаётся в задаче соисполнителем, новый соисполнителем больше не числится
    await tx.taskCoExecutor.deleteMany({ where: { taskId: row.id, personId: target!.id } });
    if (prevId) await tx.taskCoExecutor.createMany({ data: [{ taskId: row.id, personId: prevId }], skipDuplicates: true });
    const coBefore = row.coExecutors.map((c) => c.person.slug);
    const coAfter = [...coBefore.filter((x) => x !== target!.slug), ...(row.owner && prevId && !coBefore.includes(row.owner.slug) ? [row.owner.slug] : [])];
    const list = (slugs: string[]) => slugs.map((x) => names.get(x) ?? x).join(", ") || "нет";
    if (list(coBefore) !== list(coAfter)) changes.push({ field: "Соисполнители", before: list(coBefore), after: list(coAfter) });
    await notify(tx, { kind: "TASK_ASSIGNED", recipients: [target!.id], actor, subject: taskSubject(number), taskId: row.id, text: `Задача передана вам: ${quote(why)}` });
    if (prevId && prevId !== actor.personId) {
      await notify(tx, { kind: "TASK_COEXECUTOR", recipients: [prevId], actor, subject: taskSubject(number), taskId: row.id, text: `Задачу передали: ${target!.fullName}. Вы соисполнитель` });
    }
    await notifyWatchers(tx, row.id, `Задачу передали: ${target!.fullName}`, actor, [target!.id, prevId]);
    return { data: { ownerId: target!.id, ownerAll: false }, changes, undo: false };
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
    canComment(scope, row, actor);
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
    await notifyWatchers(tx, row.id, `Комментарий: «${quote(value)}»`, actor, [...participants, ...reach], comment.id);
    await audit(tx, actor, number, [{ action: "task.comment", field: "Комментарий", after: value }]);
    const updated = await tx.task.findUniqueOrThrow({ where: { id: row.id }, include: taskInclude });
    return {
      task: toTaskDto(updated),
      undo: issueUndoToken({ kind: "comment", number, commentId: comment.id }, actor.personId),
      ...(await unreachedWarning(tx, mentioned, reach, "эту задачу")),
    };
  });
}

/**
 * Кто обсуждает задачу: участники, её команда, руководитель ответственного. Функциональный руководитель задачи
 * своих людей только смотрит: не комментирует и не ставит реакции
 */
function canComment(scope: Scope, row: TaskRow, actor: Actor): void {
  const participant = row.ownerId === actor.personId || row.createdById === actor.personId || row.coExecutors.some((c) => c.personId === actor.personId);
  // Руководитель ответственного комментирует задачу своего человека и в чужой команде, например, просьбу к нему (этап 16)
  const ownersLeader = !!row.ownerId && scope.leadPeople.includes(row.ownerId) && row.teamId !== TOP_TEAM;
  if (!scope.all && !scope.visible.includes(row.teamId) && !participant && !ownersLeader) fail("Функциональный руководитель видит задачу, но не комментирует её");
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
  return { row, comment: comment!, scope };
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

/**
 * Реакция на комментарий к задаче (этап 20). Автор комментария видит её в «Мне», если он ещё видит задачу.
 * Сняли реакцию: событие о ней уходит вместе с ней (связь в базе)
 */
export async function reactToComment(actor: Actor, number: number, commentId: string, kind: unknown, question?: string | null): Promise<TaskResult> {
  return prisma.$transaction(async (tx) => {
    const { row, comment, scope } = await lockComment(tx, actor, number, commentId);
    canComment(scope, row, actor);
    const change = await applyReaction(tx, actor, { taskCommentId: comment.id }, kind, question);
    if (change.kind === "discuss") {
      await audit(tx, actor, number, [
        change.on
          ? { action: "task.discuss", field: "Обсудить на встрече", before: change.was?.question ?? null, after: change.question }
          : { action: "task.discuss", field: "Обсудить на встрече снято", before: change.was?.question ?? null },
      ]);
    }
    if (change.on && (await taskReaders(tx, row, [comment.authorId])).length) {
      await notify(tx, {
        kind: "REACTION",
        recipients: [comment.authorId],
        actor,
        subject: taskSubject(number),
        taskId: row.id,
        commentId: comment.id,
        reactionId: change.id,
        text: change.question ? `${REACTION_LABEL[change.kind]}: «${quote(change.question)}»` : `«${REACTION_LABEL[change.kind]}» к вашему комментарию`,
      });
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
  if (b.riskNote !== undefined) add("Что вернёт в график", row.riskNote, b.riskNote);
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
        riskNote: b.riskNote === undefined ? row.riskNote : b.riskNote,
        priority: b.priority as TaskPriority | null,
        whereNow: b.whereNow,
        whereUpdatedAt: dbDate(b.whereUpdatedAt),
        due: dbDate(b.due),
        archivedAt: b.archivedAt ? new Date(b.archivedAt) : null,
      },
      include: taskInclude,
    });
    // Просьбы за задачей (этап 21): отмена вернула статус или срок, просьба идёт следом
    const ref = { id: row.id, number: s.number };
    const wasClosed = CLOSED_DB.includes(row.status);
    const nowClosed = CLOSED_DB.includes(b.status as TaskStatus);
    if (wasClosed && !nowClosed) await reopenRequestsOfTask(tx, ref, actor);
    if (!wasClosed && nowClosed) await finishRequestsOfTask(tx, ref, b.status as TaskOutcome, b.resolution, actor);
    if (wasClosed && nowClosed && row.status !== b.status) await refinishRequestsOfTask(tx, ref, b.status as TaskOutcome, b.resolution, actor);
    if (isoFromDbDate(row.due) !== b.due) await syncRequestDue(tx, ref, dbDate(b.due), actor);
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

// ---------- Массовые действия (этап 25, модуль М10) ----------

export type BulkChange =
  | { kind: "status"; next: StatusCode; note?: string }
  | { kind: "owner"; owner: Owner }
  | { kind: "due"; to: IsoDate; reason: string }
  | { kind: "priority"; next: PriorityCode };

export type BulkResult = { done: Task[]; failed: { number: number; error: string }[] };

export const BULK_MAX = 100;

/**
 * Одно изменение сразу у нескольких задач. Каждая задача проходит те же правила и права, что и поодиночке,
 * в своей транзакции: одна задача без права или с нарушением правила не останавливает остальные, а попадает
 * в список неудач с причиной. Журнал получает запись по каждой задаче, отмены на 5 секунд у массового действия нет
 */
export async function bulkChange(actor: Actor, numbers: number[], change: BulkChange): Promise<BulkResult> {
  const unique = [...new Set(numbers)];
  if (!unique.length) fail("Выберите задачи");
  if (unique.length > BULK_MAX) fail(`За раз не больше ${BULK_MAX} задач`);
  if (actor.role === "OBSERVER") fail("Наблюдатель только читает");
  const result: BulkResult = { done: [], failed: [] };
  for (const number of unique) {
    try {
      const r =
        change.kind === "status"
          ? await changeStatus(actor, number, change.next, change.note)
          : change.kind === "owner"
            ? await assignOwner(actor, number, change.owner)
            : change.kind === "due"
              ? await transferDue(actor, number, change.to, change.reason)
              : await changePriority(actor, number, change.next);
      result.done.push(r.task);
    } catch (error) {
      result.failed.push({ number, error: error instanceof TaskRuleError ? error.message : "Не получилось сохранить" });
    }
  }
  return result;
}

// ---------- Повторяющиеся задачи (этап 25, модуль М10) ----------

/** Включить, поменять или выключить повтор у задачи: ответственный, тот, кто поставил, руководитель команды, управление */
export async function setRepeat(actor: Actor, number: number, input: RepeatInput | null): Promise<TaskResult> {
  return mutate(actor, number, async (row, can) => {
    if (!can.edit && !can.due) fail("Повтор задаёт ответственный, тот, кто поставил задачу, руководитель команды, владелец или администратор");
    const next = repeatDb(input);
    if (next.repeat === row.repeat && next.repeatMode === row.repeatMode) fail("Повтор уже такой");
    const label = (r: RepeatKind | null, m: RepeatMode) => (r ? repeatLabel(r === "MONTHLY" ? "monthly" : "weekly", m === "SCHEDULE" ? "schedule" : "on-close") : "Без повтора");
    return { data: next, changes: [{ field: "Повтор", before: label(row.repeat, row.repeatMode), after: label(next.repeat, next.repeatMode) }] };
  });
}

/**
 * Ресурс по расписанию как автор: в журнале без человека, в «Мне» событие приходит и ответственному, и соисполнителям.
 * personId не совпадает ни с одним человеком, поэтому никто не исключается из получателей
 */
const SCHEDULER: Actor = { personId: SYSTEM_ACTOR_ID, slug: "" as PersonSlug, fullName: "Ресурс по расписанию", role: "ADMIN", management: "ADMIN", ip: null, via: null };

/**
 * Следующая задача серии: та же задача с новым сроком, статус «В работе», чек-лист без отметок. Права не проверяются:
 * серию завёл тот, кто имел право, а создаёт следующую ресурс. Ответственный и соисполнители узнают в «Мне»
 */
async function spawnRepeatIn(tx: Tx, row: TaskRow, actor: Actor, today: IsoDate = moscowToday()): Promise<Task> {
  if (!row.repeat) fail("У задачи нет повтора");
  const kind: RepeatKindCode = row.repeat === "MONTHLY" ? "monthly" : "weekly";
  const due = nextRepeatDue(kind, isoFromDbDate(row.due), today);
  const number = await nextNumber(tx);
  const todayDb = dbDate(today);
  const created = await tx.task.create({
    data: {
      number,
      title: row.title,
      outcome: row.outcome,
      ownerId: row.ownerId,
      ownerAll: row.ownerAll,
      directionId: row.directionId,
      priority: row.priority,
      status: "IN_PROGRESS",
      state: "ON_TRACK",
      whereUpdatedAt: todayDb,
      due: dbDate(due),
      originalDue: dbDate(due),
      sourceCode: "other",
      sourceNote: `Повтор задачи ${row.number}`,
      createdById: row.createdById,
      teamId: row.teamId,
      goalId: row.goalId,
      repeat: row.repeat,
      repeatMode: row.repeatMode,
      repeatOfId: row.id,
      coExecutors: { create: row.coExecutors.map((c) => ({ personId: c.personId })) },
      checklist: { create: row.checklist.map((c, i) => ({ text: c.text, sortOrder: i })) },
    },
    include: taskInclude,
  });
  // Событие приходит и тому, кто сам закрыл задачу: иначе ответственный не узнал бы о новом сроке
  await notify(tx, {
    kind: "TASK_ASSIGNED",
    recipients: [row.ownerId, ...row.coExecutors.map((c) => c.personId)],
    actor: { ...actor, personId: SYSTEM_ACTOR_ID },
    subject: taskSubject(number),
    taskId: created.id,
    text: `Повтор задачи ${row.number}, срок ${formatLong(due)}`,
  });
  const names = await nameMap(tx);
  await audit(tx, actor, number, [{ action: "task.create", field: "Задача создана повтором", after: `${row.title}. Повтор задачи ${row.number}. Ответственный: ${ownerLabel(created, names)}, срок ${formatLong(due)}` }]);
  return toTaskDto(created);
}

/**
 * Повторы по расписанию: в день срока открытой задачи с режимом «по расписанию» создаётся следующая, если её ещё нет.
 * Идёт в минутном цикле сервера. Строка блокируется, чтобы два прохода не создали две следующие
 */
export async function repeatPass(now = new Date()): Promise<number> {
  const today = moscowToday(now);
  const due = await prisma.task.findMany({
    where: { repeat: { not: null }, repeatMode: "SCHEDULE", archivedAt: null, status: { in: ["IN_PROGRESS", "CLARIFY"] }, due: { lte: dbDate(today) }, repeatNext: null },
    select: { id: true, number: true },
    take: 200,
  });
  let created = 0;
  for (const t of due) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${t.id} FOR UPDATE`;
        const row = await tx.task.findUnique({ where: { id: t.id }, include: taskInclude });
        if (!row || !row.repeat || row.repeatMode !== "SCHEDULE" || row.repeatNext || row.archivedAt || !["IN_PROGRESS", "CLARIFY"].includes(row.status)) return;
        await spawnRepeatIn(tx, row, SCHEDULER, today);
        created++;
      });
    } catch (error) {
      console.error(`Повтор задачи ${t.number} не создался`, error instanceof Error ? error.message : error);
    }
  }
  return created;
}

// ---------- Чек-лист (этап 25, модуль М10) ----------

export const CHECKLIST_LIMITS = { text: 200, items: 50 };

/** Чек-лист ведут те, кто ведёт «Где сейчас»: ответственный, соисполнители, руководитель команды, режим управления. У закрытой задачи он не меняется */
function canChecklist(can: TaskPermissions, row: TaskRow): void {
  if (!can.where) fail("Чек-лист ведут ответственный, соисполнители, руководитель команды, владелец или администратор");
  if (CLOSED_DB.includes(row.status)) fail("У закрытой задачи чек-лист не меняется");
}

export async function addChecklistItem(actor: Actor, number: number, text: string): Promise<TaskResult> {
  return mutate(actor, number, async (row, can, tx) => {
    canChecklist(can, row);
    const v = required(text, CHECKLIST_LIMITS.text, "Напишите пункт", "Пункт чек-листа");
    if (row.checklist.length >= CHECKLIST_LIMITS.items) fail(`В чек-листе не больше ${CHECKLIST_LIMITS.items} пунктов`);
    await tx.taskChecklistItem.create({ data: { taskId: row.id, text: v, sortOrder: row.checklist.length } });
    return { data: { updatedAt: new Date() }, changes: [{ field: "Чек-лист", after: `Добавлен пункт: ${v}` }], undo: false };
  });
}

export async function toggleChecklistItem(actor: Actor, number: number, itemId: string, done: boolean): Promise<TaskResult> {
  return mutate(actor, number, async (row, can, tx) => {
    canChecklist(can, row);
    const item = row.checklist.find((c) => c.id === itemId) ?? fail("Такого пункта нет");
    if (item.done === done) fail(done ? "Пункт уже отмечен" : "Пункт и так не отмечен");
    await tx.taskChecklistItem.update({ where: { id: item.id }, data: { done, doneById: done ? actor.personId : null, doneAt: done ? new Date() : null } });
    const total = row.checklist.length;
    const doneCount = row.checklist.filter((c) => c.id !== item.id && c.done).length + (done ? 1 : 0);
    return { data: { updatedAt: new Date() }, changes: [{ field: "Чек-лист", before: item.text, after: `${done ? "Отмечено" : "Снята отметка"}, ${doneCount} из ${total}` }], undo: false };
  });
}

export async function removeChecklistItem(actor: Actor, number: number, itemId: string): Promise<TaskResult> {
  return mutate(actor, number, async (row, can, tx) => {
    canChecklist(can, row);
    const item = row.checklist.find((c) => c.id === itemId) ?? fail("Такого пункта нет");
    await tx.taskChecklistItem.delete({ where: { id: item.id } });
    return { data: { updatedAt: new Date() }, changes: [{ field: "Чек-лист", before: item.text, after: "Пункт убран" }], undo: false };
  });
}

export async function editChecklistItem(actor: Actor, number: number, itemId: string, text: string): Promise<TaskResult> {
  return mutate(actor, number, async (row, can, tx) => {
    canChecklist(can, row);
    const item = row.checklist.find((c) => c.id === itemId) ?? fail("Такого пункта нет");
    const v = required(text, CHECKLIST_LIMITS.text, "Напишите пункт", "Пункт чек-листа");
    if (v === item.text) fail("Ничего не изменилось");
    await tx.taskChecklistItem.update({ where: { id: item.id }, data: { text: v } });
    return { data: { updatedAt: new Date() }, changes: [{ field: "Чек-лист", before: item.text, after: v }], undo: false };
  });
}
