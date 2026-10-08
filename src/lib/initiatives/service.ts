// Шкала готовности крупных инициатив на сервере (этап 30). Права проверяются здесь, экран только прячет кнопки.
//
// - видят инициативы все, кто вошёл: это 10-15 больших дел департамента, как задачи топ-команды;
// - заводит, правит, закрывает и возвращает владелец или администратор в режиме управления;
// - деление шкалы и заметку меняет ответственный (и режим управления). При смене деления заметка обязательна;
// - ответственный получает событие «Мне», когда его назначили; тот, кто завёл инициативу, когда сменилось деление.

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { notify } from "@/lib/inbox/notify";
import { TOP_TEAM } from "@/domain/teams";
import {
  cleanNote,
  cleanTitle,
  cleanWhy,
  flagsOf,
  isResultCode,
  isStateCode,
  RESULT_CODE,
  RESULT_DB,
  RESULT_LABELS,
  SOFT_MAX,
  STATE_CODE,
  STATE_DB,
  STATE_LABELS,
  type Flags,
  type ResultCode,
  type StateCode,
} from "./rules";

type Tx = Prisma.TransactionClient;

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

/** Предмет события «Мне»: события одной инициативы склеиваются в одну строку */
export function initiativeSubject(id: string): string {
  return `initiative:${id}`;
}

export function canManage(actor: Pick<Actor, "management" | "role">): boolean {
  return !!actor.management && actor.role !== "OBSERVER";
}

export type InitiativeChangeView = { kind: string; from: StateCode | null; to: StateCode | null; note: string | null; by: string | null; at: string };

export type InitiativeView = {
  id: string;
  title: string;
  why: string;
  owner: { slug: string; fullName: string; active: boolean };
  team: { id: string; name: string };
  goal: { id: string; code: string | null; title: string; quarter: string } | null;
  state: StateCode;
  stateSince: string;
  note: string;
  noteAt: string;
  flags: Flags;
  result: ResultCode | null;
  resultNote: string | null;
  closedAt: string | null;
  /** Может поменять деление и заметку: ответственный или режим управления */
  canUpdate: boolean;
  history: InitiativeChangeView[];
};

export type InitiativesPage = {
  active: InitiativeView[];
  closed: InitiativeView[];
  canManage: boolean;
  softMax: number;
  /** Для формы режима управления: кого можно назначить, какие команды и цели */
  people: { slug: string; fullName: string }[];
  teams: { id: string; name: string }[];
  goals: { id: string; label: string }[];
};

const include = {
  owner: { select: { id: true, slug: true, fullName: true, active: true } },
  team: { select: { id: true, name: true } },
  goal: { select: { id: true, code: true, title: true, quarter: true } },
  changes: { orderBy: { at: "desc" as const }, take: 6, include: { by: { select: { fullName: true } } } },
} satisfies Prisma.InitiativeInclude;

type Row = Prisma.InitiativeGetPayload<{ include: typeof include }>;

function toView(r: Row, actor: Actor, now: Date): InitiativeView {
  const state = STATE_CODE[r.state];
  return {
    id: r.id,
    title: r.title,
    why: r.why,
    owner: { slug: r.owner.slug, fullName: r.owner.fullName, active: r.owner.active },
    team: r.team,
    goal: r.goal,
    state,
    stateSince: r.stateSince.toISOString(),
    note: r.note,
    noteAt: r.noteAt.toISOString(),
    flags: flagsOf({ state, stateSince: r.stateSince, noteAt: r.noteAt, closed: r.closedAt !== null }, now),
    result: r.result ? RESULT_CODE[r.result] : null,
    resultNote: r.resultNote,
    closedAt: r.closedAt?.toISOString() ?? null,
    canUpdate: r.closedAt === null && (r.ownerId === actor.personId || canManage(actor)),
    history: r.changes.map((c) => ({
      kind: c.kind,
      from: c.fromState ? STATE_CODE[c.fromState] : null,
      to: c.toState ? STATE_CODE[c.toState] : null,
      note: c.note,
      by: c.by?.fullName ?? null,
      at: c.at.toISOString(),
    })),
  };
}

/** Текущий квартал для выбора цели: 2026-Q4 */
function quarterOf(now: Date): string {
  const msk = new Date(now.getTime() + 3 * 3_600_000);
  return `${msk.getUTCFullYear()}-Q${Math.floor(msk.getUTCMonth() / 3) + 1}`;
}

export async function listInitiatives(actor: Actor, now = new Date()): Promise<InitiativesPage> {
  const manage = canManage(actor);
  const [active, closed, people, teams, goals] = await Promise.all([
    prisma.initiative.findMany({ where: { closedAt: null }, include, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.initiative.findMany({ where: { closedAt: { not: null } }, include, orderBy: { closedAt: "desc" }, take: 20 }),
    manage ? prisma.person.findMany({ where: { active: true, role: { not: "OBSERVER" } }, select: { slug: true, fullName: true }, orderBy: { sortOrder: "asc" } }) : Promise.resolve([]),
    manage ? prisma.team.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }) : Promise.resolve([]),
    manage
      ? prisma.goal.findMany({ where: { quarter: quarterOf(now), result: "IN_PROGRESS" }, select: { id: true, code: true, title: true, team: { select: { name: true } } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })
      : Promise.resolve([]),
  ]);
  return {
    active: active.map((r) => toView(r, actor, now)),
    closed: closed.map((r) => toView(r, actor, now)),
    canManage: manage,
    softMax: SOFT_MAX,
    people,
    teams,
    goals: goals.map((g) => ({ id: g.id, label: `${g.code ? `${g.code}. ` : ""}${g.title} (${g.team.name})` })),
  };
}

function requireManage(actor: Actor, what: string) {
  if (!canManage(actor)) fail(`${what}: это делают владелец и администраторы в режиме управления`);
}

async function audit(tx: Tx, actor: Actor, action: string, id: string, title: string, after: string) {
  await tx.auditLog.create({ data: { action, actorId: actor.personId, actorName: actor.fullName, entity: "initiative", entityId: id, field: title, after, ip: actor.ip ?? null, via: actor.via ?? null } });
}

export type InitiativeInput = { title: unknown; why?: unknown; owner: unknown; team?: unknown; goal?: unknown; note?: unknown };

async function resolveRefs(tx: Tx, input: InitiativeInput) {
  const title = cleanTitle(input.title) || fail("Назовите инициативу одной мыслью");
  const why = cleanWhy(input.why);
  const owner = (await tx.person.findUnique({ where: { slug: String(input.owner ?? "") } })) ?? fail("Выберите ответственного");
  if (!owner.active) fail(`${owner.fullName} выключен в списке команды`);
  if (owner.role === "OBSERVER") fail("Наблюдатель не может отвечать за инициативу");
  const teamId = String(input.team ?? "") || TOP_TEAM;
  const team = (await tx.team.findUnique({ where: { id: teamId } })) ?? fail("Такой команды нет");
  if (!team.active) fail("Команда выключена");
  const goalId = String(input.goal ?? "") || null;
  if (goalId && !(await tx.goal.findUnique({ where: { id: goalId } }))) fail("Такой цели нет");
  return { title, why, owner, teamId: team.id, goalId };
}

/** Новая инициатива: по умолчанию «Ещё ищем, как сделать» */
export async function createInitiative(actor: Actor, input: InitiativeInput, now = new Date()): Promise<{ id: string; overLimit: boolean }> {
  requireManage(actor, "Новая инициатива");
  return prisma.$transaction(async (tx) => {
    const ref = await resolveRefs(tx, input);
    const note = cleanNote(input.note);
    const last = await tx.initiative.aggregate({ _max: { sortOrder: true }, where: { closedAt: null } });
    const row = await tx.initiative.create({
      data: {
        title: ref.title,
        why: ref.why,
        ownerId: ref.owner.id,
        teamId: ref.teamId,
        goalId: ref.goalId,
        note,
        stateSince: now,
        noteAt: now,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        createdById: actor.personId,
        createdAt: now,
        changes: { create: { kind: "create", toState: "SEARCHING", note: note || null, byId: actor.personId, at: now } },
      },
    });
    await notify(tx, { kind: "INITIATIVE", recipients: [ref.owner.id], actor, subject: initiativeSubject(row.id), text: `Вы ответственный за инициативу «${ref.title}»` }, now);
    await audit(tx, actor, "initiative.create", row.id, ref.title, `ответственный ${ref.owner.fullName}`);
    const count = await tx.initiative.count({ where: { closedAt: null } });
    return { id: row.id, overLimit: count > SOFT_MAX };
  });
}

/** Правка: название, зачем, ответственный, команда, цель. Деление шкалы здесь не меняется */
export async function editInitiative(actor: Actor, id: string, input: InitiativeInput, now = new Date()): Promise<void> {
  requireManage(actor, "Правка инициативы");
  await prisma.$transaction(async (tx) => {
    const cur = (await tx.initiative.findUnique({ where: { id: String(id) }, include: { owner: true } })) ?? fail("Инициативы уже нет");
    const ref = await resolveRefs(tx, input);
    await tx.initiative.update({ where: { id: cur.id }, data: { title: ref.title, why: ref.why, ownerId: ref.owner.id, teamId: ref.teamId, goalId: ref.goalId } });
    const ownerChanged = cur.ownerId !== ref.owner.id;
    await tx.initiativeChange.create({
      data: { initiativeId: cur.id, kind: ownerChanged ? "owner" : "edit", note: ownerChanged ? `Ответственный: ${ref.owner.fullName}` : null, byId: actor.personId, at: now },
    });
    if (ownerChanged) {
      await notify(tx, { kind: "INITIATIVE", recipients: [ref.owner.id], actor, subject: initiativeSubject(cur.id), text: `Вы ответственный за инициативу «${ref.title}»` }, now);
    }
    await audit(tx, actor, "initiative.edit", cur.id, ref.title, ownerChanged ? `ответственный ${cur.owner.fullName}, теперь ${ref.owner.fullName}` : "правка");
  });
}

async function editable(tx: Tx, actor: Actor, id: string) {
  const cur = (await tx.initiative.findUnique({ where: { id: String(id) } })) ?? fail("Инициативы уже нет");
  if (cur.closedAt) fail("Инициатива закрыта: верните её, чтобы менять");
  if (cur.ownerId !== actor.personId && !canManage(actor)) fail("Деление шкалы ставит ответственный за инициативу");
  return cur;
}

/** Сменить деление шкалы. Заметка обязательна: что ещё не ясно или что делаем и когда первый результат */
export async function setInitiativeState(actor: Actor, id: string, state: unknown, note: unknown, now = new Date()): Promise<void> {
  if (!isStateCode(state)) fail("Такого деления шкалы нет");
  const text = cleanNote(note) || fail(state === "doing" ? "Напишите, что делаем и когда первый результат" : "Напишите, что ещё не ясно");
  await prisma.$transaction(async (tx) => {
    // Замок строки: два одновременных нажатия не запишут две смены
    await tx.$queryRaw`SELECT id FROM initiatives WHERE id = ${String(id)} FOR UPDATE`;
    const cur = await editable(tx, actor, String(id));
    const to = STATE_DB[state as StateCode];
    if (cur.state === to) fail(`Инициатива уже в делении «${STATE_LABELS[state as StateCode]}»`);
    await tx.initiative.update({ where: { id: cur.id }, data: { state: to, stateSince: now, note: text, noteAt: now } });
    await tx.initiativeChange.create({ data: { initiativeId: cur.id, kind: "state", fromState: cur.state, toState: to, note: text, byId: actor.personId, at: now } });
    await notify(
      tx,
      { kind: "INITIATIVE", recipients: [cur.createdById, cur.ownerId], actor, subject: initiativeSubject(cur.id), text: `Инициатива «${cur.title}»: ${STATE_LABELS[state as StateCode].toLowerCase()}` },
      now,
    );
    await audit(tx, actor, "initiative.state", cur.id, cur.title, `${STATE_LABELS[STATE_CODE[cur.state]]}, теперь ${STATE_LABELS[state as StateCode]}`);
  });
}

/** Обновить заметку без смены деления: «где сейчас» */
export async function updateInitiativeNote(actor: Actor, id: string, note: unknown, now = new Date()): Promise<void> {
  const text = cleanNote(note) || fail("Напишите одной фразой, что сейчас происходит");
  await prisma.$transaction(async (tx) => {
    const cur = await editable(tx, actor, String(id));
    await tx.initiative.update({ where: { id: cur.id }, data: { note: text, noteAt: now } });
    await tx.initiativeChange.create({ data: { initiativeId: cur.id, kind: "note", note: text, byId: actor.personId, at: now } });
    await audit(tx, actor, "initiative.note", cur.id, cur.title, "заметка обновлена");
  });
}

/** Закрыть: сделали или сняли, итог одной фразой */
export async function closeInitiative(actor: Actor, id: string, result: unknown, note: unknown, now = new Date()): Promise<void> {
  requireManage(actor, "Закрыть инициативу");
  if (!isResultCode(result)) fail("Выберите, чем закончилась инициатива");
  const text = cleanNote(note) || fail("Напишите итог одной фразой");
  await prisma.$transaction(async (tx) => {
    const cur = (await tx.initiative.findUnique({ where: { id: String(id) } })) ?? fail("Инициативы уже нет");
    if (cur.closedAt) fail("Инициатива уже закрыта");
    await tx.initiative.update({ where: { id: cur.id }, data: { result: RESULT_DB[result as ResultCode], resultNote: text, closedAt: now } });
    await tx.initiativeChange.create({ data: { initiativeId: cur.id, kind: "close", note: `${RESULT_LABELS[result as ResultCode]}: ${text}`, byId: actor.personId, at: now } });
    await notify(tx, { kind: "INITIATIVE", recipients: [cur.ownerId], actor, subject: initiativeSubject(cur.id), text: `Инициатива «${cur.title}» закрыта: ${RESULT_LABELS[result as ResultCode].toLowerCase()}` }, now);
    await audit(tx, actor, "initiative.close", cur.id, cur.title, RESULT_LABELS[result as ResultCode]);
  });
}

/** Вернуть закрытую инициативу в работу: деление остаётся прежним */
export async function reopenInitiative(actor: Actor, id: string, now = new Date()): Promise<void> {
  requireManage(actor, "Вернуть инициативу");
  await prisma.$transaction(async (tx) => {
    const cur = (await tx.initiative.findUnique({ where: { id: String(id) } })) ?? fail("Инициативы уже нет");
    if (!cur.closedAt) fail("Инициатива и так открыта");
    await tx.initiative.update({ where: { id: cur.id }, data: { result: null, resultNote: null, closedAt: null, noteAt: now } });
    await tx.initiativeChange.create({ data: { initiativeId: cur.id, kind: "reopen", byId: actor.personId, at: now } });
    await audit(tx, actor, "initiative.reopen", cur.id, cur.title, "возвращена в работу");
  });
}

/** Для повестки встречи: открытые инициативы этих людей, которые долго ищут или давно без новостей */
export async function initiativesForAgenda(ownerIds: string[], now = new Date()) {
  if (!ownerIds.length) return [];
  const rows = await prisma.initiative.findMany({
    where: { closedAt: null, ownerId: { in: ownerIds } },
    select: { id: true, title: true, state: true, stateSince: true, note: true, noteAt: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({ ...r, flags: flagsOf({ state: STATE_CODE[r.state], stateSince: r.stateSince, noteAt: r.noteAt, closed: false }, now) }));
}
