// Импорт наполнения (этап 67). Владелец при личном входе в режиме управления загружает пакет: сначала предпросмотр
// (что добавится, обновится, пропустится, кого и каких команд не нашли), потом загрузка одной транзакцией.
//
// Правила:
// - загрузка только добавляет и обновляет записи с тем же внешним ключом, ничего не удаляет;
// - задачи ставятся через службу задач с её правилами (автор: тот, кто загружает), цели через службу целей,
//   связь задачи с целью через поле задачи и ту же проверку, что в карточке;
// - повторная загрузка того же пакета ничего не меняет: ключ и отпечаток записи совпадают;
// - поле, которое в ресурсе поменяли после прошлой загрузки, загрузка не трогает и говорит об этом;
// - любая ошибка правила откатывает всё: база остаётся как была, владелец видит запись и причину.

import { prisma } from "@/lib/db";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { TOP_TEAM, loadTeamNodes, type TeamNode } from "@/lib/org/scope";
import { NameIndex, normName } from "@/lib/bord/names";
import { TaskRuleError, changeStatus, createTaskIn, editTask, transferDue, updateWhere, type Actor } from "@/lib/tasks/service";
import { createGoal, linkTaskGoal, updateGoal } from "@/lib/goals/service";
import { goalFits } from "@/lib/goals/personal";
import { quarterOf } from "@/lib/goals/parse";
import { dbDate, isoFromDbDate, moscowToday } from "@/lib/tasks/dates";
import { statusCode } from "@/lib/tasks/codes";
import { formatLong } from "@/domain/dates";
import { recordHash, type ContentPackage, type GoalRef, type PackageDecision, type PackageGoal, type PackageLink, type PackageTask, type TaskRef } from "./package";

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

export const IMPORT_ONLY = "Наполнение загружает владелец при личном входе в режиме управления";
export const ALL_LEADERS_NAME = "Все лидеры";
/** Причина переноса срока, когда пакет поменял срок задачи после прошлой загрузки */
export const IMPORT_TRANSFER_REASON = "Срок обновлён из пакета наполнения";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export function canImportContent(actor: Pick<Actor, "role" | "management" | "via">): boolean {
  return actor.role === "OWNER" && actor.management === "OWNER" && !!actor.via && actor.via !== "TEAM";
}

export type ImportCounts = { add: number; update: number; skip: number };
export type ImportLine = { what: string; text: string };
export type ImportPreview = {
  title: string | null;
  tasks: ImportCounts;
  decisions: ImportCounts;
  goals: ImportCounts;
  links: ImportCounts;
  /** ФИО из пакета, которых нет в ресурсе или которые выключены */
  missingPeople: string[];
  /** Команды из пакета, которых нет в ресурсе */
  missingTeams: string[];
  /** Что пропустится и почему, и что обновится не целиком */
  notes: ImportLine[];
  /** Сколько человек узнают о новых для них открытых задачах в «Мне» */
  notified: number;
};

type Kind = "task" | "decision" | "goal" | "link";
type KeyRow = { kind: string; key: string; entityId: string; hash: string; payload: Prisma.JsonValue };

/** Справочники для сопоставления: люди, команды, направления, уже загруженные ключи */
type Ctx = {
  db: Db;
  actor: Actor;
  today: string;
  people: { id: string; slug: string; fullName: string; shortName: string; active: boolean }[];
  index: NameIndex;
  nodes: TeamNode[];
  directions: Set<string>;
  keys: Map<string, KeyRow>;
  missingPeople: Set<string>;
  missingTeams: Set<string>;
  notes: ImportLine[];
};

async function context(db: Db, actor: Actor): Promise<Ctx> {
  const [people, nodes, directions, keys] = await Promise.all([
    db.person.findMany({ select: { id: true, slug: true, fullName: true, shortName: true, active: true } }),
    loadTeamNodes(db),
    db.dictionaryItem.findMany({ where: { kind: "DIRECTION", active: true }, select: { code: true } }),
    db.contentImportKey.findMany(),
  ]);
  return {
    db,
    actor,
    today: moscowToday(),
    people,
    index: new NameIndex(people.filter((p) => p.active)),
    nodes,
    directions: new Set(directions.map((d) => d.code)),
    keys: new Map(keys.map((k) => [`${k.kind}/${k.key}`, k])),
    missingPeople: new Set(),
    missingTeams: new Set(),
    notes: [],
  };
}

/** Человек по ФИО как в ресурсе. Выключенный и неоднозначный считаются ненайденными */
function personOf(ctx: Ctx, name: string): Ctx["people"][number] | null {
  const exact = ctx.people.find((p) => normName(p.fullName) === normName(name));
  if (exact) {
    if (!exact.active) ctx.missingPeople.add(`${name} (выключен)`);
    return exact.active ? exact : null;
  }
  const found = ctx.index.find(name);
  const p = found.person ? ctx.people.find((x) => x.id === found.person!.id) : null;
  if (!p) ctx.missingPeople.add(found.ambiguous ? `${name} (несколько похожих)` : name);
  return p ?? null;
}

function teamByName(ctx: Ctx, name: string): TeamNode | null {
  const n = normName(name);
  const team = ctx.nodes.find((t) => t.active && (t.id === name || normName(t.name) === n)) ?? (n === "top" || n === "топ-команда" ? ctx.nodes.find((t) => t.id === TOP_TEAM) : undefined);
  if (!team) ctx.missingTeams.add(name);
  return team ?? null;
}

/** Команда человека, если в пакете её нет: топ-команда, если он в ней; иначе та, которой руководит; иначе первая его */
function teamOfPerson(ctx: Ctx, personId: string, preferTop: boolean): TeamNode | null {
  const active = ctx.nodes.filter((t) => t.active);
  const top = active.find((t) => t.id === TOP_TEAM && (t.leaderId === personId || t.members.includes(personId)));
  const led = active.find((t) => t.leaderId === personId && t.id !== TOP_TEAM);
  const member = active.find((t) => t.members.includes(personId));
  return (preferTop ? (top ?? led ?? member) : (led ?? top ?? member)) ?? null;
}

const key = (kind: Kind, k: string) => `${kind}/${k}`;
const asRecord = (v: Prisma.JsonValue | undefined): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---------- План ----------

type GoalPlan = { g: PackageGoal; action: "add" | "update" | "skip" | "match"; teamId?: string; ownerSlug?: string | null; ownerId?: string | null; existingId?: string; reason?: string };
type TaskPlan = {
  t: PackageTask;
  action: "add" | "update" | "skip";
  teamId?: string;
  owner?: string;
  ownerId?: string | null;
  co?: { slug: string; id: string }[];
  number?: number;
  reason?: string;
};
type DecisionPlan = { d: PackageDecision; action: "add" | "update" | "skip"; teamId?: string; ownerId?: string | null; existingId?: string; reason?: string };
type LinkPlan = { l: PackageLink; action: "add" | "update" | "skip"; reason?: string };

type Plan = { goals: GoalPlan[]; tasks: TaskPlan[]; decisions: DecisionPlan[]; links: LinkPlan[] };

async function planGoals(ctx: Ctx, pkg: ContentPackage): Promise<GoalPlan[]> {
  const out: GoalPlan[] = [];
  for (const g of pkg.goals) {
    const owner = g.owner ? personOf(ctx, g.owner) : null;
    if (g.owner && !owner) {
      out.push({ g, action: "skip", reason: `владелец «${g.owner}» не найден в ресурсе` });
      continue;
    }
    const team = g.team ? teamByName(ctx, g.team) : owner ? teamOfPerson(ctx, owner.id, false) : null;
    if (!team) {
      out.push({ g, action: "skip", reason: g.team ? `команды «${g.team}» нет в ресурсе` : `у ${g.owner} нет команды в ресурсе` });
      continue;
    }
    const known = ctx.keys.get(key("goal", g.key));
    if (known) {
      const exists = await ctx.db.goal.findUnique({ where: { id: known.entityId }, select: { id: true } });
      if (!exists) out.push({ g, action: "skip", reason: "цель удалили в ресурсе, загрузка её не возвращает" });
      else if (known.hash === recordHash(g)) out.push({ g, action: "skip", reason: "без изменений" });
      else out.push({ g, action: "update", teamId: team.id, ownerSlug: owner?.slug ?? null, ownerId: owner?.id ?? null, existingId: known.entityId });
      continue;
    }
    // Цель с тем же номером уже есть в команде (например, из борда лидера): ключ привязывается к ней, пустые поля
    // заполняются, заполненные в ресурсе не трогаются
    const byCode = g.code ? await ctx.db.goal.findFirst({ where: { quarter: g.quarter, teamId: team.id, code: g.code }, select: { id: true } }) : null;
    if (byCode) out.push({ g, action: "match", teamId: team.id, ownerSlug: owner?.slug ?? null, ownerId: owner?.id ?? null, existingId: byCode.id });
    else out.push({ g, action: "add", teamId: team.id, ownerSlug: owner?.slug ?? null, ownerId: owner?.id ?? null });
  }
  return out;
}

async function planTasks(ctx: Ctx, pkg: ContentPackage): Promise<TaskPlan[]> {
  const out: TaskPlan[] = [];
  for (const t of pkg.tasks) {
    const all = normName(t.owner) === normName(ALL_LEADERS_NAME);
    const owner = all ? null : personOf(ctx, t.owner);
    if (!all && !owner) {
      out.push({ t, action: "skip", reason: `ответственный «${t.owner}» не найден в ресурсе` });
      continue;
    }
    if (!ctx.directions.has(t.direction)) {
      out.push({ t, action: "skip", reason: `направления «${t.direction}» нет в справочнике` });
      continue;
    }
    const team = t.team ? teamByName(ctx, t.team) : all ? (ctx.nodes.find((n) => n.id === TOP_TEAM) ?? null) : teamOfPerson(ctx, owner!.id, true);
    if (!team) {
      out.push({ t, action: "skip", reason: t.team ? `команды «${t.team}» нет в ресурсе` : `у ${t.owner} нет команды в ресурсе` });
      continue;
    }
    if (all && team.id !== TOP_TEAM) {
      out.push({ t, action: "skip", reason: "«Все лидеры» бывают только у задач топ-команды" });
      continue;
    }
    const co: { slug: string; id: string }[] = [];
    for (const name of t.coExecutors) {
      const p = personOf(ctx, name);
      if (p && p.id !== owner?.id) co.push({ slug: p.slug, id: p.id });
      else if (!p) ctx.notes.push({ what: `Задача «${t.title}»`, text: `соисполнитель «${name}» не найден, задача загрузится без него` });
    }
    const base = { t, teamId: team.id, owner: all ? "all" : owner!.slug, ownerId: owner?.id ?? null, co };
    const known = ctx.keys.get(key("task", t.key));
    if (known) {
      const row = await ctx.db.task.findUnique({ where: { id: known.entityId }, select: { number: true, archivedAt: true } });
      if (!row) out.push({ ...base, action: "skip", reason: "задачи с этим ключом больше нет в ресурсе" });
      else if (known.hash === recordHash(t)) out.push({ ...base, action: "skip", number: row.number, reason: "без изменений" });
      else if (row.archivedAt) out.push({ ...base, action: "skip", number: row.number, reason: `задача ${row.number} в архиве, загрузка её не правит` });
      else out.push({ ...base, action: "update", number: row.number });
      continue;
    }
    out.push({ ...base, action: "add" });
  }
  return out;
}

async function planDecisions(ctx: Ctx, pkg: ContentPackage): Promise<DecisionPlan[]> {
  const out: DecisionPlan[] = [];
  for (const d of pkg.decisions) {
    const owner = d.owner ? personOf(ctx, d.owner) : null;
    if (d.owner && !owner) ctx.notes.push({ what: `Решение «${short(d.text)}»`, text: `владелец «${d.owner}» не найден, решение загрузится без владельца` });
    const team = d.team ? teamByName(ctx, d.team) : (ctx.nodes.find((n) => n.id === TOP_TEAM) ?? null);
    if (!team) {
      out.push({ d, action: "skip", reason: `команды «${d.team}» нет в ресурсе` });
      continue;
    }
    const known = ctx.keys.get(key("decision", d.key));
    if (known) {
      const exists = await ctx.db.decision.findUnique({ where: { id: known.entityId }, select: { id: true } });
      if (!exists) out.push({ d, action: "skip", reason: "решение удалили в ресурсе, загрузка его не возвращает" });
      else if (known.hash === recordHash(d)) out.push({ d, action: "skip", reason: "без изменений" });
      else out.push({ d, action: "update", teamId: team.id, ownerId: owner?.id ?? null, existingId: known.entityId });
      continue;
    }
    out.push({ d, action: "add", teamId: team.id, ownerId: owner?.id ?? null });
  }
  return out;
}

/** Задача связи: из пакета (по ключу) или уже в ресурсе (по номеру). Для новой задачи из пакета берём её план */
function linkTaskOf(ctx: Ctx, ref: TaskRef, tasks: TaskPlan[]): { plan?: TaskPlan; number?: number } {
  if ("number" in ref) return { number: ref.number };
  const plan = tasks.find((p) => p.t.key === ref.key);
  return { plan, number: plan?.number };
}

async function goalOf(ctx: Ctx, ref: GoalRef, goals: GoalPlan[], quarters: string[]): Promise<{ id: string | null; plan?: GoalPlan; teamId?: string; ownerId?: string | null; source?: string; quarter?: string; ambiguous?: boolean }> {
  if ("key" in ref) {
    const plan = goals.find((p) => p.g.key === ref.key);
    if (!plan) return { id: null };
    const known = ctx.keys.get(key("goal", ref.key));
    const id = plan.existingId ?? known?.entityId ?? null;
    const g = id ? await ctx.db.goal.findUnique({ where: { id }, select: { id: true, teamId: true, ownerId: true, source: true, quarter: true } }) : null;
    return { id, plan, teamId: g?.teamId ?? plan.teamId, ownerId: g?.ownerId ?? plan.ownerId ?? null, source: g?.source ?? "manual", quarter: g?.quarter ?? plan.g.quarter };
  }
  const found = await ctx.db.goal.findMany({ where: { code: ref.code, quarter: { in: quarters } }, select: { id: true, teamId: true, ownerId: true, source: true, quarter: true } });
  if (found.length !== 1) return { id: null, ambiguous: found.length > 1 };
  const g = found[0]!;
  return { id: g.id, teamId: g.teamId, ownerId: g.ownerId, source: g.source, quarter: g.quarter };
}

async function planLinks(ctx: Ctx, pkg: ContentPackage, tasks: TaskPlan[], goals: GoalPlan[]): Promise<LinkPlan[]> {
  const out: LinkPlan[] = [];
  for (const l of pkg.links) {
    const known = ctx.keys.get(key("link", l.key));
    if (known && known.hash === recordHash(l)) {
      out.push({ l, action: "skip", reason: "без изменений" });
      continue;
    }
    const tRef = linkTaskOf(ctx, l.task, tasks);
    if (tRef.plan && tRef.plan.action === "skip" && !tRef.plan.number) {
      out.push({ l, action: "skip", reason: `задача «${tRef.plan.t.title}» не загружается: ${tRef.plan.reason}` });
      continue;
    }
    // Задача: новая из пакета (команда и люди из плана) или уже в ресурсе
    const row = tRef.number ? await ctx.db.task.findUnique({ where: { number: tRef.number }, select: { teamId: true, ownerId: true, due: true, goalId: true, archivedAt: true, coExecutors: { select: { personId: true } } } }) : null;
    if (tRef.number && !row) {
      out.push({ l, action: "skip", reason: `задачи ${tRef.number} нет в ресурсе` });
      continue;
    }
    if (row?.archivedAt) {
      out.push({ l, action: "skip", reason: `задача ${tRef.number} в архиве` });
      continue;
    }
    const due = row ? isoFromDbDate(row.due) : tRef.plan!.t.due;
    const goal = await goalOf(ctx, l.goal, goals, [quarterOf(ctx.today), quarterOf(due)]);
    if (goal.plan && goal.plan.action === "skip" && !goal.id) {
      out.push({ l, action: "skip", reason: `цель «${goal.plan.g.title}» не загружается: ${goal.plan.reason}` });
      continue;
    }
    if (!goal.id && !goal.plan) {
      out.push({ l, action: "skip", reason: "code" in l.goal ? (goal.ambiguous ? `цель ${l.goal.code}: несколько целей с таким номером` : `цели ${l.goal.code} нет в ресурсе в текущем квартале или квартале срока`) : "цели нет в пакете" });
      continue;
    }
    if (goal.quarter && ![quarterOf(ctx.today), quarterOf(due)].includes(goal.quarter)) {
      out.push({ l, action: "skip", reason: "цель из другого квартала: задачу привязывают к цели текущего квартала или квартала её срока" });
      continue;
    }
    const teamId = row?.teamId ?? tRef.plan!.teamId!;
    const people = row ? [...(row.ownerId ? [row.ownerId] : []), ...row.coExecutors.map((c) => c.personId)] : [...(tRef.plan!.ownerId ? [tRef.plan!.ownerId] : []), ...(tRef.plan!.co ?? []).map((c) => c.id)];
    if (goal.teamId && !goalFits({ source: goal.source ?? "manual", ownerId: goal.ownerId ?? null, teamId: goal.teamId }, { teamId }, people, ctx.nodes)) {
      out.push({ l, action: "skip", reason: "цель не своей команды и не команды выше: так задачу к цели не привязать" });
      continue;
    }
    if (known) {
      const old = asRecord(known.payload);
      // Цель задачи поменяли в ресурсе после прошлой загрузки: не трогаем
      const was = row?.goalId ?? null;
      const oldGoal = old.goalId ?? null;
      if (was !== oldGoal) {
        out.push({ l, action: "skip", reason: "цель задачи поменяли в ресурсе после прошлой загрузки" });
        continue;
      }
      out.push({ l, action: "update" });
      continue;
    }
    if (row?.goalId && row.goalId !== goal.id) {
      out.push({ l, action: "skip", reason: `у задачи ${tRef.number} в ресурсе уже другая цель` });
      continue;
    }
    if (row?.goalId && row.goalId === goal.id) {
      out.push({ l, action: "add", reason: "уже связана, запомнится только ключ" });
      continue;
    }
    out.push({ l, action: "add" });
  }
  return out;
}

async function buildPlan(ctx: Ctx, pkg: ContentPackage): Promise<Plan> {
  const goals = await planGoals(ctx, pkg);
  const tasks = await planTasks(ctx, pkg);
  const decisions = await planDecisions(ctx, pkg);
  const links = await planLinks(ctx, pkg, tasks, goals);
  return { goals, tasks, decisions, links };
}

function short(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function counts<T extends { action: string }>(list: T[]): ImportCounts {
  return {
    add: list.filter((x) => x.action === "add").length,
    update: list.filter((x) => x.action === "update" || x.action === "match").length,
    skip: list.filter((x) => x.action === "skip").length,
  };
}

function summarize(ctx: Ctx, pkg: ContentPackage, plan: Plan): ImportPreview {
  const notes: ImportLine[] = [];
  for (const p of plan.goals) if (p.action === "skip" && p.reason !== "без изменений") notes.push({ what: `Цель «${short(p.g.title)}»`, text: p.reason! });
  for (const p of plan.goals) if (p.action === "match") notes.push({ what: `Цель «${short(p.g.title)}»`, text: `${p.g.code} уже есть в ресурсе: загрузка заполнит только пустые поля` });
  for (const p of plan.tasks) if (p.action === "skip" && p.reason !== "без изменений") notes.push({ what: `Задача «${short(p.t.title)}»`, text: p.reason! });
  for (const p of plan.decisions) if (p.action === "skip" && p.reason !== "без изменений") notes.push({ what: `Решение «${short(p.d.text)}»`, text: p.reason! });
  for (const p of plan.links) if (p.reason && p.reason !== "без изменений") notes.push({ what: `Связь ${p.l.key}`, text: p.reason });
  const unchanged = [...plan.goals, ...plan.tasks, ...plan.decisions, ...plan.links].filter((p) => p.reason === "без изменений").length;
  if (unchanged) notes.unshift({ what: "Без изменений", text: `${unchanged} ${unchanged === 1 ? "запись уже загружена" : "записей уже загружено"} в том же виде` });
  const notified = new Set(plan.tasks.filter((p) => p.action === "add" && !CLOSED.includes(p.t.status) && p.ownerId && p.ownerId !== ctx.actor.personId).map((p) => p.ownerId));
  return {
    title: pkg.title,
    tasks: counts(plan.tasks),
    decisions: counts(plan.decisions),
    goals: counts(plan.goals),
    links: counts(plan.links),
    missingPeople: [...ctx.missingPeople].sort((a, b) => a.localeCompare(b, "ru")),
    missingTeams: [...ctx.missingTeams].sort((a, b) => a.localeCompare(b, "ru")),
    notes: [...notes, ...ctx.notes].slice(0, 300),
    notified: notified.size,
  };
}

const CLOSED = ["done", "partial", "failed", "cancelled"];

/** Предпросмотр: ничего не пишет */
export async function previewContentImport(actor: Actor, pkg: ContentPackage): Promise<ImportPreview> {
  if (!canImportContent(actor)) fail(IMPORT_ONLY);
  const ctx = await context(prisma, actor);
  return summarize(ctx, pkg, await buildPlan(ctx, pkg));
}

// ---------- Загрузка ----------

async function remember(tx: Tx, kind: Kind, k: string, entityId: string, record: unknown, payload: Record<string, unknown>) {
  const hash = recordHash(record);
  const data = { entityId, hash, payload: payload as Prisma.InputJsonValue, updatedAt: new Date() };
  await tx.contentImportKey.upsert({ where: { kind_key: { kind, key: k } }, update: data, create: { kind, key: k, ...data } });
}

/** Что загрузка знает о задаче: поля пакета, которые она сверяет с ресурсом при следующей загрузке */
function taskPayload(t: PackageTask) {
  return { title: t.title, outcome: t.outcome, due: t.due, status: t.status, resolution: t.resolution, whereNow: t.whereNow };
}

function goalPayload(g: PackageGoal) {
  return { title: g.title, description: g.description, metric: g.metric, base: g.base, target: g.target, link: g.link, code: g.code };
}

export type ImportResult = ImportPreview & { applied: { tasks: number[]; goals: number; decisions: number; links: number } };

export async function applyContentImport(actor: Actor, pkg: ContentPackage): Promise<ImportResult> {
  if (!canImportContent(actor)) fail(IMPORT_ONLY);
  return prisma.$transaction(
    async (tx) => {
      // Две загрузки сразу идут по очереди: вторая видит ключи первой и ничего не дублирует
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('content.import'))`;
      const ctx = await context(tx, actor);
      const plan = await buildPlan(ctx, pkg);
      const where = (what: string, run: () => Promise<unknown>) =>
        run().catch((error: unknown) => {
          if (error instanceof TaskRuleError) throw new TaskRuleError(`Загрузка не прошла, база не тронута. ${what}: ${error.message}`);
          throw error;
        });
      const goalIds = new Map<string, string>();
      let goalsDone = 0;

      // Цели: сначала все сами цели, потом связи с целью выше
      for (const p of plan.goals) {
        const g = p.g;
        if (p.existingId) goalIds.set(g.key, p.existingId);
        if (p.action === "add") {
          const created = await where(`Цель «${short(g.title)}»`, () =>
            createGoal(actor, { quarter: g.quarter, title: g.title, description: g.description, metric: g.metric, base: g.base, target: g.target, team: p.teamId, owner: p.ownerSlug ?? null, link: g.link, code: g.code }, tx),
          );
          goalIds.set(g.key, (created as { id: string }).id);
          await remember(tx, "goal", g.key, (created as { id: string }).id, g, goalPayload(g));
          goalsDone += 1;
        } else if (p.action === "match") {
          // Цель уже была в ресурсе: заполняем только пустые поля
          const cur = await tx.goal.findUniqueOrThrow({ where: { id: p.existingId! } });
          const input: Record<string, string> = {};
          for (const f of ["description", "metric", "base", "target", "link"] as const) if (!cur[f] && g[f]) input[f] = g[f]!;
          if (Object.keys(input).length) await where(`Цель «${short(g.title)}»`, () => updateGoal(actor, p.existingId!, input, tx));
          // Запоминаем поля такими, какими они стали в ресурсе: по ним следующая загрузка поймёт, правили ли их потом
          const after = Object.fromEntries(Object.keys(goalPayload(g)).map((k) => [k, (cur as Record<string, unknown>)[k] ?? input[k] ?? null]));
          await remember(tx, "goal", g.key, p.existingId!, g, after);
          goalsDone += 1;
        } else if (p.action === "update") {
          const old = asRecord(ctx.keys.get(key("goal", g.key))?.payload);
          const cur = await tx.goal.findUniqueOrThrow({ where: { id: p.existingId! } });
          const next = goalPayload(g);
          const input: Record<string, string | null> = {};
          const kept: Record<string, unknown> = { ...next };
          for (const f of Object.keys(next) as (keyof typeof next)[]) {
            if (same(old[f], next[f])) continue;
            if (same((cur as Record<string, unknown>)[f], old[f])) input[f] = next[f];
            else {
              kept[f] = (cur as Record<string, unknown>)[f] ?? null;
              ctx.notes.push({ what: `Цель «${short(g.title)}»`, text: `поле «${GOAL_FIELDS[f]}» правили в ресурсе, загрузка его не тронула` });
            }
          }
          if (Object.keys(input).length) await where(`Цель «${short(g.title)}»`, () => updateGoal(actor, p.existingId!, input, tx));
          await remember(tx, "goal", g.key, p.existingId!, g, kept);
          goalsDone += 1;
        }
      }
      for (const p of plan.goals) {
        if (p.action === "skip" || !p.g.parent) continue;
        const id = goalIds.get(p.g.key);
        if (!id) continue;
        const cur = await tx.goal.findUniqueOrThrow({ where: { id }, select: { parentId: true, quarter: true } });
        let parentId: string | null = null;
        if ("key" in p.g.parent) parentId = goalIds.get(p.g.parent.key) ?? ctx.keys.get(key("goal", p.g.parent.key))?.entityId ?? null;
        else {
          const found = await tx.goal.findMany({ where: { code: p.g.parent.code, quarter: cur.quarter }, select: { id: true } });
          parentId = found.length === 1 ? found[0]!.id : null;
        }
        if (!parentId) {
          ctx.notes.push({ what: `Цель «${short(p.g.title)}»`, text: "цель выше не нашлась, загрузится без неё" });
          continue;
        }
        // Цель выше ставим новой цели и цели, у которой её ещё нет; заданную в ресурсе не меняем
        if (cur.parentId === parentId) continue;
        if (cur.parentId) {
          ctx.notes.push({ what: `Цель «${short(p.g.title)}»`, text: "цель выше уже задана в ресурсе, загрузка её не тронула" });
          continue;
        }
        await where(`Цель «${short(p.g.title)}»`, () => updateGoal(actor, id, { parent: parentId }, tx));
      }

      // Задачи: служба задач ставит их от имени того, кто загружает
      const taskNumbers = new Map<string, number>();
      const created: number[] = [];
      for (const p of plan.tasks) {
        const t = p.t;
        if (p.number) taskNumbers.set(t.key, p.number);
        if (p.action === "add") {
          const res = (await where(`Задача «${short(t.title)}»`, () =>
            createTaskIn(
              tx,
              actor,
              {
                title: t.title,
                outcome: t.outcome,
                owner: p.owner!,
                coExecutors: p.co!.map((c) => c.slug),
                direction: t.direction,
                priority: t.priority ?? undefined,
                due: t.due,
                source: t.source.kind,
                sourceNote: t.source.note ?? undefined,
                links: t.links.map((l) => ({ title: l.title ?? undefined, url: l.url })),
                team: p.teamId,
              },
              { history: { sourceDate: t.source.date } },
            ),
          )) as { task: { number: number } };
          const number = res.task.number;
          taskNumbers.set(t.key, number);
          created.push(number);
          const row = await tx.task.findUniqueOrThrow({ where: { number }, select: { id: true } });
          if (t.whereNow) await where(`Задача ${number}`, () => updateWhere(actor, number, t.whereNow!, tx));
          if (t.status !== "in-progress") await where(`Задача ${number}`, () => changeStatus(actor, number, t.status, t.resolution ?? undefined, tx));
          // Задача из истории уже закрыта: событие «Новая задача для вас» о ней только мешает
          if (CLOSED.includes(t.status)) await tx.inboxEvent.deleteMany({ where: { taskId: row.id } });
          await remember(tx, "task", t.key, row.id, t, taskPayload(t));
        } else if (p.action === "update") {
          const number = p.number!;
          const old = asRecord(ctx.keys.get(key("task", t.key))?.payload);
          const next = taskPayload(t);
          const row = await tx.task.findUniqueOrThrow({ where: { number } });
          const cur: Record<string, unknown> = { title: row.title, outcome: row.outcome, due: isoFromDbDate(row.due), status: statusCode(row.status), resolution: row.resolution, whereNow: row.whereNow || null };
          const kept: Record<string, unknown> = { ...next };
          const changed = (f: keyof typeof next) => !same(old[f], next[f]);
          const untouched = (f: keyof typeof next) => same(cur[f], old[f]);
          const edit: { title?: string; outcome?: string } = {};
          for (const f of ["title", "outcome", "due", "status", "resolution", "whereNow"] as const) {
            if (!changed(f)) continue;
            if (!untouched(f)) {
              kept[f] = cur[f] ?? null;
              ctx.notes.push({ what: `Задача ${number}`, text: `поле «${TASK_FIELDS[f]}» правили в ресурсе, загрузка его не тронула` });
            }
          }
          if (changed("title") && untouched("title")) edit.title = t.title;
          if (changed("outcome") && untouched("outcome")) edit.outcome = t.outcome;
          if (edit.title || edit.outcome) await where(`Задача ${number}`, () => editTask(actor, number, edit, tx));
          if (changed("whereNow") && untouched("whereNow") && t.whereNow) await where(`Задача ${number}`, () => updateWhere(actor, number, t.whereNow!, tx));
          if (changed("due") && untouched("due")) {
            if (CLOSED.includes(String(cur.status)) || t.due < ctx.today) {
              kept.due = cur.due;
              ctx.notes.push({ what: `Задача ${number}`, text: `срок ${formatLong(t.due)} не перенесён: задача закрыта или срок уже прошёл` });
            } else await where(`Задача ${number}`, () => transferDue(actor, number, t.due, IMPORT_TRANSFER_REASON, tx));
          }
          if ((changed("status") || changed("resolution")) && untouched("status") && untouched("resolution") && t.status !== cur.status) {
            await where(`Задача ${number}`, () => changeStatus(actor, number, t.status, t.resolution ?? undefined, tx));
          }
          await remember(tx, "task", t.key, row.id, t, kept);
        }
      }

      // Решения: к команде и дате; без встречи, если её в ресурсе не было. Владельцам о старых решениях не сообщаем
      let decisionsDone = 0;
      for (const p of plan.decisions) {
        if (p.action === "skip") continue;
        const d = p.d;
        const taskIds: string[] = [];
        for (const ref of d.tasks) {
          const number = "number" in ref ? ref.number : taskNumbers.get(ref.key);
          const row = number ? await tx.task.findUnique({ where: { number }, select: { id: true, archivedAt: true } }) : null;
          if (row && !row.archivedAt) taskIds.push(row.id);
          else ctx.notes.push({ what: `Решение «${short(d.text)}»`, text: `задача ${"number" in ref ? ref.number : ref.key} не нашлась, решение загрузится без неё` });
        }
        if (p.action === "add") {
          const row = await tx.decision.create({
            data: {
              teamId: p.teamId!,
              text: d.text,
              ownerId: p.ownerId ?? null,
              date: dbDate(d.date),
              createdById: actor.personId,
              ...(d.status === "cancelled" ? { status: "CANCELLED" as const, cancelReason: d.cancelReason, cancelledAt: new Date(), cancelledById: actor.personId } : {}),
              tasks: { create: [...new Set(taskIds)].map((taskId) => ({ taskId })) },
            },
          });
          await tx.auditLog.create({
            data: { action: "meeting.decision", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "decision", entityId: row.id, field: "Решение из наполнения", after: `${formatLong(d.date)}: ${d.text}`, ip: actor.ip ?? null, via: actor.via ?? null },
          });
          await remember(tx, "decision", d.key, row.id, d, { text: d.text, ownerId: p.ownerId ?? null, status: d.status });
        } else {
          const old = asRecord(ctx.keys.get(key("decision", d.key))?.payload);
          const cur = await tx.decision.findUniqueOrThrow({ where: { id: p.existingId! } });
          const data: Prisma.DecisionUncheckedUpdateInput = {};
          const kept: Record<string, unknown> = { text: d.text, ownerId: p.ownerId ?? null, status: d.status };
          const curStatus = cur.status === "CANCELLED" ? "cancelled" : "active";
          if (!same(old.text, d.text)) {
            if (same(cur.text, old.text)) data.text = d.text;
            else kept.text = cur.text;
          }
          if (!same(old.ownerId, p.ownerId ?? null)) {
            if (same(cur.ownerId, old.ownerId)) data.ownerId = p.ownerId ?? null;
            else kept.ownerId = cur.ownerId;
          }
          if (!same(old.status, d.status)) {
            if (same(curStatus, old.status)) {
              if (d.status === "cancelled") Object.assign(data, { status: "CANCELLED", cancelReason: d.cancelReason, cancelledAt: new Date(), cancelledById: actor.personId });
              else Object.assign(data, { status: "ACTIVE", cancelReason: null, cancelledAt: null, cancelledById: null });
            } else kept.status = curStatus;
          }
          if (Object.keys(data).length) {
            await tx.decision.update({ where: { id: cur.id }, data });
            await tx.auditLog.create({
              data: { action: "meeting.decision", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "decision", entityId: cur.id, field: "Решение обновлено из наполнения", before: cur.text, after: d.text, ip: actor.ip ?? null, via: actor.via ?? null },
            });
          }
          if (kept.text !== d.text || kept.ownerId !== (p.ownerId ?? null) || kept.status !== d.status) ctx.notes.push({ what: `Решение «${short(d.text)}»`, text: "часть полей правили в ресурсе, загрузка их не тронула" });
          // Новые связи с задачами добавляем, прежние не убираем
          if (taskIds.length) await tx.decisionTask.createMany({ data: taskIds.map((taskId) => ({ decisionId: cur.id, taskId })), skipDuplicates: true });
          await remember(tx, "decision", d.key, cur.id, d, kept);
        }
        decisionsDone += 1;
      }

      // Связи задач с целями: через то же правило, что в карточке задачи
      let linksDone = 0;
      for (const p of plan.links) {
        if (p.action === "skip") continue;
        const l = p.l;
        const number = "number" in l.task ? l.task.number : taskNumbers.get(l.task.key);
        const goalId = "key" in l.goal ? (goalIds.get(l.goal.key) ?? ctx.keys.get(key("goal", l.goal.key))?.entityId ?? null) : null;
        let id = goalId;
        if (!id && "code" in l.goal) {
          const row = number ? await tx.task.findUnique({ where: { number }, select: { due: true } }) : null;
          const found = await tx.goal.findMany({ where: { code: l.goal.code, quarter: { in: [quarterOf(ctx.today), ...(row ? [quarterOf(isoFromDbDate(row.due))] : [])] } }, select: { id: true } });
          id = found.length === 1 ? found[0]!.id : null;
        }
        if (!number || !id) {
          ctx.notes.push({ what: `Связь ${l.key}`, text: "задача или цель не нашлась после загрузки, связь пропущена" });
          continue;
        }
        const task = await tx.task.findUniqueOrThrow({ where: { number }, select: { goalId: true } });
        if (task.goalId !== id) await where(`Связь задачи ${number} с целью`, () => linkTaskGoal(actor, number, id, tx));
        await remember(tx, "link", l.key, String(number), l, { goalId: id });
        linksDone += 1;
      }

      const result: ImportResult = { ...summarize(ctx, pkg, plan), applied: { tasks: created, goals: goalsDone, decisions: decisionsDone, links: linksDone } };
      await tx.auditLog.create({
        data: {
          action: "content.import",
          actorId: actor.personId,
          actorName: actor.fullName,
          source: "APP",
          entity: "content",
          entityId: pkg.title ?? "пакет наполнения",
          field: "Загружено наполнение",
          after: `Задачи: новых ${result.tasks.add}, обновлено ${result.tasks.update}, пропущено ${result.tasks.skip}. Решения: новых ${result.decisions.add}, обновлено ${result.decisions.update}, пропущено ${result.decisions.skip}. Цели: новых ${result.goals.add}, обновлено ${result.goals.update}, пропущено ${result.goals.skip}. Связи с целями: новых ${result.links.add}, обновлено ${result.links.update}, пропущено ${result.links.skip}`,
          ip: actor.ip ?? null,
          via: actor.via ?? null,
        },
      });
      return result;
    },
    { timeout: 300_000, maxWait: 15_000 },
  );
}

const TASK_FIELDS: Record<string, string> = { title: "Задача", outcome: "Что нужно сделать", due: "Срок", status: "Статус", resolution: "Итог", whereNow: "Где сейчас" };
const GOAL_FIELDS: Record<string, string> = { title: "Цель", description: "Описание", metric: "Метрика", base: "База", target: "Целевое значение", link: "Ссылка", code: "Номер" };
