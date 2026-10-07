// Сквозные цели (этап 17): дерево целей квартала от департамента до команд и людей, связь с задачами,
// прогресс снизу вверх, цели в риске, загрузка из таблицы и из вкладок целей Bord только на чтение.
//
// Права:
// - цели видят все люди департамента: так каждый видит, как его цель связана с целью департамента;
//   задачи под целью видны только те, что человек видит и так;
// - цели департамента (топ-команды) заводит и правит режим управления;
// - цели команды заводит и правит руководитель этой команды или команды выше, и режим управления;
// - владелец цели отмечает «в риске» и итог квартала;
// - задачу к цели привязывает тот, кто может её править, ответственный и руководитель команды задачи;
//   цель берётся из команды задачи или из команд выше.

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { GoalResult } from "@/generated/prisma/enums";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { isoFromDbDate, moscowToday } from "@/lib/tasks/dates";
import { diffDays } from "@/domain/dates";
import type { PersonSlug } from "@/domain/types";
import { ancestorsOf, loadScope, loadTeamNodes, scopeOf, subtreeOf, TOP_TEAM, type Scope, type TeamNode } from "@/lib/org/scope";
import { seesTask } from "@/lib/tasks/watch";
import { NameIndex } from "@/lib/bord/names";
import { matchPerson } from "@/lib/org/import";
import { normName } from "@/lib/bord/names";
import { quarterLabel, quarterOf, readGoalsTable, type GoalProblem, type GoalRow } from "./parse";

type Tx = Prisma.TransactionClient;

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

const LIMITS = { title: 300, description: 2000, metric: 500, base: 120, target: 300, risk: 300, code: 20, link: 500, file: 1_000_000 };
export const RESULT_LABELS: Record<GoalResult, string> = { IN_PROGRESS: "Идёт", ACHIEVED: "Достигнута", PARTIAL: "Частично", MISSED: "Не достигнута", DROPPED: "Снята" };
const QUARTER = /^\d{4}-Q[1-4]$/;

export type GoalTask = { number: number; title: string; status: string; owner: string; due: string; overdue: number; done: boolean };

export type GoalNode = {
  id: string;
  quarter: string;
  code: string | null;
  title: string;
  description: string | null;
  metric: string | null;
  base: string | null;
  target: string | null;
  team: { id: string; name: string };
  owner: { slug: PersonSlug; fullName: string } | null;
  parentId: string | null;
  childIds: string[];
  result: GoalResult;
  atRisk: boolean;
  riskNote: string | null;
  /** В риске с учётом задач и целей ниже: почему */
  risk: string | null;
  link: string | null;
  source: string;
  /** Задачи цели и целей ниже: сколько закрыто из скольких, сколько просрочено */
  progress: { done: number; total: number; overdue: number };
  /** Цели ниже: сколько достигнуто */
  below: { achieved: number; total: number };
  /** Задачи самой цели, только видимые человеку */
  tasks: GoalTask[];
  canEdit: boolean;
  canMark: boolean;
};

export type GoalsView = {
  quarter: string;
  quarters: string[];
  goals: GoalNode[];
  /** Корни дерева для показанной области: цели без родителя или с родителем вне выборки */
  roots: string[];
  /** Доля задач без цели по командам области */
  unlinked: { team: string; name: string; open: number; withoutGoal: number; highWithoutGoal: number }[];
  /** Команды, куда человек может завести цель */
  creatable: { id: string; name: string }[];
};

type Who = { personId: string; role: Actor["role"]; management?: Actor["management"]; limited?: boolean };

async function scopeFor(db: Tx | typeof prisma, who: Who): Promise<{ scope: Scope; nodes: TeamNode[] }> {
  const [nodes, functional] = await Promise.all([loadTeamNodes(db), db.person.findMany({ where: { functionalManagerId: who.personId }, select: { id: true } })]);
  return { nodes, scope: scopeOf(nodes, { id: who.personId, role: who.role, limited: who.limited }, functional.map((f) => f.id)) };
}

/** Может ли человек заводить и править цели команды */
function canEditTeam(who: Who, scope: Scope, teamId: string): boolean {
  if (who.role === "OBSERVER") return false;
  if (who.management) return true;
  return teamId !== TOP_TEAM && scope.leads.includes(teamId);
}

/** Все кварталы, где есть цели, плюс текущий */
async function quartersList(): Promise<string[]> {
  const rows = await prisma.goal.findMany({ distinct: ["quarter"], select: { quarter: true } });
  return [...new Set([quarterOf(moscowToday()), ...rows.map((r) => r.quarter)])].sort().reverse();
}

/**
 * Цели квартала для показанной команды (её и команд ниже) и путь к ним сверху: цели команд выше, на которые они
 * работают. team null: весь департамент
 */
export async function goalsView(who: Who, opts: { quarter?: string | null; team?: string | null } = {}): Promise<GoalsView> {
  const quarter = opts.quarter && QUARTER.test(opts.quarter) ? opts.quarter : quarterOf(moscowToday());
  const { scope, nodes } = await scopeFor(prisma, who);
  const today = moscowToday();
  const area = opts.team && nodes.some((n) => n.id === opts.team) ? subtreeOf(nodes, opts.team) : null;
  const all = await prisma.goal.findMany({
    where: { quarter },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { createdAt: "asc" }],
    include: {
      team: { select: { id: true, name: true } },
      owner: { select: { id: true, slug: true, fullName: true } },
      tasks: {
        where: { archivedAt: null },
        select: { number: true, title: true, status: true, due: true, teamId: true, ownerId: true, createdById: true, owner: { select: { fullName: true } }, coExecutors: { select: { personId: true } } },
        orderBy: { due: "asc" },
      },
    },
  });
  const byId = new Map(all.map((g) => [g.id, g]));
  const children = new Map<string, string[]>();
  for (const g of all) if (g.parentId && byId.has(g.parentId)) children.set(g.parentId, [...(children.get(g.parentId) ?? []), g.id]);

  // Область: цели команд области и все их предки, чтобы дерево начиналось с цели департамента, и цели команд выше:
  // на них команда может завести свою цель
  let shown = new Set(all.map((g) => g.id));
  if (area) {
    shown = new Set();
    const above = new Set(ancestorsOf(nodes, opts.team!));
    for (const g of all) if (above.has(g.teamId)) shown.add(g.id);
    for (const g of all) {
      if (!area.includes(g.teamId)) continue;
      let cur: (typeof all)[number] | undefined = g;
      const guard = new Set<string>();
      while (cur && !guard.has(cur.id)) {
        guard.add(cur.id);
        shown.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
  }

  // Прогресс и риск снизу вверх
  const memo = new Map<string, { done: number; total: number; overdue: number; risk: string | null; achieved: number; belowTotal: number }>();
  const roll = (id: string, guard = new Set<string>()): { done: number; total: number; overdue: number; risk: string | null; achieved: number; belowTotal: number } => {
    if (memo.has(id)) return memo.get(id)!;
    const g = byId.get(id)!;
    guard.add(id);
    const counted = g.tasks.filter((t) => t.status !== "CANCELLED" && t.status !== "PROPOSED");
    let done = counted.filter((t) => t.status === "DONE").length;
    let total = counted.length;
    let overdue = counted.filter((t) => (t.status === "IN_PROGRESS" || t.status === "CLARIFY") && diffDays(isoFromDbDate(t.due), today) > 0).length;
    let achieved = 0;
    let belowTotal = 0;
    let childRisk: string | null = null;
    for (const c of children.get(id) ?? []) {
      if (guard.has(c)) continue;
      const r = roll(c, guard);
      const child = byId.get(c)!;
      done += r.done;
      total += r.total;
      overdue += r.overdue;
      if (child.result !== "DROPPED") belowTotal += 1;
      if (child.result === "ACHIEVED") achieved += 1;
      if (r.risk && !childRisk && child.result === "IN_PROGRESS") childRisk = `в риске цель ниже: ${child.title}`;
    }
    const open = counted.filter((t) => t.status === "IN_PROGRESS" || t.status === "CLARIFY").length;
    const ownOverdue = counted.filter((t) => (t.status === "IN_PROGRESS" || t.status === "CLARIFY") && diffDays(isoFromDbDate(t.due), today) > 0).length;
    let risk: string | null = null;
    if (g.result === "IN_PROGRESS") {
      if (g.atRisk) risk = g.riskNote ? `отмечена владельцем: ${g.riskNote}` : "отмечена владельцем";
      else if (open && ownOverdue / open >= 0.3) risk = `просрочено ${ownOverdue} из ${open} задач`;
      else risk = childRisk;
    }
    const r = { done, total, overdue, risk, achieved, belowTotal };
    memo.set(id, r);
    return r;
  };

  const goals: GoalNode[] = all
    .filter((g) => shown.has(g.id))
    .map((g) => {
      const r = roll(g.id);
      return {
        id: g.id,
        quarter: g.quarter,
        code: g.code,
        title: g.title,
        description: g.description,
        metric: g.metric,
        base: g.base,
        target: g.target,
        team: g.team,
        owner: g.owner ? { slug: g.owner.slug as PersonSlug, fullName: g.owner.fullName } : null,
        parentId: g.parentId,
        childIds: (children.get(g.id) ?? []).filter((c) => shown.has(c)),
        result: g.result,
        atRisk: g.atRisk,
        riskNote: g.riskNote,
        risk: r.risk,
        link: g.link,
        source: g.source,
        progress: { done: r.done, total: r.total, overdue: r.overdue },
        below: { achieved: r.achieved, total: r.belowTotal },
        tasks: g.tasks
          .filter((t) => seesTask(scope, t, who.personId))
          .map((t) => ({
            number: t.number,
            title: t.title,
            status: t.status,
            owner: t.owner?.fullName ?? "Все лидеры",
            due: isoFromDbDate(t.due),
            overdue: (t.status === "IN_PROGRESS" || t.status === "CLARIFY") ? Math.max(0, diffDays(isoFromDbDate(t.due), today)) : 0,
            done: t.status === "DONE",
          })),
        canEdit: canEditTeam(who, scope, g.teamId),
        canMark: canEditTeam(who, scope, g.teamId) || (!!g.owner && g.owner.id === who.personId),
      };
    });
  const roots = goals.filter((g) => !g.parentId || !shown.has(g.parentId)).map((g) => g.id);

  // Задачи без цели по командам области: открытые задачи команды и сколько из них без цели
  const teams = (area ?? nodes.filter((n) => n.active).map((n) => n.id)).filter((t) => scope.all || scope.visible.includes(t));
  const open = await prisma.task.groupBy({
    by: ["teamId", "priority"],
    where: { teamId: { in: teams }, archivedAt: null, status: { in: ["IN_PROGRESS", "CLARIFY"] } },
    _count: { _all: true },
  });
  const noGoal = await prisma.task.groupBy({
    by: ["teamId", "priority"],
    where: { teamId: { in: teams }, archivedAt: null, status: { in: ["IN_PROGRESS", "CLARIFY"] }, goalId: null },
    _count: { _all: true },
  });
  const nameOf = new Map(nodes.map((n) => [n.id, n.name]));
  const unlinked = teams
    .map((t) => ({
      team: t,
      name: nameOf.get(t) ?? "Команда",
      open: open.filter((o) => o.teamId === t).reduce((s, o) => s + o._count._all, 0),
      withoutGoal: noGoal.filter((o) => o.teamId === t).reduce((s, o) => s + o._count._all, 0),
      highWithoutGoal: noGoal.filter((o) => o.teamId === t && (o.priority === "CRITICAL" || o.priority === "HIGH")).reduce((s, o) => s + o._count._all, 0),
    }))
    .filter((u) => u.open > 0);

  const creatable = nodes.filter((n) => n.active && canEditTeam(who, scope, n.id)).map((n) => ({ id: n.id, name: n.name }));
  return { quarter, quarters: await quartersList(), goals, roots, unlinked, creatable };
}

// ---------- Правки ----------

export type GoalInput = {
  quarter?: string;
  title?: string;
  description?: string | null;
  metric?: string | null;
  base?: string | null;
  target?: string | null;
  team?: string;
  owner?: string | null;
  parent?: string | null;
  link?: string | null;
  code?: string | null;
};

function text(value: string | null | undefined, max: number, field: string): string | null {
  const v = (value ?? "").replace(/[—–]/g, "-").replace(/\s+/g, " ").trim();
  if (!v) return null;
  if (v.length > max) fail(`${field}: не длиннее ${max} знаков`);
  return v;
}

function link(value: string | null | undefined): string | null {
  const v = text(value, LIMITS.link, "Ссылка");
  if (v && !/^https?:\/\//i.test(v)) fail("Ссылка на борд должна начинаться с https://");
  return v;
}

async function audit(tx: Tx, actor: Actor, goalId: string, field: string, before?: string | null, after?: string | null, action = "goal.update") {
  await tx.auditLog.create({
    data: { action, actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "goal", entityId: goalId, field, before: before ?? undefined, after: after ?? undefined, ip: actor.ip ?? null, via: actor.via ?? null },
  });
}

/** Цель выше: того же квартала, из той же команды или команды выше, без петли */
async function checkParent(tx: Tx, nodes: TeamNode[], parentId: string, teamId: string, quarter: string, selfId?: string) {
  const parent = await tx.goal.findUnique({ where: { id: parentId } });
  if (!parent) return fail("Цели выше нет");
  if (parent.quarter !== quarter) fail(`Цель выше из другого квартала: ${quarterLabel(parent.quarter)}`);
  const up = [teamId, ...ancestorsOf(nodes, teamId)];
  if (!up.includes(parent.teamId)) fail("Цель выше берётся из своей команды или команды выше");
  if (selfId) {
    let cur: string | null = parent.id;
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      if (cur === selfId) fail("Цель не может стоять ниже самой себя");
      guard.add(cur);
      cur = (await tx.goal.findUnique({ where: { id: cur }, select: { parentId: true } }))?.parentId ?? null;
    }
  }
  return parent;
}

export async function createGoal(actor: Actor, input: GoalInput): Promise<{ id: string }> {
  const quarter = input.quarter && QUARTER.test(input.quarter) ? input.quarter : quarterOf(moscowToday());
  const title = text(input.title, LIMITS.title, "Цель") ?? fail("Напишите цель одной мыслью");
  return prisma.$transaction(async (tx) => {
    const { scope, nodes } = await scopeFor(tx, { personId: actor.personId, role: actor.role, management: actor.management, limited: actor.via === "TEAM" && !actor.management });
    const teamId = input.team ?? fail("Выберите команду цели");
    const team = nodes.find((n) => n.id === teamId && n.active) ?? fail("Такой команды нет");
    if (!canEditTeam({ personId: actor.personId, role: actor.role, management: actor.management }, scope, team.id)) {
      fail(team.id === TOP_TEAM ? "Цели департамента заводят владелец и администраторы в режиме управления" : "Цели команды заводит её руководитель или руководитель выше");
    }
    const owner = input.owner ? ((await tx.person.findUnique({ where: { slug: input.owner } })) ?? fail("Такого человека нет")) : null;
    if (owner && !owner.active) fail(`${owner.fullName} выключен`);
    if (input.parent) await checkParent(tx, nodes, input.parent, team.id, quarter);
    const code = text(input.code, LIMITS.code, "Номер цели");
    if (code && (await tx.goal.findFirst({ where: { quarter, teamId: team.id, code } }))) fail(`Цель ${code} за ${quarterLabel(quarter)} в этой команде уже есть`);
    const count = await tx.goal.count({ where: { quarter, teamId: team.id } });
    const goal = await tx.goal.create({
      data: {
        quarter,
        code,
        title,
        description: text(input.description, LIMITS.description, "Описание"),
        metric: text(input.metric, LIMITS.metric, "Метрика"),
        base: text(input.base, LIMITS.base, "База"),
        target: text(input.target, LIMITS.target, "Целевое значение"),
        teamId: team.id,
        ownerId: owner?.id ?? team.leaderId ?? null,
        parentId: input.parent ?? null,
        link: link(input.link),
        sortOrder: (count + 1) * 10,
        createdById: actor.personId,
      },
    });
    await audit(tx, actor, goal.id, "Цель заведена", null, `${quarterLabel(quarter)}, ${team.name}: ${title}`, "goal.create");
    return { id: goal.id };
  });
}

export async function updateGoal(actor: Actor, id: string, input: GoalInput & { atRisk?: boolean; riskNote?: string | null; result?: GoalResult }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const goal = (await tx.goal.findUnique({ where: { id }, include: { team: true, owner: true, parent: true } })) ?? fail("Цели уже нет");
    const { scope, nodes } = await scopeFor(tx, { personId: actor.personId, role: actor.role, management: actor.management, limited: actor.via === "TEAM" && !actor.management });
    const who = { personId: actor.personId, role: actor.role, management: actor.management };
    const editor = canEditTeam(who, scope, goal.teamId);
    const marker = editor || goal.ownerId === actor.personId;
    const fields = Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined);
    const markOnly = fields.every((k) => k === "atRisk" || k === "riskNote" || k === "result");
    if (!(markOnly ? marker : editor)) fail(markOnly ? "Отмечают цель её владелец и руководитель команды" : "Цель правят руководитель её команды или команды выше и режим управления");
    const data: Prisma.GoalUncheckedUpdateInput = {};
    const changes: [string, string | null, string | null][] = [];
    const set = <K extends keyof Prisma.GoalUncheckedUpdateInput>(key: K, field: string, before: string | null, after: string | null, value: Prisma.GoalUncheckedUpdateInput[K]) => {
      if ((before ?? null) === (after ?? null)) return;
      data[key] = value;
      changes.push([field, before, after]);
    };
    if (input.title !== undefined) {
      const v = text(input.title, LIMITS.title, "Цель") ?? fail("Напишите цель одной мыслью");
      set("title", "Цель", goal.title, v, v);
    }
    if (input.description !== undefined) set("description", "Описание", goal.description, text(input.description, LIMITS.description, "Описание"), text(input.description, LIMITS.description, "Описание"));
    if (input.metric !== undefined) set("metric", "Метрика", goal.metric, text(input.metric, LIMITS.metric, "Метрика"), text(input.metric, LIMITS.metric, "Метрика"));
    if (input.base !== undefined) set("base", "База", goal.base, text(input.base, LIMITS.base, "База"), text(input.base, LIMITS.base, "База"));
    if (input.target !== undefined) set("target", "Целевое значение", goal.target, text(input.target, LIMITS.target, "Целевое значение"), text(input.target, LIMITS.target, "Целевое значение"));
    if (input.link !== undefined) set("link", "Ссылка на борд", goal.link, link(input.link), link(input.link));
    if (input.code !== undefined) {
      const code = text(input.code, LIMITS.code, "Номер цели");
      if (code && code !== goal.code && (await tx.goal.findFirst({ where: { quarter: goal.quarter, teamId: goal.teamId, code, id: { not: id } } }))) fail(`Цель ${code} в этой команде уже есть`);
      set("code", "Номер", goal.code, code, code);
    }
    if (input.owner !== undefined) {
      const owner = input.owner ? ((await tx.person.findUnique({ where: { slug: input.owner } })) ?? fail("Такого человека нет")) : null;
      set("ownerId", "Владелец", goal.owner?.fullName ?? null, owner?.fullName ?? null, owner?.id ?? null);
    }
    if (input.parent !== undefined) {
      const parent = input.parent ? await checkParent(tx, nodes, input.parent, goal.teamId, goal.quarter, goal.id) : null;
      set("parentId", "Цель выше", goal.parent?.title ?? null, parent?.title ?? null, parent?.id ?? null);
    }
    if (input.atRisk !== undefined || input.riskNote !== undefined) {
      const atRisk = input.atRisk ?? goal.atRisk;
      const note = atRisk ? text(input.riskNote ?? goal.riskNote, LIMITS.risk, "Почему в риске") : null;
      if (atRisk && !note) fail("Напишите, почему цель в риске и какая помощь нужна");
      set("atRisk", "В риске", goal.atRisk ? `да: ${goal.riskNote ?? ""}` : "нет", atRisk ? `да: ${note}` : "нет", atRisk);
      if (atRisk !== goal.atRisk || note !== goal.riskNote) data.riskNote = note;
    }
    if (input.result !== undefined) set("result", "Итог квартала", RESULT_LABELS[goal.result], RESULT_LABELS[input.result], input.result);
    if (!changes.length && data.riskNote === undefined) fail("Ничего не изменилось");
    await tx.goal.update({ where: { id }, data });
    for (const [field, before, after] of changes) await audit(tx, actor, id, field, before, after);
  });
}

/** Удалить можно только пустую цель: без задач и целей ниже. Иначе цель снимают итогом «Снята» */
export async function deleteGoal(actor: Actor, id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const goal = (await tx.goal.findUnique({ where: { id }, include: { _count: { select: { tasks: true, children: true } } } })) ?? fail("Цели уже нет");
    const { scope } = await scopeFor(tx, { personId: actor.personId, role: actor.role, management: actor.management });
    if (!canEditTeam({ personId: actor.personId, role: actor.role, management: actor.management }, scope, goal.teamId)) fail("Цель удаляет руководитель её команды или режим управления");
    if (goal._count.tasks || goal._count.children) fail("У цели есть задачи или цели ниже: удалить нельзя, поставьте итог «Снята»");
    await tx.goal.delete({ where: { id } });
    await audit(tx, actor, id, "Цель удалена", goal.title, null, "goal.delete");
  });
}

/** Цели, к которым можно привязать задачу: квартал срока задачи и текущий, цели команды задачи и команд выше */
export async function goalOptions(who: Who, number: number): Promise<{ id: string; label: string }[]> {
  const task = await prisma.task.findUnique({ where: { number }, select: { teamId: true, due: true, goalId: true } });
  if (!task) return [];
  const nodes = await loadTeamNodes(prisma);
  const teams = [task.teamId, ...ancestorsOf(nodes, task.teamId)];
  const quarters = [...new Set([quarterOf(moscowToday()), quarterOf(isoFromDbDate(task.due))])];
  const goals = await prisma.goal.findMany({
    where: { OR: [{ teamId: { in: teams }, quarter: { in: quarters }, result: { not: "DROPPED" } }, ...(task.goalId ? [{ id: task.goalId }] : [])] },
    include: { team: { select: { name: true } } },
    orderBy: [{ quarter: "desc" }, { sortOrder: "asc" }],
  });
  void who;
  return goals.map((g) => ({ id: g.id, label: `${quarterLabel(g.quarter)}, ${g.team.name}: ${g.code ? `${g.code}. ` : ""}${g.title}` }));
}

/** Привязать задачу к цели или отвязать */
export async function linkTaskGoal(actor: Actor, number: number, goalId: string | null): Promise<{ goal: string | null }> {
  if (actor.role === "OBSERVER") fail("Наблюдатель только смотрит");
  return prisma.$transaction(async (tx) => {
    const scope = await loadScope(tx, { id: actor.personId, role: actor.role, limited: actor.via === "TEAM" && !actor.management });
    const task = await tx.task.findUnique({ where: { number }, include: { coExecutors: { select: { personId: true } }, goal: true } });
    if (!task || !seesTask(scope, task, actor.personId)) return fail(`Задачи ${number} нет`);
    if (task.archivedAt) fail(`Задача ${number} в архиве`);
    const allowed = !!actor.management || scope.leads.includes(task.teamId) || task.ownerId === actor.personId || task.createdById === actor.personId;
    if (!allowed) fail("Цель задаче выбирают ответственный, тот, кто поставил задачу, руководитель команды и режим управления");
    let goal: { id: string; title: string } | null = null;
    if (goalId) {
      const g = (await tx.goal.findUnique({ where: { id: goalId } })) ?? fail("Такой цели нет");
      const nodes = await loadTeamNodes(tx);
      if (![task.teamId, ...ancestorsOf(nodes, task.teamId)].includes(g.teamId)) fail("Задачу привязывают к цели своей команды или команды выше");
      if (g.result === "DROPPED") fail("Цель снята: выберите другую");
      goal = g;
    }
    if ((task.goalId ?? null) === (goal?.id ?? null)) fail("Цель уже такая");
    await tx.task.update({ where: { id: task.id }, data: { goalId: goal?.id ?? null } });
    await tx.auditLog.create({
      data: { action: "task.update", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "task", entityId: String(number), field: "Цель", before: task.goal?.title ?? undefined, after: goal?.title ?? undefined, ip: actor.ip ?? null, via: actor.via ?? null },
    });
    return { goal: goal?.title ?? null };
  });
}

// ---------- Загрузка из таблицы и из Bord ----------

export type GoalsPlan = {
  add: { line: number; quarter: string; team: string; title: string; code: string }[];
  change: { line: number; title: string; changes: string[] }[];
  same: number;
  problems: GoalProblem[];
  rows: (GoalRow & { teamId: string; ownerId: string | null; existingId: string | null })[];
};

/**
 * Что даст загрузка таблицы целей. Цель находится повторно по кварталу, команде и номеру, без номера по названию.
 * Команда: из колонки «Команда», иначе выбранная. Владелец по ФИО. Цель выше по номеру в том же квартале
 */
export async function planGoals(actor: Actor, input: string | string[][], opts: { team: string; quarter?: string | null }): Promise<GoalsPlan> {
  if (typeof input === "string" && input.length > LIMITS.file) fail("Файл больше 1 МБ: выгрузите только вкладку целей");
  const quarter = opts.quarter && QUARTER.test(opts.quarter) ? opts.quarter : quarterOf(moscowToday());
  const { rows, problems } = readGoalsTable(input, quarter);
  const { scope, nodes } = await scopeFor(prisma, { personId: actor.personId, role: actor.role, management: actor.management, limited: actor.via === "TEAM" && !actor.management });
  const who = { personId: actor.personId, role: actor.role, management: actor.management };
  if (!nodes.some((n) => n.id === opts.team)) fail("Выберите команду для целей без колонки «Команда»");
  const teamByName = new Map(nodes.filter((n) => n.active).map((n) => [normName(n.name), n]));
  const people = await prisma.person.findMany({ where: { active: true }, select: { id: true, fullName: true, shortName: true, slug: true } });
  const index = new NameIndex(people);
  const existing = await prisma.goal.findMany({ where: { quarter: { in: [...new Set(rows.map((r) => r.quarter))] } } });
  const out: GoalsPlan = { add: [], change: [], same: 0, problems: [...problems], rows: [] };
  for (const r of rows) {
    const team = r.team ? teamByName.get(normName(r.team)) : nodes.find((n) => n.id === opts.team);
    if (!team) {
      out.problems.push({ line: r.line, text: `Команда «${r.team}» не найдена: напишите, как на странице «Структура»` });
      continue;
    }
    if (!canEditTeam(who, scope, team.id)) {
      out.problems.push({ line: r.line, text: `Цели команды «${team.name}» вы не заводите` });
      continue;
    }
    let ownerId: string | null = null;
    if (r.owner) {
      const hit = matchPerson(index, people, r.owner);
      if (!hit.person) out.problems.push({ line: r.line, text: `Владелец «${r.owner}» ${hit.ambiguous ? "похож на нескольких людей" : "не найден"}` });
      else ownerId = hit.person.id;
    }
    const found = existing.find((g) => g.quarter === r.quarter && g.teamId === team.id && (r.code ? g.code === r.code : normName(g.title) === normName(r.title)));
    out.rows.push({ ...r, teamId: team.id, ownerId, existingId: found?.id ?? null });
    if (!found) out.add.push({ line: r.line, quarter: r.quarter, team: team.name, title: r.title, code: r.code });
    else {
      const changes: string[] = [];
      const cmp = (label: string, a: string | null, b: string) => {
        if ((a ?? "") !== b && b) changes.push(`${label}: ${a || "пусто"}, станет ${b}`);
      };
      cmp("цель", found.title, r.title);
      cmp("метрика", found.metric, r.metric);
      cmp("база", found.base, r.base);
      cmp("целевое", found.target, r.target);
      if (r.result !== "IN_PROGRESS" && r.result !== found.result) changes.push(`итог: ${RESULT_LABELS[found.result]}, станет ${RESULT_LABELS[r.result]}`);
      if (changes.length) out.change.push({ line: r.line, title: r.title, changes });
      else out.same += 1;
    }
  }
  // Цель выше по номеру: из файла или уже заведённая, в том же квартале
  for (const r of out.rows) {
    if (!r.parent) continue;
    const inFile = out.rows.some((x) => x.quarter === r.quarter && x.code === r.parent);
    const inBase = existing.some((g) => g.quarter === r.quarter && g.code === r.parent);
    // Сквозные цели вида S1-S12 бывают и не заведены: тогда связь просто не ставим, это не ошибка
    if (!inFile && !inBase && !/^s\d+$/i.test(r.parent)) out.problems.push({ line: r.line, text: `Цель выше «${r.parent}» не найдена ни в файле, ни в ресурсе` });
  }
  return out;
}

export async function applyGoals(actor: Actor, input: string | string[][], opts: { team: string; quarter?: string | null; source?: string }): Promise<{ added: number; changed: number }> {
  const plan = await planGoals(actor, input, opts);
  if (plan.problems.length) fail(`Цели не загрузить, база не тронута. Исправьте: ${plan.problems.slice(0, 5).map((p) => `строка ${p.line}: ${p.text}`).join("; ")}`);
  return prisma.$transaction(
    async (tx) => {
      const nodes = await loadTeamNodes(tx);
      const idOf = new Map<string, string>();
      let added = 0;
      let changed = 0;
      for (const r of plan.rows) {
        const data = {
          title: r.title,
          description: r.description || null,
          metric: r.metric || null,
          base: r.base || null,
          target: r.target || null,
          link: r.link || null,
          ...(r.ownerId ? { ownerId: r.ownerId } : {}),
          ...(r.result !== "IN_PROGRESS" ? { result: r.result as GoalResult } : {}),
        };
        let id = r.existingId;
        if (id) {
          const before = await tx.goal.findUniqueOrThrow({ where: { id } });
          const differs = (["title", "metric", "base", "target"] as const).some((k) => (data[k] ?? null) !== (before[k] ?? null) && data[k]) || (data.result && data.result !== before.result);
          if (differs) {
            await tx.goal.update({ where: { id }, data });
            await audit(tx, actor, id, "Цель обновлена из таблицы", before.title, r.title);
            changed += 1;
          }
        } else {
          const team = nodes.find((n) => n.id === r.teamId)!;
          const count = await tx.goal.count({ where: { quarter: r.quarter, teamId: r.teamId } });
          const created = await tx.goal.create({
            data: { ...data, quarter: r.quarter, code: r.code || null, teamId: r.teamId, ownerId: r.ownerId ?? team.leaderId ?? null, source: opts.source ?? "import", sortOrder: (count + 1) * 10, createdById: actor.personId },
          });
          id = created.id;
          added += 1;
          await audit(tx, actor, id, "Цель заведена из таблицы", null, `${quarterLabel(r.quarter)}, ${team.name}: ${r.title}`, "goal.create");
        }
        if (r.code) idOf.set(`${r.quarter}/${r.code}`, id!);
      }
      // Связи с целью выше: после того, как все цели заведены
      for (const r of plan.rows) {
        if (!r.parent) continue;
        const id = r.code ? idOf.get(`${r.quarter}/${r.code}`) : (await tx.goal.findFirst({ where: { quarter: r.quarter, teamId: r.teamId, title: r.title } }))?.id;
        const parentId = idOf.get(`${r.quarter}/${r.parent}`) ?? (await tx.goal.findFirst({ where: { quarter: r.quarter, code: r.parent }, orderBy: { createdAt: "asc" } }))?.id;
        if (!id || !parentId || parentId === id) continue;
        const parent = await tx.goal.findUniqueOrThrow({ where: { id: parentId } });
        const up = [r.teamId, ...ancestorsOf(nodes, r.teamId)];
        if (!up.includes(parent.teamId)) continue;
        await tx.goal.update({ where: { id }, data: { parentId } });
      }
      await tx.auditLog.create({
        data: { action: "goal.import", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "goal", entityId: opts.source ?? "import", field: "Цели загружены", after: `новых ${added}, изменено ${changed}` },
      });
      return { added, changed };
    },
    { timeout: 60_000 },
  );
}
