// Импорт наполнения (этап 67). Владелец при личном входе в режиме управления загружает пакет: сначала предпросмотр
// (что добавится, обновится, пропустится, кого и каких команд не нашли), потом загрузка одной транзакцией.
//
// Правила:
// - загрузка только добавляет и обновляет записи с тем же внешним ключом, ничего не удаляет;
// - задачи ставятся через службу задач с её правилами (автор: тот, кто загружает), цели через службу целей,
//   связь задачи с целью через поле задачи и ту же проверку, что в карточке;
// - повторная загрузка того же пакета ничего не меняет: ключ и отпечаток записи совпадают;
// - поле, которое в ресурсе поменяли после прошлой загрузки, загрузка не трогает и говорит об этом. Для этого у ключа
//   хранится запись пакета (record) и значения полей в ресурсе сразу после загрузки (applied);
// - всё, что правило может не пустить, проверяется в плане: такая запись пропускается с пояснением ещё в предпросмотре.
//   Если правило всё же не пустило запись при загрузке, откатывается всё: база остаётся как была.
// - номера новых задач выделяются заранее короткой транзакцией, чтобы длинная загрузка не держала счётчик номеров и
//   остальные могли ставить задачи. Номера неудачной загрузки пропадают, это не страшно.

import { prisma } from "@/lib/db";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { TOP_TEAM, ancestorsOf, loadTeamNodes, type TeamNode } from "@/lib/org/scope";
import { NameIndex, normName } from "@/lib/bord/names";
import { TaskRuleError, changeStatus, createTaskIn, editTask, transferDue, updateWhere, type Actor } from "@/lib/tasks/service";
import { createGoal, linkTaskGoal, updateGoal } from "@/lib/goals/service";
import { goalFits } from "@/lib/goals/personal";
import { quarterOf } from "@/lib/goals/parse";
import { dbDate, isoFromDbDate, moscowToday } from "@/lib/tasks/dates";
import { statusCode } from "@/lib/tasks/codes";
import { formatLong } from "@/domain/dates";
import { recordHash, type ContentPackage, type GoalRef, type PackageDecision, type PackageGoal, type PackageLink, type PackageTask } from "./package";

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
  /** Сколько человек (ответственные и соисполнители) узнают о новых открытых задачах в «Мне» */
  notified: number;
};
export type ImportResult = ImportPreview & { applied: { tasks: number[]; goals: number; decisions: number; links: number } };

type Kind = "task" | "decision" | "goal" | "link";
type KeyRow = { kind: string; key: string; entityId: string; hash: string; payload: Prisma.JsonValue };
type Payload = { record: Record<string, unknown>; applied: Record<string, unknown> };

const CLOSED = ["done", "partial", "failed", "cancelled"];
const TASK_FIELDS: Record<string, string> = { title: "Задача", outcome: "Что нужно сделать", due: "Срок", status: "Статус", resolution: "Итог", whereNow: "Где сейчас", closedAt: "Дата закрытия" };
const TASK_OTHER: Record<string, string> = { owner: "Ответственный", coExecutors: "Соисполнители", direction: "Направление", team: "Команда", priority: "Приоритет", source: "Источник", links: "Ссылки" };
const GOAL_FIELDS: Record<string, string> = { title: "Цель", description: "Описание", metric: "Метрика", base: "База", target: "Целевое значение", link: "Ссылка", code: "Номер" };
const GOAL_OTHER: Record<string, string> = { owner: "Владелец", team: "Команда", quarter: "Квартал", parent: "Цель выше" };
const DECISION_OTHER: Record<string, string> = { date: "Дата", team: "Команда" };

/** Справочники для сопоставления: люди, команды, направления, источники, уже загруженные ключи */
type Ctx = {
  db: Db;
  actor: Actor;
  today: string;
  people: { id: string; slug: string; fullName: string; shortName: string; active: boolean }[];
  index: NameIndex;
  nodes: TeamNode[];
  directions: Set<string>;
  sources: Set<string>;
  keys: Map<string, KeyRow>;
  missingPeople: Set<string>;
  missingTeams: Set<string>;
  notes: ImportLine[];
};

async function context(db: Db, actor: Actor): Promise<Ctx> {
  // По очереди: внутри транзакции у клиента базы один запрос за раз
  const people = await db.person.findMany({ select: { id: true, slug: true, fullName: true, shortName: true, active: true } });
  const nodes = await loadTeamNodes(db);
  const dict = await db.dictionaryItem.findMany({ where: { kind: { in: ["DIRECTION", "TASK_SOURCE"] }, active: true }, select: { kind: true, code: true } });
  const keys = await db.contentImportKey.findMany();
  return {
    db,
    actor,
    today: moscowToday(),
    people,
    index: new NameIndex(people.filter((p) => p.active)),
    nodes,
    directions: new Set(dict.filter((d) => d.kind === "DIRECTION").map((d) => d.code)),
    sources: new Set(dict.filter((d) => d.kind === "TASK_SOURCE").map((d) => d.code)),
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
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function payloadOf(row: KeyRow | undefined): Payload {
  const p = row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? (row.payload as Record<string, unknown>) : {};
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  return { record: obj(p.record), applied: obj(p.applied) };
}
function short(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// ---------- План ----------

type GoalPlan = {
  g: PackageGoal;
  action: "add" | "update" | "skip" | "match";
  teamId?: string;
  ownerSlug?: string | null;
  ownerId?: string | null;
  existingId?: string;
  /** Поля для updateGoal при обновлении */
  fields?: Record<string, string | null>;
  /** Цель выше: id или ключ новой цели пакета; null: не ставить */
  parent?: { id?: string; key?: string } | null;
  reason?: string;
};
type TaskPlan = {
  t: PackageTask;
  action: "add" | "update" | "skip";
  teamId?: string;
  owner?: string;
  ownerId?: string | null;
  co?: { slug: string; id: string }[];
  number?: number;
  apply?: { edit?: { title?: string; outcome?: string }; whereNow?: string; due?: string; status?: boolean };
  reason?: string;
};
type DecisionPlan = { d: PackageDecision; action: "add" | "update" | "skip"; teamId?: string; ownerId?: string | null; existingId?: string; data?: Prisma.DecisionUncheckedUpdateInput; reason?: string };
type LinkPlan = { l: PackageLink; action: "add" | "update" | "skip"; reason?: string; remember?: boolean };
type Plan = { goals: GoalPlan[]; tasks: TaskPlan[]; decisions: DecisionPlan[]; links: LinkPlan[] };

function goalPayload(g: PackageGoal) {
  return { title: g.title, description: g.description, metric: g.metric, base: g.base, target: g.target, link: g.link, code: g.code };
}
function goalRefKey(ref: GoalRef | null): string | null {
  return ref ? ("key" in ref ? `key:${ref.key}` : `code:${ref.code}`) : null;
}

async function planGoals(ctx: Ctx, pkg: ContentPackage): Promise<GoalPlan[]> {
  const out: GoalPlan[] = [];
  const codes = new Map<string, string>();
  for (const g of pkg.goals) {
    const what = `Цель «${short(g.title)}»`;
    const known = ctx.keys.get(key("goal", g.key));
    if (known) {
      // Уже загружена: сначала ключ, потом всё остальное (владельца могли выключить, команду переименовать)
      const cur = await ctx.db.goal.findUnique({ where: { id: known.entityId } });
      if (!cur) {
        out.push({ g, action: "skip", reason: "цель удалили в ресурсе, загрузка её не возвращает" });
        continue;
      }
      if (known.hash === recordHash(g)) {
        out.push({ g, action: "skip", existingId: cur.id, reason: "без изменений" });
        continue;
      }
      const { record, applied } = payloadOf(known);
      const next = goalPayload(g);
      const fields: Record<string, string | null> = {};
      for (const f of Object.keys(next) as (keyof typeof next)[]) {
        if (same(record[f], next[f])) continue;
        if (same((cur as Record<string, unknown>)[f], applied[f])) fields[f] = next[f];
        else ctx.notes.push({ what, text: `поле «${GOAL_FIELDS[f]}» правили в ресурсе, загрузка его не тронула` });
      }
      if (fields.code && (await ctx.db.goal.findFirst({ where: { quarter: cur.quarter, teamId: cur.teamId, code: fields.code, id: { not: cur.id } } }))) {
        ctx.notes.push({ what, text: `номер ${fields.code} в команде уже занят, номер не меняется` });
        delete fields.code;
      }
      for (const f of Object.keys(GOAL_OTHER)) {
        if (!same(record[f], (g as Record<string, unknown>)[f])) ctx.notes.push({ what, text: `поле «${GOAL_OTHER[f]}» из пакета загрузка не меняет, поправьте в ресурсе` });
      }
      if (Object.keys(fields).length) out.push({ g, action: "update", existingId: cur.id, fields, parent: null });
      else out.push({ g, action: "skip", existingId: cur.id, reason: "изменились только поля, которые загрузка не меняет или которые правили в ресурсе" });
      continue;
    }
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
    const base = { teamId: team.id, ownerSlug: owner?.slug ?? null, ownerId: owner?.id ?? null };
    if (g.code) {
      const twice = codes.get(`${g.quarter}/${team.id}/${g.code}`);
      if (twice) {
        out.push({ g, action: "skip", reason: `номер ${g.code} в этой команде уже у цели пакета ${twice}` });
        continue;
      }
      codes.set(`${g.quarter}/${team.id}/${g.code}`, g.key);
    }
    // Цель с тем же номером уже есть в команде (например, из борда лидера): ключ привязывается к ней, пустые поля
    // заполняются, заполненные в ресурсе не трогаются
    const byCode = g.code ? await ctx.db.goal.findFirst({ where: { quarter: g.quarter, teamId: team.id, code: g.code } }) : null;
    if (byCode) {
      const fields: Record<string, string | null> = {};
      for (const f of ["description", "metric", "base", "target", "link"] as const) if (!byCode[f] && g[f]) fields[f] = g[f];
      out.push({ g, action: "match", ...base, existingId: byCode.id, fields });
    } else out.push({ g, action: "add", ...base });
  }
  // Цель выше: только новой цели и цели, у которой её ещё нет; та же проверка, что в службе целей
  for (const p of out) {
    if ((p.action !== "add" && p.action !== "match") || !p.g.parent) continue;
    const what = `Цель «${short(p.g.title)}»`;
    const teamId = p.teamId!;
    if (p.existingId && (await ctx.db.goal.findUnique({ where: { id: p.existingId }, select: { parentId: true } }))?.parentId) {
      ctx.notes.push({ what, text: "цель выше уже задана в ресурсе, загрузка её не тронула" });
      continue;
    }
    let parent: { id?: string; key?: string; teamId: string; quarter: string } | null = null;
    if ("key" in p.g.parent) {
      const pp = out.find((x) => x.g.key === (p.g.parent as { key: string }).key);
      const id = pp?.existingId ?? ctx.keys.get(key("goal", (p.g.parent as { key: string }).key))?.entityId;
      const row = id ? await ctx.db.goal.findUnique({ where: { id }, select: { id: true, teamId: true, quarter: true } }) : null;
      if (row) parent = { id: row.id, teamId: row.teamId, quarter: row.quarter };
      else if (pp && pp.action === "add") parent = { key: pp.g.key, teamId: pp.teamId!, quarter: pp.g.quarter };
    } else {
      const found = await ctx.db.goal.findMany({ where: { code: p.g.parent.code, quarter: p.g.quarter }, select: { id: true, teamId: true, quarter: true } });
      if (found.length === 1) parent = found[0]!;
    }
    if (!parent) ctx.notes.push({ what, text: "цель выше не нашлась, загрузится без неё" });
    else if (parent.quarter !== p.g.quarter) ctx.notes.push({ what, text: "цель выше из другого квартала, загрузится без неё" });
    else if (![teamId, ...ancestorsOf(ctx.nodes, teamId)].includes(parent.teamId)) ctx.notes.push({ what, text: "цель выше не своей команды и не команды выше, загрузится без неё" });
    else if ((parent.key && parent.key === p.g.key) || (parent.id && parent.id === p.existingId)) ctx.notes.push({ what, text: "цель не может стоять ниже самой себя" });
    else p.parent = parent.id ? { id: parent.id } : { key: parent.key };
  }
  // Петля внутри пакета (А выше Б, Б выше А): обе цели грузятся без цели выше
  for (const p of out) {
    if (!p.parent?.key) continue;
    const seen = new Set([p.g.key]);
    let cur: GoalPlan | undefined = out.find((x) => x.g.key === p.parent!.key);
    while (cur?.parent?.key && !seen.has(cur.g.key)) {
      seen.add(cur.g.key);
      cur = out.find((x) => x.g.key === cur!.parent!.key);
    }
    if (cur && seen.has(cur.g.key) && cur.parent?.key && seen.has(cur.parent.key)) {
      ctx.notes.push({ what: `Цель «${short(p.g.title)}»`, text: "цели пакета ставят друг друга выше по кругу, загрузится без цели выше" });
      p.parent = null;
    }
  }
  return out;
}

/** Значения полей задачи в ресурсе, которые сверяет загрузка */
function taskApplied(row: { title: string; outcome: string; due: Date; status: Parameters<typeof statusCode>[0]; resolution: string | null; whereNow: string; closedAt: Date | null }) {
  return { title: row.title, outcome: row.outcome, due: isoFromDbDate(row.due), status: statusCode(row.status), resolution: row.resolution, whereNow: row.whereNow || null, closedAt: row.closedAt ? row.closedAt.toISOString().slice(0, 10) : null };
}

async function planTasks(ctx: Ctx, pkg: ContentPackage): Promise<TaskPlan[]> {
  const out: TaskPlan[] = [];
  for (const t of pkg.tasks) {
    const what = `Задача «${short(t.title)}»`;
    const known = ctx.keys.get(key("task", t.key));
    if (known) {
      const row = await ctx.db.task.findUnique({ where: { id: known.entityId } });
      if (!row) {
        out.push({ t, action: "skip", reason: "задачи с этим ключом больше нет в ресурсе" });
        continue;
      }
      if (known.hash === recordHash(t)) {
        out.push({ t, action: "skip", number: row.number, reason: "без изменений" });
        continue;
      }
      if (row.archivedAt) {
        out.push({ t, action: "skip", number: row.number, reason: `задача ${row.number} в архиве, загрузка её не правит` });
        continue;
      }
      const { record, applied } = payloadOf(known);
      const cur = taskApplied(row);
      const changed = (f: string) => !same(record[f], (t as Record<string, unknown>)[f]);
      const untouched = (f: keyof typeof cur) => same(cur[f], applied[f]);
      const label = `Задача ${row.number}`;
      const apply: NonNullable<TaskPlan["apply"]> = {};
      const edited = (f: keyof typeof cur) => ctx.notes.push({ what: label, text: `поле «${TASK_FIELDS[f]}» правили в ресурсе, загрузка его не тронула` });
      for (const f of ["title", "outcome"] as const) {
        if (!changed(f)) continue;
        if (untouched(f)) apply.edit = { ...apply.edit, [f]: t[f] };
        else edited(f);
      }
      if (changed("whereNow")) {
        if (!t.whereNow) ctx.notes.push({ what: label, text: "«Где сейчас» в пакете пустое: очищать его загрузка не умеет" });
        else if (untouched("whereNow")) apply.whereNow = t.whereNow;
        else edited("whereNow");
      }
      const closedNow = CLOSED.includes(cur.status);
      if (changed("due")) {
        if (!untouched("due")) edited("due");
        else if (closedNow || t.due < ctx.today) ctx.notes.push({ what: label, text: `срок ${formatLong(t.due)} не перенесён: задача закрыта или срок уже прошёл` });
        else apply.due = t.due;
      }
      if (changed("status")) {
        if (!untouched("status")) edited("status");
        else if (t.status !== cur.status) apply.status = true;
      } else if (changed("resolution")) {
        ctx.notes.push({ what: label, text: "итог поменялся только в пакете: итог закрытой задачи правят в карточке" });
      }
      for (const f of Object.keys(TASK_OTHER)) if (changed(f)) ctx.notes.push({ what: label, text: `поле «${TASK_OTHER[f]}» из пакета загрузка не меняет, поправьте в ресурсе` });
      if (apply.edit || apply.whereNow || apply.due || apply.status) out.push({ t, action: "update", number: row.number, apply });
      else out.push({ t, action: "skip", number: row.number, reason: "изменились только поля, которые загрузка не меняет или которые правили в ресурсе" });
      continue;
    }
    const all = normName(t.owner) === normName(ALL_LEADERS_NAME);
    const owner = all ? null : personOf(ctx, t.owner);
    if (!all && !owner) {
      out.push({ t, action: "skip", reason: `ответственный «${t.owner}» не найден в ресурсе` });
      continue;
    }
    if (!ctx.directions.has(t.direction)) {
      out.push({ t, action: "skip", reason: `направления «${t.direction}» нет в справочнике или оно скрыто` });
      continue;
    }
    if (!ctx.sources.has(t.source.kind)) {
      out.push({ t, action: "skip", reason: `источник задачи «${t.source.kind}» скрыт в справочнике` });
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
      else if (!p) ctx.notes.push({ what, text: `соисполнитель «${name}» не найден, задача загрузится без него` });
    }
    out.push({ t, action: "add", teamId: team.id, owner: all ? "all" : owner!.slug, ownerId: owner?.id ?? null, co });
  }
  return out;
}

async function planDecisions(ctx: Ctx, pkg: ContentPackage): Promise<DecisionPlan[]> {
  const out: DecisionPlan[] = [];
  for (const d of pkg.decisions) {
    const what = `Решение «${short(d.text)}»`;
    const known = ctx.keys.get(key("decision", d.key));
    if (known) {
      const cur = await ctx.db.decision.findUnique({ where: { id: known.entityId } });
      if (!cur) {
        out.push({ d, action: "skip", reason: "решение удалили в ресурсе, загрузка его не возвращает" });
        continue;
      }
      if (known.hash === recordHash(d)) {
        out.push({ d, action: "skip", existingId: cur.id, reason: "без изменений" });
        continue;
      }
      const { record, applied } = payloadOf(known);
      const data: Prisma.DecisionUncheckedUpdateInput = {};
      const curStatus = cur.status === "CANCELLED" ? "cancelled" : "active";
      if (!same(record.text, d.text)) {
        if (same(cur.text, applied.text)) data.text = d.text;
        else ctx.notes.push({ what, text: "текст решения правили в ресурсе, загрузка его не тронула" });
      }
      if (!same(record.owner, d.owner)) {
        const owner = d.owner ? personOf(ctx, d.owner) : null;
        if (d.owner && !owner) ctx.notes.push({ what, text: `владелец «${d.owner}» не найден, владелец не меняется` });
        else if (same(cur.ownerId, applied.ownerId)) data.ownerId = owner?.id ?? null;
        else ctx.notes.push({ what, text: "владельца решения меняли в ресурсе, загрузка его не тронула" });
      }
      if (!same(record.status, d.status) && d.status !== curStatus) {
        if (!same(curStatus, applied.status)) ctx.notes.push({ what, text: "статус решения меняли в ресурсе, загрузка его не тронула" });
        else if (d.status === "cancelled") Object.assign(data, { status: "CANCELLED", cancelReason: d.cancelReason, cancelledAt: new Date(), cancelledById: ctx.actor.personId });
        else Object.assign(data, { status: "ACTIVE", cancelReason: null, cancelledAt: null, cancelledById: null });
      }
      for (const f of Object.keys(DECISION_OTHER)) if (!same(record[f], (d as Record<string, unknown>)[f])) ctx.notes.push({ what, text: `поле «${DECISION_OTHER[f]}» из пакета загрузка не меняет, поправьте в ресурсе` });
      const newTasks = !same(record.tasks, d.tasks);
      if (Object.keys(data).length || newTasks) out.push({ d, action: "update", existingId: cur.id, data });
      else out.push({ d, action: "skip", existingId: cur.id, reason: "изменились только поля, которые загрузка не меняет или которые правили в ресурсе" });
      continue;
    }
    const owner = d.owner ? personOf(ctx, d.owner) : null;
    if (d.owner && !owner) ctx.notes.push({ what, text: `владелец «${d.owner}» не найден, решение загрузится без владельца` });
    const team = d.team ? teamByName(ctx, d.team) : (ctx.nodes.find((n) => n.id === TOP_TEAM) ?? null);
    if (!team) {
      out.push({ d, action: "skip", reason: `команды «${d.team}» нет в ресурсе` });
      continue;
    }
    out.push({ d, action: "add", teamId: team.id, ownerId: owner?.id ?? null });
  }
  return out;
}

type GoalTarget = { id: string | null; plan?: GoalPlan; teamId?: string; ownerId?: string | null; source?: string; quarter?: string; result?: string; missing?: string };

async function goalOf(ctx: Ctx, ref: GoalRef, goals: GoalPlan[], quarters: string[]): Promise<GoalTarget> {
  if ("key" in ref) {
    const plan = goals.find((p) => p.g.key === ref.key);
    if (!plan) return { id: null, missing: "цели нет в пакете" };
    const id = plan.existingId ?? ctx.keys.get(key("goal", ref.key))?.entityId ?? null;
    const g = id ? await ctx.db.goal.findUnique({ where: { id }, select: { id: true, teamId: true, ownerId: true, source: true, quarter: true, result: true } }) : null;
    if (g) return { id: g.id, plan, teamId: g.teamId, ownerId: g.ownerId, source: g.source, quarter: g.quarter, result: g.result };
    if (plan.action === "add") return { id: null, plan, teamId: plan.teamId, ownerId: plan.ownerId ?? null, source: "manual", quarter: plan.g.quarter };
    return { id: null, plan, missing: plan.reason ? `цель «${short(plan.g.title)}» не загружается: ${plan.reason}` : "цели больше нет в ресурсе" };
  }
  const found = await ctx.db.goal.findMany({ where: { code: ref.code, quarter: { in: quarters } }, select: { id: true, teamId: true, ownerId: true, source: true, quarter: true, result: true } });
  if (found.length !== 1) return { id: null, missing: found.length > 1 ? `цель ${ref.code}: несколько целей с таким номером` : `цели ${ref.code} нет в ресурсе в текущем квартале или квартале срока задачи` };
  const g = found[0]!;
  return { id: g.id, teamId: g.teamId, ownerId: g.ownerId, source: g.source, quarter: g.quarter, result: g.result };
}

async function planLinks(ctx: Ctx, pkg: ContentPackage, tasks: TaskPlan[], goals: GoalPlan[]): Promise<LinkPlan[]> {
  const out: LinkPlan[] = [];
  for (const l of pkg.links) {
    const known = ctx.keys.get(key("link", l.key));
    if (known && known.hash === recordHash(l)) {
      out.push({ l, action: "skip", reason: "без изменений" });
      continue;
    }
    if (known && same(goalRefKey(payloadOf(known).record.goal as GoalRef), goalRefKey(l.goal)) && same(payloadOf(known).record.task, l.task)) {
      // Поменялись только уверенность или причина: в ресурсе им места нет, запоминаем новую запись
      out.push({ l, action: "skip", reason: "без изменений", remember: true });
      continue;
    }
    const tPlan = "key" in l.task ? tasks.find((p) => p.t.key === (l.task as { key: string }).key) : undefined;
    const number = "number" in l.task ? l.task.number : tPlan?.number;
    if (tPlan && tPlan.action === "skip" && !number) {
      out.push({ l, action: "skip", reason: `задача «${short(tPlan.t.title)}» не загружается: ${tPlan.reason}` });
      continue;
    }
    const row = number ? await ctx.db.task.findUnique({ where: { number }, select: { teamId: true, ownerId: true, due: true, goalId: true, archivedAt: true, coExecutors: { select: { personId: true } } } }) : null;
    if (number && !row) {
      out.push({ l, action: "skip", reason: `задачи ${number} нет в ресурсе` });
      continue;
    }
    if (row?.archivedAt) {
      out.push({ l, action: "skip", reason: `задача ${number} в архиве` });
      continue;
    }
    const due = row ? isoFromDbDate(row.due) : tPlan!.t.due;
    const quarters = [quarterOf(ctx.today), quarterOf(due)];
    const goal = await goalOf(ctx, l.goal, goals, quarters);
    if (goal.missing) {
      out.push({ l, action: "skip", reason: goal.missing });
      continue;
    }
    if (goal.result === "DROPPED") {
      out.push({ l, action: "skip", reason: "цель снята в ресурсе" });
      continue;
    }
    if (goal.quarter && !quarters.includes(goal.quarter)) {
      out.push({ l, action: "skip", reason: "цель из другого квартала: задачу привязывают к цели текущего квартала или квартала её срока" });
      continue;
    }
    const teamId = row?.teamId ?? tPlan!.teamId!;
    const people = row ? [...(row.ownerId ? [row.ownerId] : []), ...row.coExecutors.map((c) => c.personId)] : [...(tPlan!.ownerId ? [tPlan!.ownerId] : []), ...(tPlan!.co ?? []).map((c) => c.id)];
    if (!goalFits({ source: goal.source ?? "manual", ownerId: goal.ownerId ?? null, teamId: goal.teamId! }, { teamId }, people, ctx.nodes)) {
      out.push({ l, action: "skip", reason: "цель не своей команды и не команды выше и не личная цель людей задачи" });
      continue;
    }
    if (known) {
      const was = payloadOf(known).applied.goalId ?? null;
      if ((row?.goalId ?? null) !== was) out.push({ l, action: "skip", reason: "цель задачи поменяли в ресурсе после прошлой загрузки" });
      else out.push({ l, action: "update" });
      continue;
    }
    if (row?.goalId && row.goalId !== goal.id) out.push({ l, action: "skip", reason: `у задачи ${number} в ресурсе уже другая цель` });
    else if (row?.goalId && row.goalId === goal.id) out.push({ l, action: "add", reason: "уже связана, запомнится только ключ" });
    else out.push({ l, action: "add" });
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

function counts<T extends { action: string }>(list: T[]): ImportCounts {
  return {
    add: list.filter((x) => x.action === "add").length,
    update: list.filter((x) => x.action === "update" || x.action === "match").length,
    skip: list.filter((x) => x.action === "skip").length,
  };
}

function summarize(ctx: Ctx, pkg: ContentPackage, plan: Plan, tally?: Record<"tasks" | "decisions" | "goals" | "links", ImportCounts>): ImportPreview {
  const notes: ImportLine[] = [];
  const skipped = (p: { action: string; reason?: string }) => p.action === "skip" && p.reason && p.reason !== "без изменений";
  for (const p of plan.goals) if (skipped(p)) notes.push({ what: `Цель «${short(p.g.title)}»`, text: p.reason! });
  for (const p of plan.goals) if (p.action === "match") notes.push({ what: `Цель «${short(p.g.title)}»`, text: `${p.g.code} уже есть в ресурсе: загрузка заполнит только пустые поля` });
  for (const p of plan.tasks) if (skipped(p)) notes.push({ what: `Задача «${short(p.t.title)}»`, text: p.reason! });
  for (const p of plan.decisions) if (skipped(p)) notes.push({ what: `Решение «${short(p.d.text)}»`, text: p.reason! });
  for (const p of plan.links) if (p.reason && p.reason !== "без изменений") notes.push({ what: `Связь ${p.l.key}`, text: p.reason });
  const unchanged = [...plan.goals, ...plan.tasks, ...plan.decisions, ...plan.links].filter((p) => p.reason === "без изменений").length;
  if (unchanged) notes.unshift({ what: "Без изменений", text: `${unchanged} ${unchanged === 1 ? "запись уже загружена" : "записей уже загружено"} в том же виде` });
  const notified = new Set(plan.tasks.filter((p) => p.action === "add" && !CLOSED.includes(p.t.status)).flatMap((p) => [p.ownerId, ...(p.co ?? []).map((c) => c.id)]).filter((id): id is string => !!id && id !== ctx.actor.personId));
  return {
    title: pkg.title,
    tasks: tally?.tasks ?? counts(plan.tasks),
    decisions: tally?.decisions ?? counts(plan.decisions),
    goals: tally?.goals ?? counts(plan.goals),
    links: tally?.links ?? counts(plan.links),
    missingPeople: [...ctx.missingPeople].sort((a, b) => a.localeCompare(b, "ru")),
    missingTeams: [...ctx.missingTeams].sort((a, b) => a.localeCompare(b, "ru")),
    notes: [...notes, ...ctx.notes].slice(0, 300),
    notified: notified.size,
  };
}

/** Предпросмотр: ничего не пишет */
export async function previewContentImport(actor: Actor, pkg: ContentPackage): Promise<ImportPreview> {
  if (!canImportContent(actor)) fail(IMPORT_ONLY);
  const ctx = await context(prisma, actor);
  return summarize(ctx, pkg, await buildPlan(ctx, pkg));
}

// ---------- Загрузка ----------

async function remember(tx: Tx, kind: Kind, k: string, entityId: string, record: unknown, applied: Record<string, unknown>) {
  const hash = recordHash(record);
  const payload = { record, applied } as unknown as Prisma.InputJsonValue;
  await tx.contentImportKey.upsert({ where: { kind_key: { kind, key: k } }, update: { entityId, hash, payload, updatedAt: new Date() }, create: { kind, key: k, entityId, hash, payload } });
}

/** Номера для новых задач одним блоком в своей короткой транзакции: счётчик сразу свободен для остальных */
async function reserveNumbers(count: number): Promise<number[]> {
  if (!count) return [];
  return prisma.$transaction(async (tx) => {
    const max = (await tx.task.aggregate({ _max: { number: true } }))._max.number ?? 0;
    const cur = await tx.setting.findUnique({ where: { key: "tasks.nextNumber" } });
    const from = Math.max(Number(cur?.value ?? 52), max + 1);
    await tx.setting.upsert({ where: { key: "tasks.nextNumber" }, update: { value: from + count }, create: { key: "tasks.nextNumber", value: from + count } });
    return Array.from({ length: count }, (_, i) => from + i);
  });
}

/** Дата закрытия задачи из истории: из пакета, иначе срок, если он прошёл, иначе дата источника, иначе сегодня */
function closedDate(t: PackageTask, today: string): string {
  return t.closedAt ?? (t.due <= today ? t.due : (t.source.date ?? today));
}

export async function applyContentImport(actor: Actor, pkg: ContentPackage): Promise<ImportResult> {
  if (!canImportContent(actor)) fail(IMPORT_ONLY);
  // Сколько номеров нужно: по плану до транзакции. Если за это время что-то поменялось, недостающие возьмёт служба задач
  const pre = await context(prisma, actor);
  const numbers = await reserveNumbers((await planTasks(pre, pkg)).filter((p) => p.action === "add").length);
  return prisma.$transaction(
    async (tx) => {
      // Две загрузки сразу идут по очереди: вторая видит ключи первой и ничего не дублирует
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('content.import'))`;
      const ctx = await context(tx, actor);
      const plan = await buildPlan(ctx, pkg);
      const where = <T>(what: string, run: () => Promise<T>): Promise<T> =>
        run().catch((error: unknown) => {
          if (error instanceof TaskRuleError) throw new TaskRuleError(`Загрузка не прошла, база не тронута. ${what}: ${error.message}`);
          throw error;
        });
      const tally = { tasks: counts(plan.tasks), decisions: counts(plan.decisions), goals: counts(plan.goals), links: counts(plan.links) };
      const goalIds = new Map<string, string>();
      let goalsDone = 0;

      // Цели: сначала сами цели, потом цель выше
      for (const p of plan.goals) {
        const g = p.g;
        if (p.existingId) goalIds.set(g.key, p.existingId);
        if (p.action === "skip") continue;
        let id = p.existingId;
        if (p.action === "add") {
          id = (await where(`Цель «${short(g.title)}»`, () =>
            createGoal(actor, { quarter: g.quarter, title: g.title, description: g.description, metric: g.metric, base: g.base, target: g.target, team: p.teamId, owner: p.ownerSlug ?? null, link: g.link, code: g.code }, tx),
          )).id;
          goalIds.set(g.key, id);
        } else if (p.fields && Object.keys(p.fields).length) {
          await where(`Цель «${short(g.title)}»`, () => updateGoal(actor, id!, p.fields!, tx));
        }
        goalsDone += 1;
      }
      for (const p of plan.goals) {
        if (!p.parent) continue;
        const id = goalIds.get(p.g.key);
        const parentId = p.parent.id ?? (p.parent.key ? goalIds.get(p.parent.key) : undefined);
        if (id && parentId) await where(`Цель «${short(p.g.title)}»`, () => updateGoal(actor, id, { parent: parentId }, tx));
      }
      for (const p of plan.goals) {
        const id = goalIds.get(p.g.key);
        if (p.action === "skip" || !id) continue;
        const row = await tx.goal.findUniqueOrThrow({ where: { id } });
        await remember(tx, "goal", p.g.key, id, p.g, Object.fromEntries(Object.keys(goalPayload(p.g)).map((f) => [f, (row as Record<string, unknown>)[f] ?? null])));
      }

      // Задачи: служба задач ставит их от имени того, кто загружает
      const taskNumbers = new Map<string, number>();
      const created: number[] = [];
      for (const p of plan.tasks) {
        const t = p.t;
        if (p.number) taskNumbers.set(t.key, p.number);
        if (p.action === "skip") continue;
        let number = p.number!;
        if (p.action === "add") {
          const res = await where(`Задача «${short(t.title)}»`, () =>
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
              { history: { sourceDate: t.source.date, number: numbers.shift() } },
            ),
          );
          number = res.task.number;
          taskNumbers.set(t.key, number);
          created.push(number);
          if (t.whereNow) await where(`Задача ${number}`, () => updateWhere(actor, number, t.whereNow!, tx));
          if (t.status !== "in-progress") await where(`Задача ${number}`, () => changeStatus(actor, number, t.status, t.resolution ?? undefined, tx));
          if (CLOSED.includes(t.status)) {
            // Задача из истории закрыта тогда, а не сегодня: иначе она попадёт в «Закрыто за неделю». События «Мне»
            // о ней только мешают
            const row = await tx.task.findUniqueOrThrow({ where: { number }, select: { id: true } });
            await tx.task.update({ where: { id: row.id }, data: { closedAt: new Date(`${closedDate(t, ctx.today)}T12:00:00+03:00`) } });
            await tx.inboxEvent.deleteMany({ where: { taskId: row.id } });
          }
        } else {
          const a = p.apply!;
          if (a.edit) await where(`Задача ${number}`, () => editTask(actor, number, a.edit!, tx));
          if (a.whereNow) await where(`Задача ${number}`, () => updateWhere(actor, number, a.whereNow!, tx));
          if (a.due) await where(`Задача ${number}`, () => transferDue(actor, number, a.due!, IMPORT_TRANSFER_REASON, tx));
          if (a.status) {
            await where(`Задача ${number}`, () => changeStatus(actor, number, t.status, t.resolution ?? undefined, tx));
            if (CLOSED.includes(t.status)) await tx.task.update({ where: { number }, data: { closedAt: new Date(`${closedDate(t, ctx.today)}T12:00:00+03:00`) } });
          }
        }
        // Запоминаем поля такими, какими они стали в ресурсе: по ним следующая загрузка поймёт, правили ли их потом
        const row = await tx.task.findUniqueOrThrow({ where: { number } });
        await remember(tx, "task", t.key, row.id, t, taskApplied(row));
      }

      // Решения: к команде и дате; без встречи, если её в ресурсе не было. Владельцам о старых решениях не сообщаем
      let decisionsDone = 0;
      for (const p of plan.decisions) {
        if (p.action === "skip") continue;
        const d = p.d;
        const taskIds: string[] = [];
        for (const ref of d.tasks) {
          const n = "number" in ref ? ref.number : taskNumbers.get(ref.key);
          const row = n ? await tx.task.findUnique({ where: { number: n }, select: { id: true, archivedAt: true } }) : null;
          if (row && !row.archivedAt) taskIds.push(row.id);
          else ctx.notes.push({ what: `Решение «${short(d.text)}»`, text: `задача ${"number" in ref ? ref.number : ref.key} не нашлась, решение загрузится без неё` });
        }
        let id = p.existingId;
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
          id = row.id;
          await tx.auditLog.create({
            data: { action: "meeting.decision", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "decision", entityId: row.id, field: "Решение из наполнения", after: `${formatLong(d.date)}: ${d.text}`, ip: actor.ip ?? null, via: actor.via ?? null },
          });
        } else {
          const cur = await tx.decision.findUniqueOrThrow({ where: { id: id! } });
          if (p.data && Object.keys(p.data).length) {
            await tx.decision.update({ where: { id: cur.id }, data: p.data });
            await tx.auditLog.create({
              data: { action: "meeting.decision", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "decision", entityId: cur.id, field: "Решение обновлено из наполнения", before: cur.text, after: d.text, ip: actor.ip ?? null, via: actor.via ?? null },
            });
          }
          // Новые связи с задачами добавляем, прежние не убираем
          if (taskIds.length) await tx.decisionTask.createMany({ data: taskIds.map((taskId) => ({ decisionId: cur.id, taskId })), skipDuplicates: true });
        }
        const after = await tx.decision.findUniqueOrThrow({ where: { id: id! } });
        await remember(tx, "decision", d.key, after.id, d, { text: after.text, ownerId: after.ownerId, status: after.status === "CANCELLED" ? "cancelled" : "active" });
        decisionsDone += 1;
      }

      // Связи задач с целями: через то же правило, что в карточке задачи
      let linksDone = 0;
      for (const p of plan.links) {
        const l = p.l;
        if (p.action === "skip") {
          if (p.remember) {
            const known = ctx.keys.get(key("link", l.key))!;
            await remember(tx, "link", l.key, known.entityId, l, payloadOf(known).applied);
          }
          continue;
        }
        const number = "number" in l.task ? l.task.number : taskNumbers.get(l.task.key);
        let id: string | null = null;
        if ("key" in l.goal) id = goalIds.get(l.goal.key) ?? ctx.keys.get(key("goal", l.goal.key))?.entityId ?? null;
        else {
          const row = number ? await tx.task.findUnique({ where: { number }, select: { due: true } }) : null;
          const found = await tx.goal.findMany({ where: { code: l.goal.code, quarter: { in: [quarterOf(ctx.today), ...(row ? [quarterOf(isoFromDbDate(row.due))] : [])] } }, select: { id: true } });
          id = found.length === 1 ? found[0]!.id : null;
        }
        if (!number || !id) {
          // Задача или цель не загрузились в этот раз: связь пропускается, счёт поправляется
          ctx.notes.push({ what: `Связь ${l.key}`, text: "задача или цель не нашлась после загрузки, связь пропущена" });
          tally.links[p.action] -= 1;
          tally.links.skip += 1;
          continue;
        }
        const task = await tx.task.findUniqueOrThrow({ where: { number }, select: { goalId: true } });
        if (task.goalId !== id) await where(`Связь задачи ${number} с целью`, () => linkTaskGoal(actor, number, id, tx));
        await remember(tx, "link", l.key, String(number), l, { goalId: id });
        linksDone += 1;
      }

      const result: ImportResult = { ...summarize(ctx, pkg, plan, tally), applied: { tasks: created, goals: goalsDone, decisions: decisionsDone, links: linksDone } };
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
