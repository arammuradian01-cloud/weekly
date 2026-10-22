// Импорт наполнения (этап 67). Владелец при личном входе в режиме управления загружает пакет: сначала предпросмотр
// (что добавится, обновится, пропустится, кого и каких команд не нашли, что не загрузится и почему), потом загрузка
// одной транзакцией.
//
// Правила:
// - загрузка только добавляет и обновляет записи с тем же внешним ключом, ничего не удаляет;
// - задачи ставятся через службу задач с её правилами (автор: тот, кто загружает), цели через службу целей,
//   связь задачи с целью через ту же проверку, что в карточке;
// - повторная загрузка того же пакета ничего не меняет: ключ и отпечаток записи совпадают;
// - у каждого поля в ключе хранится база: значение, которое загрузка оставила в ресурсе. Поле, которое в ресурсе
//   поменяли после загрузки (не совпадает с базой), загрузка не трогает и базу не сдвигает: правка живёт и после
//   следующих загрузок. Поле, которое загрузка не смогла записать, тоже остаётся с прежней базой;
// - у цели из борда лидера загрузке принадлежат только поля, которые она заполнила пустыми: остальные поля борда она
//   не перезаписывает никогда;
// - план считается один раз и для предпросмотра, и для загрузки: что предпросмотр обещал, то загрузка и делает. Правила
//   служб, которые иначе уронили бы загрузку, проверяются в плане: такая запись пропускается с причиной;
// - любая ошибка правила при загрузке откатывает всё: база остаётся как была, владелец видит запись и причину.

import { prisma } from "@/lib/db";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { TOP_TEAM, ancestorsOf, loadTeamNodes, type TeamNode } from "@/lib/org/scope";
import { NameIndex, normName } from "@/lib/bord/names";
import { TaskRuleError, changeStatus, createTaskIn, editTask, releaseTaskNumbers, reserveTaskNumbers, transferDue, updateWhere, type Actor } from "@/lib/tasks/service";
import { approvalRule } from "@/lib/tasks/approval";
import { createGoal, linkTaskGoal, updateGoal } from "@/lib/goals/service";
import { goalFits } from "@/lib/goals/personal";
import { quarterOf } from "@/lib/goals/parse";
import { dbDate, isoFromDbDate, moscowToday } from "@/lib/tasks/dates";
import { statusCode } from "@/lib/tasks/codes";
import { formatLong, toCalendar, type IsoDate } from "@/domain/dates";
import { moscowDateTime } from "@/lib/week";
import { sameTask } from "@/lib/meeting/parse-types";
import { recordHash, shortText as short, type ContentPackage, type PackageDecision, type PackageGoal, type PackageLink, type PackageTask } from "./package";

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

export const IMPORT_ONLY = "Наполнение загружает владелец при личном входе в режиме управления";
export const ALL_LEADERS_NAME = "Все лидеры";
/** Причина переноса срока, когда пакет поменял срок задачи после прошлой загрузки */
export const IMPORT_TRANSFER_REASON = "Срок обновлён из пакета наполнения";
const UNCHANGED = "без изменений";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export function canImportContent(actor: Pick<Actor, "role" | "management" | "via">): boolean {
  return actor.role === "OWNER" && actor.management === "OWNER" && !!actor.via && actor.via !== "TEAM";
}

/** duplicates: загружать и вероятные дубли того, что уже есть в ресурсе (по умолчанию они пропускаются) */
export type ImportOptions = { duplicates?: boolean };

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
  /** Не загрузятся, пока их не исправят в пакете: кадровые сведения, решение без команды, правило службы */
  errors: ImportLine[];
  /** Загрузятся, но не так, как в пакете: срок в прошлом у открытой задачи, цель выше не подошла */
  warnings: ImportLine[];
  /** Вероятные дубли того, что уже есть в ресурсе: по умолчанию пропускаются */
  duplicates: ImportLine[];
  /** Загрузка возьмёт и вероятные дубли */
  withDuplicates: boolean;
  /** Что пропустится и почему, и что обновится не целиком */
  notes: ImportLine[];
  /** Сколько человек узнают о новых открытых задачах в «Мне»: ответственные, соисполнители, согласующие */
  notified: number;
};

type Kind = "task" | "decision" | "goal" | "link";
type KeyRow = { kind: string; key: string; entityId: string; hash: string; payload: Prisma.JsonValue };
type Person = { id: string; slug: string; fullName: string; shortName: string; active: boolean; role: string };

/** Справочники для сопоставления: люди, команды, направления, источники, уже загруженные ключи, что есть в ресурсе */
type Ctx = {
  db: Db;
  actor: Actor;
  opts: ImportOptions;
  today: IsoDate;
  people: Person[];
  index: NameIndex;
  nodes: TeamNode[];
  directions: Set<string>;
  sources: Set<string>;
  keys: Map<string, KeyRow>;
  excluded: Map<string, string>;
  /** Задачи ресурса для поиска дублей: owner это id ответственного или «all» */
  tasks: { number: number; title: string; owner: string | null }[];
  /** Решения ресурса за даты пакета для поиска дублей */
  decisions: { teamId: string; date: IsoDate; text: string }[];
  /** Согласующий человека из другого департамента для того, кто загружает (кеш на одну загрузку) */
  approvers: Map<string, string | null>;
  missingPeople: Set<string>;
  missingTeams: Set<string>;
  notes: ImportLine[];
  warnings: ImportLine[];
};

const key = (kind: Kind, k: string) => `${kind}/${k}`;

async function context(db: Db, actor: Actor, pkg: ContentPackage, opts: ImportOptions): Promise<Ctx> {
  const dates = [...new Set(pkg.decisions.map((d) => d.date).filter(Boolean))];
  const [people, nodes, directions, sources, keys, tasks, decisions] = await Promise.all([
    db.person.findMany({ select: { id: true, slug: true, fullName: true, shortName: true, active: true, role: true } }),
    loadTeamNodes(db),
    db.dictionaryItem.findMany({ where: { kind: "DIRECTION", active: true }, select: { code: true } }),
    db.dictionaryItem.findMany({ where: { kind: "TASK_SOURCE", active: true }, select: { code: true } }),
    db.contentImportKey.findMany(),
    db.task.findMany({ where: { archivedAt: null }, select: { number: true, title: true, ownerId: true, ownerAll: true } }),
    dates.length ? db.decision.findMany({ where: { date: { in: dates.map(dbDate) } }, select: { teamId: true, date: true, text: true } }) : Promise.resolve([]),
  ]);
  return {
    db,
    actor,
    opts,
    today: moscowToday(),
    people,
    index: new NameIndex(people.filter((p) => p.active)),
    nodes,
    directions: new Set(directions.map((d) => d.code)),
    sources: new Set(sources.map((d) => d.code)),
    keys: new Map(keys.map((k) => [key(k.kind as Kind, k.key), k])),
    excluded: new Map(pkg.excluded.map((e) => [key(e.kind, e.key), e.text])),
    tasks: tasks.map((t) => ({ number: t.number, title: t.title, owner: t.ownerAll ? "all" : t.ownerId })),
    decisions: decisions.map((d) => ({ teamId: d.teamId, date: isoFromDbDate(d.date), text: d.text })),
    approvers: new Map(),
    missingPeople: new Set(),
    missingTeams: new Set(),
    notes: [],
    warnings: [],
  };
}

/** Человек по ФИО как в ресурсе. Выключенный и неоднозначный считаются ненайденными */
function personOf(ctx: Ctx, name: string): Person | null {
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

/** Согласующий человека из другого департамента для того, кто загружает: он узнает о задаче (этап 54) */
async function approverOf(ctx: Ctx, personId: string): Promise<string | null> {
  if (!ctx.approvers.has(personId)) ctx.approvers.set(personId, (await approvalRule(ctx.db, ctx.actor.personId, personId, [ctx.actor.personId]))?.approverId ?? null);
  return ctx.approvers.get(personId) ?? null;
}

const asRecord = (v: Prisma.JsonValue | undefined): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const CLOSED = ["done", "partial", "failed", "cancelled"];
/** Похожий текст: то же без учёта регистра и знаков или почти те же слова (то же правило, что у разбора встречи) */
const similar = (a: string, b: string) => sameTask({ title: a, owner: "x" }, { title: b, owner: "x" });

/**
 * Поле по трём значениям: база в ключе (old), ресурс сейчас (cur), пакет (next). Пакет поле не менял: ничего. Ресурс
 * уже такой, как в пакете: база сдвигается. Ресурс не трогали после загрузки: поле пишется. Иначе поле правили в
 * ресурсе: не трогаем, база остаётся прежней, чтобы и следующая загрузка эту правку не затёрла
 */
function threeWay(old: unknown, cur: unknown, next: unknown): "keep" | "moved" | "apply" | "edited" {
  if (same(old, next)) return "keep";
  if (same(cur, next)) return "moved";
  if (same(cur, old)) return "apply";
  return "edited";
}

// ---------- План ----------

type Level = "error" | "duplicate" | "warning";
type Step = { action: "add" | "update" | "skip" | "match"; reason?: string; level?: Level; notes?: string[] };

type ParentTarget = { key: string } | { id: string };
type GoalPlan = Step & {
  g: PackageGoal;
  teamId?: string;
  ownerSlug?: string | null;
  ownerId?: string | null;
  existingId?: string;
  /** Цель в ресурсе: команда, квартал, цель выше (у новой цели из плана) */
  quarter?: string;
  parentId?: string | null;
  input?: Record<string, string | null>;
  kept?: Record<string, unknown>;
  parent?: ParentTarget;
  parentNote?: string;
};
type TaskUpdate = { edit?: { title?: string; outcome?: string }; whereNow?: string; due?: IsoDate; status?: { code: PackageTask["status"]; resolution: string | null } };
type TaskPlan = Step & {
  t: PackageTask;
  teamId?: string;
  owner?: string;
  ownerId?: string | null;
  co?: { slug: string; id: string }[];
  number?: number;
  /** Срок, с которым задача встанет: у открытой задачи не раньше сегодняшнего */
  due?: IsoDate;
  update?: TaskUpdate;
  kept?: Record<string, unknown>;
};
type DecisionPlan = Step & {
  d: PackageDecision;
  teamId?: string;
  ownerId?: string | null;
  existingId?: string;
  tasks?: ({ key: string } | { number: number })[];
  data?: Prisma.DecisionUncheckedUpdateInput;
  kept?: Record<string, unknown>;
};
type LinkPlan = Step & { l: PackageLink; goal?: ParentTarget };

type Plan = { goals: GoalPlan[]; tasks: TaskPlan[]; decisions: DecisionPlan[]; links: LinkPlan[] };

const GOAL_FIELDS = ["title", "description", "metric", "base", "target", "link", "code"] as const;
const GOAL_LABELS: Record<string, string> = { title: "Цель", description: "Описание", metric: "Метрика", base: "База", target: "Целевое значение", link: "Ссылка", code: "Номер" };
const TASK_LABELS: Record<string, string> = { title: "Задача", outcome: "Что нужно сделать", due: "Срок", status: "Статус", resolution: "Итог", whereNow: "Где сейчас" };

function goalPayload(g: PackageGoal): Record<string, string | null> {
  return { title: g.title, description: g.description, metric: g.metric, base: g.base, target: g.target, link: g.link, code: g.code };
}

/** База цели в ключе: поля и ссылка на цель выше, как она была в пакете (по ней видно, поменял ли пакет цель выше) */
const goalKept = (g: PackageGoal, fields: Record<string, unknown>) => ({ ...fields, parentRef: g.parent ?? null });

async function planGoals(ctx: Ctx, pkg: ContentPackage): Promise<GoalPlan[]> {
  const out: GoalPlan[] = [];
  for (const g of pkg.goals) {
    const hr = ctx.excluded.get(key("goal", g.key));
    if (hr) {
      out.push({ g, action: "skip", level: "error", reason: hr });
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
    const base = { g, teamId: team.id, ownerSlug: owner?.slug ?? null, ownerId: owner?.id ?? null };
    const known = ctx.keys.get(key("goal", g.key));
    const next = goalPayload(g);
    if (known) {
      const cur = await ctx.db.goal.findUnique({ where: { id: known.entityId } });
      if (!cur) {
        out.push({ g, action: "skip", reason: "ключ есть, цели в ресурсе нет: её удалили, загрузка её не возвращает" });
        continue;
      }
      const at = { ...base, teamId: cur.teamId, existingId: cur.id, quarter: cur.quarter, parentId: cur.parentId };
      if (known.hash === recordHash(g)) {
        out.push({ ...at, action: "skip", reason: UNCHANGED });
        continue;
      }
      const old = asRecord(known.payload);
      // У цели из борда загрузке принадлежат только поля, которые она заполнила: остальные поля борда не трогаются
      const owned = Array.isArray(old.owned) ? (old.owned as string[]).filter((f) => typeof f === "string") : null;
      const input: Record<string, string | null> = {};
      const kept: Record<string, unknown> = { ...next };
      const notes: string[] = [];
      for (const f of GOAL_FIELDS) {
        const now = (cur as Record<string, unknown>)[f] ?? null;
        if (owned && !owned.includes(f)) {
          // Поле борда: загрузка заполняет его, только если в ресурсе оно пустое, и тогда оно становится её полем
          if (!now && next[f]) {
            input[f] = next[f];
            owned.push(f);
          }
          continue;
        }
        const way = threeWay(old[f], now, next[f]);
        if (way === "apply") input[f] = next[f];
        else if (way === "keep" || way === "edited") kept[f] = old[f] ?? null;
        if (way === "edited") notes.push(`поле «${GOAL_LABELS[f]}» правили в ресурсе, загрузка его не тронет`);
      }
      // Номер цели занят другой целью той же команды и квартала: служба целей откажет, номер не трогаем
      if (input.code && (await ctx.db.goal.findFirst({ where: { quarter: cur.quarter, teamId: cur.teamId, code: input.code, id: { not: cur.id } }, select: { id: true } }))) {
        notes.push(`номер ${input.code} уже у другой цели команды, номер не изменится`);
        kept.code = old.code ?? null;
        delete input.code;
      }
      if (owned) kept.owned = owned;
      out.push({ ...at, action: "update", input, kept: goalKept(g, kept), notes });
      continue;
    }
    // Цель с тем же номером уже есть в команде (например, из борда лидера): ключ привязывается к ней, загрузка
    // заполняет только пустые поля, и только они дальше принадлежат загрузке
    const byCode = g.code ? await ctx.db.goal.findFirst({ where: { quarter: g.quarter, teamId: team.id, code: g.code } }) : null;
    if (byCode) {
      const input: Record<string, string | null> = {};
      const owned: string[] = [];
      for (const f of GOAL_FIELDS) {
        if (!(byCode as Record<string, unknown>)[f] && next[f]) {
          input[f] = next[f];
          owned.push(f);
        }
      }
      out.push({ ...base, action: "match", existingId: byCode.id, quarter: byCode.quarter, parentId: byCode.parentId, input, kept: goalKept(g, { ...next, owned }), reason: `${g.code} уже есть в ресурсе: загрузка заполнит только пустые поля` });
      continue;
    }
    out.push({ ...base, action: "add", quarter: g.quarter, parentId: null, kept: goalKept(g, next) });
  }
  return out;
}

/** Цель выше: по правилам службы целей (тот же квартал, своя команда или команда выше, без петли). Иначе без неё */
async function planParents(ctx: Ctx, goals: GoalPlan[]): Promise<void> {
  const nodeOf = (p: GoalPlan) => p.existingId ?? `key:${p.g.key}`;
  const planned = new Map<string, string>();
  for (const p of goals) {
    if (p.action === "skip" || !p.g.parent) continue;
    // Цель уже загружена, а цель выше в пакете та же: цель выше в ресурсе не трогаем (её могли снять или сменить руками)
    const old = p.action === "update" ? asRecord(ctx.keys.get(key("goal", p.g.key))?.payload) : null;
    if (old && "parentRef" in old && same(old.parentRef, p.g.parent)) continue;
    const no = (text: string) => {
      p.parentNote = text;
    };
    let target: ParentTarget | null = null;
    let parent: { node: string; teamId: string; quarter: string } | null = null;
    if ("key" in p.g.parent) {
      const pp = goals.find((x) => x.g.key === (p.g.parent as { key: string }).key);
      if (!pp || (pp.action === "skip" && !pp.existingId)) {
        no(`цель выше не загружается${pp?.reason ? `: ${pp.reason}` : ""}; цель загрузится без неё`);
        continue;
      }
      target = pp.existingId ? { id: pp.existingId } : { key: pp.g.key };
      parent = { node: nodeOf(pp), teamId: pp.teamId!, quarter: pp.quarter! };
    } else {
      const found = await ctx.db.goal.findMany({ where: { code: p.g.parent.code, quarter: p.quarter }, select: { id: true, teamId: true, quarter: true } });
      if (found.length !== 1) {
        no(`цели выше ${p.g.parent.code} ${found.length ? "несколько с таким номером" : "нет в ресурсе в том же квартале"}; цель загрузится без неё`);
        continue;
      }
      target = { id: found[0]!.id };
      parent = { node: found[0]!.id, teamId: found[0]!.teamId, quarter: found[0]!.quarter };
    }
    const self = nodeOf(p);
    // Цель выше ставим новой цели и цели, у которой её ещё нет; заданную в ресурсе не меняем
    if (p.parentId && "id" in target && p.parentId === target.id) continue;
    if (p.parentId) {
      no("цель выше уже задана в ресурсе, загрузка её не тронет");
      continue;
    }
    if (parent.quarter !== p.quarter) {
      no("цель выше из другого квартала; цель загрузится без неё");
      continue;
    }
    if (![p.teamId!, ...ancestorsOf(ctx.nodes, p.teamId!)].includes(parent.teamId)) {
      no("цель выше не своей команды и не команды выше; цель загрузится без неё");
      continue;
    }
    // Петля: идём вверх от цели выше по плану и по ресурсу
    let cur: string | null = parent.node;
    const guard = new Set<string>();
    let loop = false;
    while (cur && !guard.has(cur)) {
      if (cur === self) {
        loop = true;
        break;
      }
      guard.add(cur);
      cur = planned.get(cur) ?? (cur.startsWith("key:") ? null : ((await ctx.db.goal.findUnique({ where: { id: cur }, select: { parentId: true } }))?.parentId ?? null));
    }
    if (loop) {
      no("цель не может стоять ниже самой себя; цель загрузится без цели выше");
      continue;
    }
    planned.set(self, parent.node);
    p.parent = target;
  }
}

function taskPayload(t: PackageTask, due: IsoDate) {
  // Итог только у закрытой задачи: у открытой служба задач его не хранит
  return { title: t.title, outcome: t.outcome, due, dueRaw: t.due, status: t.status, resolution: CLOSED.includes(t.status) ? t.resolution : null, whereNow: t.whereNow };
}

async function planTasks(ctx: Ctx, pkg: ContentPackage): Promise<TaskPlan[]> {
  const out: TaskPlan[] = [];
  for (const t of pkg.tasks) {
    const hr = ctx.excluded.get(key("task", t.key));
    if (hr) {
      out.push({ t, action: "skip", level: "error", reason: hr });
      continue;
    }
    const all = normName(t.owner) === normName(ALL_LEADERS_NAME);
    const owner = all ? null : personOf(ctx, t.owner);
    if (!all && !owner) {
      out.push({ t, action: "skip", reason: `ответственный «${t.owner}» не найден в ресурсе` });
      continue;
    }
    if (owner?.role === "OBSERVER") {
      out.push({ t, action: "skip", level: "error", reason: `${owner.fullName} наблюдатель: наблюдатель задач не ведёт` });
      continue;
    }
    if (!ctx.directions.has(t.direction)) {
      out.push({ t, action: "skip", level: "error", reason: `направления «${t.direction}» нет в справочнике или оно скрыто` });
      continue;
    }
    if (!ctx.sources.has(t.source.kind)) {
      out.push({ t, action: "skip", level: "error", reason: `источника «${t.source.kind}» нет в справочнике или он скрыт` });
      continue;
    }
    const team = t.team ? teamByName(ctx, t.team) : all ? (ctx.nodes.find((n) => n.id === TOP_TEAM) ?? null) : teamOfPerson(ctx, owner!.id, true);
    if (!team) {
      out.push({ t, action: "skip", reason: t.team ? `команды «${t.team}» нет в ресурсе` : `у ${t.owner} нет команды в ресурсе` });
      continue;
    }
    if (all && team.id !== TOP_TEAM) {
      out.push({ t, action: "skip", level: "error", reason: "«Все лидеры» бывают только у задач топ-команды" });
      continue;
    }
    const co: { slug: string; id: string }[] = [];
    const notes: string[] = [];
    for (const name of t.coExecutors) {
      const p = personOf(ctx, name);
      if (p && p.role !== "OBSERVER" && p.id !== owner?.id) co.push({ slug: p.slug, id: p.id });
      else if (!p) notes.push(`соисполнитель «${name}» не найден, задача загрузится без него`);
      else if (p.role === "OBSERVER") notes.push(`${p.fullName} наблюдатель, соисполнителем не будет`);
    }
    const base = { t, teamId: team.id, owner: all ? "all" : owner!.slug, ownerId: owner?.id ?? null, co, notes };
    const known = ctx.keys.get(key("task", t.key));
    if (known) {
      const row = await ctx.db.task.findUnique({ where: { id: known.entityId } });
      if (!row) out.push({ ...base, action: "skip", reason: "ключ есть, задачи в ресурсе нет: её удалили, загрузка её не возвращает" });
      else if (known.hash === recordHash(t)) out.push({ ...base, action: "skip", number: row.number, reason: UNCHANGED });
      else if (row.archivedAt) out.push({ ...base, action: "skip", number: row.number, reason: `задача ${row.number} в архиве, загрузка её не правит` });
      else {
        const u = planTaskUpdate(ctx, t, asRecord(known.payload), row);
        out.push({ ...base, ...u, notes: [...notes, ...(u.notes ?? [])], action: "update", number: row.number });
      }
      continue;
    }
    // Открытая задача со сроком в прошлом встаёт со сроком на сегодня: служба задач не ставит открытых задач в прошлое
    const closed = CLOSED.includes(t.status);
    const due = !closed && t.due < ctx.today ? ctx.today : t.due;
    const step: TaskPlan = { ...base, action: "add", due };
    // Вероятный дубль: тот же ответственный и похожее название у задачи, которая уже есть в ресурсе
    const twin = ctx.tasks.find((e) => sameTask({ title: t.title, owner: base.owner === "all" ? "all" : base.ownerId }, e));
    if (twin) {
      const text = `похожа на задачу ${twin.number} «${short(twin.title)}»: тот же ответственный и похожее название`;
      if (!ctx.opts.duplicates) {
        out.push({ ...step, action: "skip", level: "duplicate", reason: `${text}, пропустится` });
        continue;
      }
      step.level = "duplicate";
      step.reason = `${text}, загрузится, как вы выбрали`;
    }
    if (due !== t.due) ctx.warnings.push({ what: `Задача «${short(t.title)}»`, text: `срок ${formatLong(t.due)} уже прошёл, а задача открыта: встанет со сроком на сегодня, ${formatLong(due)}. Поправьте срок в пакете или в ресурсе` });
    out.push(step);
  }
  return out;
}

/** Что загрузка поменяет в задаче, которая уже загружена, и какая база останется в ключе */
function planTaskUpdate(ctx: Ctx, t: PackageTask, old: Record<string, unknown>, row: { title: string; outcome: string; due: Date; status: Parameters<typeof statusCode>[0]; resolution: string | null; whereNow: string | null }): Pick<TaskPlan, "update" | "kept" | "notes"> {
  const next = taskPayload(t, t.due);
  const cur: Record<string, unknown> = { title: row.title, outcome: row.outcome, due: isoFromDbDate(row.due), status: statusCode(row.status), resolution: row.resolution, whereNow: row.whereNow || null };
  const kept: Record<string, unknown> = { ...next };
  const notes: string[] = [];
  const update: TaskUpdate = {};
  const edited = (f: string) => notes.push(`поле «${TASK_LABELS[f]}» правили в ресурсе, загрузка его не тронет`);

  for (const f of ["title", "outcome"] as const) {
    const way = threeWay(old[f], cur[f], next[f]);
    if (way === "apply") update.edit = { ...update.edit, [f]: next[f] };
    else if (way === "keep" || way === "edited") kept[f] = old[f] ?? null;
    if (way === "edited") edited(f);
  }

  const where = threeWay(old.whereNow, cur.whereNow, next.whereNow);
  if (where === "apply" && next.whereNow) update.whereNow = next.whereNow;
  else if (where !== "moved") kept.whereNow = old.whereNow ?? null;
  if (where === "edited") edited("whereNow");
  if (where === "apply" && !next.whereNow) notes.push("«Где сейчас» в пакете пустое: в ресурсе останется прежний текст, стирают его только в карточке");

  // Срок: меняется, только если в пакете поменялся сам срок. База: срок, с которым задача стоит после загрузки
  const curStatusClosed = CLOSED.includes(String(cur.status));
  kept.due = old.due ?? null;
  if (!same(old.dueRaw ?? old.due, t.due)) {
    const way = same(cur.due, t.due) ? "moved" : same(cur.due, old.due) ? "apply" : "edited";
    if (way === "moved") kept.due = t.due;
    else if (way === "edited") edited("due");
    else if (curStatusClosed || t.due < ctx.today) notes.push(`срок ${formatLong(t.due)} не перенесён: задача закрыта или срок уже прошёл`);
    else {
      update.due = t.due;
      kept.due = t.due;
    }
  }

  // Статус и итог: итог в ресурсе меняется только вместе со статусом, поэтому решаем о них вместе
  const statusChanged = !same(old.status, next.status);
  const resolutionChanged = !same(old.resolution, next.resolution);
  kept.status = old.status ?? null;
  kept.resolution = old.resolution ?? null;
  if (statusChanged || resolutionChanged) {
    const statusUntouched = same(cur.status, old.status);
    const resolutionUntouched = same(cur.resolution, old.resolution);
    if (same(cur.status, next.status) && same(cur.resolution, next.resolution)) {
      kept.status = next.status;
      kept.resolution = next.resolution;
    } else if (statusUntouched && resolutionUntouched && cur.status !== next.status) {
      update.status = { code: t.status, resolution: next.resolution };
      kept.status = next.status;
      kept.resolution = next.resolution;
    } else if (!statusUntouched) edited("status");
    else if (!resolutionUntouched) notes.push("итог правили в ресурсе: статус и итог из пакета загрузка не тронет");
    else notes.push("итог в пакете другой, а статус тот же: итог в ресурсе меняют только вместе со статусом, в карточке задачи");
  }
  return { update, kept, notes };
}

async function planDecisions(ctx: Ctx, pkg: ContentPackage, tasks: TaskPlan[]): Promise<DecisionPlan[]> {
  const out: DecisionPlan[] = [];
  for (const d of pkg.decisions) {
    const hr = ctx.excluded.get(key("decision", d.key));
    if (hr) {
      out.push({ d, action: "skip", level: "error", reason: hr });
      continue;
    }
    // Решение без команды в топ-команду само не уходит: команду пишут в пакете
    if (!d.team) {
      out.push({ d, action: "skip", level: "error", reason: "нет команды: решение без команды не загружается, укажите команду в пакете" });
      continue;
    }
    const team = teamByName(ctx, d.team);
    if (!team) {
      out.push({ d, action: "skip", reason: `команды «${d.team}» нет в ресурсе` });
      continue;
    }
    const notes: string[] = [];
    const owner = d.owner ? personOf(ctx, d.owner) : null;
    if (d.owner && !owner) notes.push(`владелец «${d.owner}» не найден, решение загрузится без владельца`);
    // Задачи решения: из пакета (по ключу, если задача загружается или уже загружена) или из ресурса по номеру
    const refs: ({ key: string } | { number: number })[] = [];
    for (const ref of d.tasks) {
      if ("number" in ref) {
        const row = await ctx.db.task.findUnique({ where: { number: ref.number }, select: { archivedAt: true } });
        if (row && !row.archivedAt) refs.push(ref);
        else notes.push(`задачи ${ref.number} нет в ресурсе или она в архиве, решение загрузится без неё`);
        continue;
      }
      const tp = tasks.find((p) => p.t.key === ref.key);
      if (tp && (tp.action === "add" || tp.number)) refs.push(ref);
      else notes.push(`задача «${short(tp?.t.title ?? ref.key)}» не загружается, решение загрузится без неё`);
    }
    const base = { d, teamId: team.id, ownerId: owner?.id ?? null, tasks: refs, notes };
    const known = ctx.keys.get(key("decision", d.key));
    if (known) {
      const cur = await ctx.db.decision.findUnique({ where: { id: known.entityId } });
      if (!cur) out.push({ d, action: "skip", reason: "ключ есть, решения в ресурсе нет: его удалили, загрузка его не возвращает" });
      else if (known.hash === recordHash(d)) out.push({ ...base, action: "skip", existingId: cur.id, reason: UNCHANGED });
      else {
        const u = planDecisionUpdate(ctx, d, owner?.id ?? null, asRecord(known.payload), cur);
        out.push({ ...base, ...u, notes: [...notes, ...(u.notes ?? [])], action: "update", existingId: cur.id });
      }
      continue;
    }
    const step: DecisionPlan = { ...base, action: "add" };
    // Вероятный дубль: решение той же команды за ту же дату с похожим текстом уже есть в ресурсе
    const twin = ctx.decisions.find((e) => e.teamId === team.id && e.date === d.date && similar(e.text, d.text));
    if (twin) {
      const text = `похоже на решение команды за ${formatLong(d.date)} «${short(twin.text)}»`;
      if (!ctx.opts.duplicates) {
        out.push({ ...step, action: "skip", level: "duplicate", reason: `${text}, пропустится` });
        continue;
      }
      step.level = "duplicate";
      step.reason = `${text}, загрузится, как вы выбрали`;
    }
    out.push(step);
  }
  return out;
}

function planDecisionUpdate(ctx: Ctx, d: PackageDecision, ownerId: string | null, old: Record<string, unknown>, cur: { text: string; ownerId: string | null; status: string }): Pick<DecisionPlan, "data" | "kept" | "notes"> {
  const next: Record<string, unknown> = { text: d.text, ownerId, status: d.status };
  const now: Record<string, unknown> = { text: cur.text, ownerId: cur.ownerId, status: cur.status === "CANCELLED" ? "cancelled" : "active" };
  const kept: Record<string, unknown> = { ...next };
  const data: Prisma.DecisionUncheckedUpdateInput = {};
  const notes: string[] = [];
  const labels: Record<string, string> = { text: "Решение", ownerId: "Владелец решения", status: "Статус решения" };
  for (const f of ["text", "ownerId", "status"] as const) {
    const way = threeWay(old[f], now[f], next[f]);
    if (way === "keep" || way === "edited") kept[f] = old[f] ?? null;
    if (way === "edited") notes.push(`поле «${labels[f]}» правили в ресурсе, загрузка его не тронет`);
    if (way !== "apply") continue;
    if (f === "text") data.text = d.text;
    else if (f === "ownerId") data.ownerId = ownerId;
    else if (d.status === "cancelled") Object.assign(data, { status: "CANCELLED", cancelReason: d.cancelReason, cancelledAt: new Date(), cancelledById: ctx.actor.personId });
    else Object.assign(data, { status: "ACTIVE", cancelReason: null, cancelledAt: null, cancelledById: null });
  }
  return { data, kept, notes };
}

type GoalInfo = { id: string | null; pending?: string; teamId?: string; ownerId?: string | null; source?: string; quarter?: string; skip?: string };

/** Цель связи: из пакета (по ключу) или уже в ресурсе (по номеру). Удалённая и снятая цель не подходят */
async function goalOfLink(ctx: Ctx, l: PackageLink, goals: GoalPlan[], quarters: string[]): Promise<GoalInfo> {
  const ref = l.goal;
  const select = { id: true, teamId: true, ownerId: true, source: true, quarter: true, result: true } as const;
  if ("key" in ref) {
    const plan = goals.find((p) => p.g.key === ref.key);
    if (!plan) return { id: null, skip: "цели нет в пакете" };
    if (plan.action === "add") return { id: null, pending: plan.g.key, teamId: plan.teamId, ownerId: plan.ownerId ?? null, source: "manual", quarter: plan.g.quarter };
    if (!plan.existingId) return { id: null, skip: `цель «${short(plan.g.title)}» не загружается: ${plan.reason}` };
    const g = await ctx.db.goal.findUnique({ where: { id: plan.existingId }, select });
    if (!g) return { id: null, skip: "цель удалили в ресурсе, связь пропущена" };
    if (g.result === "DROPPED") return { id: null, skip: "цель снята, связь пропущена" };
    return { id: g.id, teamId: g.teamId, ownerId: g.ownerId, source: g.source, quarter: g.quarter };
  }
  const found = await ctx.db.goal.findMany({ where: { code: ref.code, quarter: { in: quarters } }, select });
  if (found.length !== 1) return { id: null, skip: found.length > 1 ? `цель ${ref.code}: несколько целей с таким номером` : `цели ${ref.code} нет в ресурсе в текущем квартале или квартале срока` };
  const g = found[0]!;
  if (g.result === "DROPPED") return { id: null, skip: `цель ${ref.code} снята, связь пропущена` };
  return { id: g.id, teamId: g.teamId, ownerId: g.ownerId, source: g.source, quarter: g.quarter };
}

async function planLinks(ctx: Ctx, pkg: ContentPackage, tasks: TaskPlan[], goals: GoalPlan[]): Promise<LinkPlan[]> {
  const out: LinkPlan[] = [];
  for (const l of pkg.links) {
    const known = ctx.keys.get(key("link", l.key));
    if (known && known.hash === recordHash(l)) {
      out.push({ l, action: "skip", reason: UNCHANGED });
      continue;
    }
    const tp = "key" in l.task ? tasks.find((p) => p.t.key === (l.task as { key: string }).key) : undefined;
    if (tp && tp.action === "skip" && !tp.number) {
      out.push({ l, action: "skip", reason: `задача «${short(tp.t.title)}» не загружается: ${tp.reason}` });
      continue;
    }
    const number = "number" in l.task ? l.task.number : tp?.number;
    // Задача: новая из пакета (команда и люди из плана) или уже в ресурсе
    const row = number ? await ctx.db.task.findUnique({ where: { number }, select: { teamId: true, ownerId: true, due: true, goalId: true, archivedAt: true, coExecutors: { select: { personId: true } } } }) : null;
    if (number && !row) {
      out.push({ l, action: "skip", reason: `задачи ${number} нет в ресурсе` });
      continue;
    }
    if (row?.archivedAt) {
      out.push({ l, action: "skip", reason: `задача ${number} в архиве` });
      continue;
    }
    if (!row && !tp) {
      out.push({ l, action: "skip", reason: "задачи нет в пакете" });
      continue;
    }
    const due = row ? isoFromDbDate(row.due) : tp!.due!;
    const quarters = [quarterOf(ctx.today), quarterOf(due)];
    const goal = await goalOfLink(ctx, l, goals, quarters);
    if (goal.skip) {
      out.push({ l, action: "skip", reason: goal.skip });
      continue;
    }
    if (goal.quarter && !quarters.includes(goal.quarter)) {
      out.push({ l, action: "skip", reason: "цель из другого квартала: задачу привязывают к цели текущего квартала или квартала её срока" });
      continue;
    }
    const teamId = row?.teamId ?? tp!.teamId!;
    const people = row ? [...(row.ownerId ? [row.ownerId] : []), ...row.coExecutors.map((c) => c.personId)] : [...(tp!.ownerId ? [tp!.ownerId] : []), ...(tp!.co ?? []).map((c) => c.id)];
    if (goal.teamId && !goalFits({ source: goal.source ?? "manual", ownerId: goal.ownerId ?? null, teamId: goal.teamId }, { teamId }, people, ctx.nodes)) {
      out.push({ l, action: "skip", reason: "цель не своей команды и не команды выше: так задачу к цели не привязать" });
      continue;
    }
    const target: ParentTarget = goal.pending ? { key: goal.pending } : { id: goal.id! };
    if (known) {
      // Цель задачи поменяли в ресурсе после прошлой загрузки: не трогаем
      if ((row?.goalId ?? null) !== (asRecord(known.payload).goalId ?? null)) {
        out.push({ l, action: "skip", reason: "цель задачи поменяли в ресурсе после прошлой загрузки" });
        continue;
      }
      out.push({ l, action: "update", goal: target });
      continue;
    }
    if (row?.goalId && "id" in target && row.goalId !== target.id) {
      out.push({ l, action: "skip", reason: `у задачи ${number} в ресурсе уже другая цель` });
      continue;
    }
    if (row?.goalId && "id" in target && row.goalId === target.id) {
      out.push({ l, action: "add", goal: target, reason: "уже связана, запомнится только ключ" });
      continue;
    }
    out.push({ l, action: "add", goal: target });
  }
  return out;
}

async function buildPlan(ctx: Ctx, pkg: ContentPackage): Promise<Plan> {
  const goals = await planGoals(ctx, pkg);
  await planParents(ctx, goals);
  const tasks = await planTasks(ctx, pkg);
  const decisions = await planDecisions(ctx, pkg, tasks);
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

/** Кто узнает о новых открытых задачах: ответственный, соисполнители и согласующие из других департаментов */
async function notifiedPeople(ctx: Ctx, plan: Plan): Promise<number> {
  const ids = new Set<string>();
  for (const p of plan.tasks) {
    if (p.action !== "add" || CLOSED.includes(p.t.status)) continue;
    for (const id of [p.ownerId, ...(p.co ?? []).map((c) => c.id)]) {
      if (!id) continue;
      ids.add(id);
      const approver = await approverOf(ctx, id);
      if (approver) ids.add(approver);
    }
  }
  ids.delete(ctx.actor.personId);
  return ids.size;
}

async function summarize(ctx: Ctx, pkg: ContentPackage, plan: Plan): Promise<ImportPreview> {
  const lists: Record<"errors" | "duplicates" | "notes" | "warnings", ImportLine[]> = { errors: [], duplicates: [], notes: [], warnings: [] };
  const put = (what: string, p: Step) => {
    if (p.reason && p.reason !== UNCHANGED) {
      const list = p.level === "error" ? lists.errors : p.level === "duplicate" ? lists.duplicates : p.level === "warning" ? lists.warnings : lists.notes;
      list.push({ what, text: p.reason });
    }
    for (const text of p.notes ?? []) lists.notes.push({ what, text });
  };
  for (const p of plan.goals) {
    put(`Цель «${short(p.g.title)}»`, p);
    if (p.parentNote) lists.warnings.push({ what: `Цель «${short(p.g.title)}»`, text: p.parentNote });
  }
  for (const p of plan.tasks) put(p.number ? `Задача ${p.number}` : `Задача «${short(p.t.title)}»`, p);
  for (const p of plan.decisions) put(`Решение «${short(p.d.text)}»`, p);
  for (const p of plan.links) put(`Связь ${p.l.key}`, p);
  const unchanged = [...plan.goals, ...plan.tasks, ...plan.decisions, ...plan.links].filter((p) => p.reason === UNCHANGED).length;
  if (unchanged) lists.notes.unshift({ what: "Без изменений", text: `${unchanged} ${unchanged === 1 ? "запись уже загружена" : "записей уже загружено"} в том же виде` });
  return {
    title: pkg.title,
    tasks: counts(plan.tasks),
    decisions: counts(plan.decisions),
    goals: counts(plan.goals),
    links: counts(plan.links),
    missingPeople: [...ctx.missingPeople].sort((a, b) => a.localeCompare(b, "ru")),
    missingTeams: [...ctx.missingTeams].sort((a, b) => a.localeCompare(b, "ru")),
    errors: lists.errors.slice(0, 300),
    warnings: [...ctx.warnings, ...lists.warnings].slice(0, 300),
    duplicates: lists.duplicates.slice(0, 300),
    withDuplicates: !!ctx.opts.duplicates,
    notes: [...lists.notes, ...ctx.notes].slice(0, 300),
    notified: await notifiedPeople(ctx, plan),
  };
}

/** Предпросмотр: ничего не пишет */
export async function previewContentImport(actor: Actor, pkg: ContentPackage, opts: ImportOptions = {}): Promise<ImportPreview> {
  if (!canImportContent(actor)) fail(IMPORT_ONLY);
  const ctx = await context(prisma, actor, pkg, opts);
  return summarize(ctx, pkg, await buildPlan(ctx, pkg));
}

// ---------- Загрузка ----------

async function remember(tx: Tx, kind: Kind, k: string, entityId: string, record: unknown, payload: Record<string, unknown>) {
  const hash = recordHash(record);
  const data = { entityId, hash, payload: payload as Prisma.InputJsonValue, updatedAt: new Date() };
  await tx.contentImportKey.upsert({ where: { kind_key: { kind, key: k } }, update: data, create: { kind, key: k, ...data } });
}

/** День закрытия задачи из истории: срок, если он прошёл, иначе дата источника, иначе сегодня */
function historyClosedAt(t: PackageTask, today: IsoDate): Date {
  const day = t.due <= today ? t.due : t.source.date && t.source.date <= today ? t.source.date : today;
  return moscowDateTime(toCalendar(day), 12, 0);
}

/** Сколько номеров задач взять заранее: задачи пакета, которых ещё нет по ключу (лишние номера потом возвращаются) */
async function newTaskCount(pkg: ContentPackage): Promise<number> {
  const excluded = new Set(pkg.excluded.filter((e) => e.kind === "task").map((e) => e.key));
  const keys = pkg.tasks.map((t) => t.key).filter((k) => !excluded.has(k));
  if (!keys.length) return 0;
  const known = await prisma.contentImportKey.count({ where: { kind: "task", key: { in: keys } } });
  return Math.max(0, keys.length - known);
}

export type ImportResult = ImportPreview & { applied: { tasks: number[]; goals: number; decisions: number; links: number } };

export async function applyContentImport(actor: Actor, pkg: ContentPackage, opts: ImportOptions = {}): Promise<ImportResult> {
  if (!canImportContent(actor)) fail(IMPORT_ONLY);
  // Номера новых задач берём заранее короткой транзакцией: иначе загрузка держала бы строку настройки номеров всю
  // долгую транзакцию, и задачи, которые в это время ставят люди, падали бы по ожиданию. Неиспользованный хвост и
  // номера отменённой загрузки возвращаются, если после них никто номер не брал
  const reserved = await reserveTaskNumbers(await newTaskCount(pkg));
  const free = [...reserved];
  const end = reserved.length ? reserved[reserved.length - 1]! + 1 : 0;
  let result: ImportResult;
  try {
    result = await prisma.$transaction((tx) => applyIn(tx, actor, pkg, opts, free), { timeout: 300_000, maxWait: 15_000 });
  } catch (error) {
    if (reserved.length) await releaseTaskNumbers(reserved[0]!, end).catch(() => undefined);
    throw error;
  }
  if (free.length) await releaseTaskNumbers(free[0]!, end).catch(() => undefined);
  return result;
}

async function applyIn(tx: Tx, actor: Actor, pkg: ContentPackage, opts: ImportOptions, free: number[]): Promise<ImportResult> {
  // Две загрузки сразу идут по очереди: вторая видит ключи первой и ничего не дублирует
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('content.import'))`;
  const ctx = await context(tx, actor, pkg, opts);
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
      const created = (await where(`Цель «${short(g.title)}»`, () =>
        createGoal(actor, { quarter: g.quarter, title: g.title, description: g.description, metric: g.metric, base: g.base, target: g.target, team: p.teamId, owner: p.ownerSlug ?? null, link: g.link, code: g.code }, tx),
      )) as { id: string };
      goalIds.set(g.key, created.id);
      await remember(tx, "goal", g.key, created.id, g, p.kept!);
      goalsDone += 1;
    } else if (p.action === "match" || p.action === "update") {
      if (Object.keys(p.input ?? {}).length) await where(`Цель «${short(g.title)}»`, () => updateGoal(actor, p.existingId!, p.input!, tx));
      await remember(tx, "goal", g.key, p.existingId!, g, p.kept!);
      goalsDone += 1;
    }
  }
  for (const p of plan.goals) {
    if (!p.parent) continue;
    const id = goalIds.get(p.g.key);
    const parentId = "id" in p.parent ? p.parent.id : goalIds.get(p.parent.key);
    if (id && parentId) await where(`Цель «${short(p.g.title)}»`, () => updateGoal(actor, id, { parent: parentId }, tx));
  }

  // Задачи: служба задач ставит их от имени того, кто загружает
  const taskNumbers = new Map<string, number>();
  const created: number[] = [];
  for (const p of plan.tasks) {
    const t = p.t;
    if (p.number) taskNumbers.set(t.key, p.number);
    if (p.action === "add") {
      const closed = CLOSED.includes(t.status);
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
            due: p.due!,
            source: t.source.kind,
            sourceNote: t.source.note ?? undefined,
            links: t.links.map((l) => ({ title: l.title ?? undefined, url: l.url })),
            team: p.teamId,
          },
          { history: { sourceDate: t.source.date, closed }, number: free.shift() },
        ),
      )) as { task: { number: number } };
      const number = res.task.number;
      taskNumbers.set(t.key, number);
      created.push(number);
      const row = await tx.task.findUniqueOrThrow({ where: { number }, select: { id: true } });
      if (t.whereNow) await where(`Задача ${number}`, () => updateWhere(actor, number, t.whereNow!, tx));
      if (t.status !== "in-progress") await where(`Задача ${number}`, () => changeStatus(actor, number, t.status, t.resolution ?? undefined, tx));
      if (closed) {
        // Задача из истории уже закрыта: события «Новая задача для вас» и о согласовании о ней только мешают, а дата
        // закрытия историческая, чтобы «закрыто на этой неделе» в аналитике не выросло от загрузки
        await tx.inboxEvent.deleteMany({ where: { OR: [{ taskId: row.id }, { subject: { startsWith: `approval-co:${row.id}:` } }] } });
        await tx.task.update({ where: { id: row.id }, data: { closedAt: historyClosedAt(t, ctx.today) } });
      }
      await remember(tx, "task", t.key, row.id, t, taskPayload(t, p.due!));
    } else if (p.action === "update") {
      const number = p.number!;
      const u = p.update ?? {};
      if (u.edit) await where(`Задача ${number}`, () => editTask(actor, number, u.edit!, tx));
      if (u.whereNow) await where(`Задача ${number}`, () => updateWhere(actor, number, u.whereNow!, tx));
      if (u.due) await where(`Задача ${number}`, () => transferDue(actor, number, u.due!, IMPORT_TRANSFER_REASON, tx));
      if (u.status) await where(`Задача ${number}`, () => changeStatus(actor, number, u.status!.code, u.status!.resolution ?? undefined, tx));
      const row = await tx.task.findUniqueOrThrow({ where: { number }, select: { id: true } });
      await remember(tx, "task", t.key, row.id, t, p.kept!);
    }
  }

  // Решения: к команде и дате; без встречи, если её в ресурсе не было. Владельцам о старых решениях не сообщаем
  let decisionsDone = 0;
  const createdKeys = new Set(plan.tasks.filter((p) => p.action === "add").map((p) => p.t.key));
  const taskIdsOf = async (refs: DecisionPlan["tasks"], only?: Set<string>) => {
    const ids: string[] = [];
    for (const ref of refs ?? []) {
      if (only && !("key" in ref && only.has(ref.key))) continue;
      const number = "number" in ref ? ref.number : taskNumbers.get(ref.key);
      const row = number ? await tx.task.findUnique({ where: { number }, select: { id: true } }) : null;
      if (row) ids.push(row.id);
    }
    return [...new Set(ids)];
  };
  for (const p of plan.decisions) {
    const d = p.d;
    if (p.action === "skip") {
      // Решение уже загружено, а его задачу загрузка поставила заново (например, после перезаливки): связь возвращается
      if (p.existingId) {
        const ids = await taskIdsOf(p.tasks, createdKeys);
        if (ids.length) await tx.decisionTask.createMany({ data: ids.map((taskId) => ({ decisionId: p.existingId!, taskId })), skipDuplicates: true });
      }
      continue;
    }
    const taskIds = await taskIdsOf(p.tasks);
    if (p.action === "add") {
      const row = await tx.decision.create({
        data: {
          teamId: p.teamId!,
          text: d.text,
          ownerId: p.ownerId ?? null,
          date: dbDate(d.date),
          createdById: actor.personId,
          ...(d.status === "cancelled" ? { status: "CANCELLED" as const, cancelReason: d.cancelReason, cancelledAt: new Date(), cancelledById: actor.personId } : {}),
          tasks: { create: taskIds.map((taskId) => ({ taskId })) },
        },
      });
      await tx.auditLog.create({
        data: { action: "meeting.decision", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "decision", entityId: row.id, field: "Решение из наполнения", after: `${formatLong(d.date)}: ${d.text}`, ip: actor.ip ?? null, via: actor.via ?? null },
      });
      await remember(tx, "decision", d.key, row.id, d, { text: d.text, ownerId: p.ownerId ?? null, status: d.status });
    } else {
      const cur = await tx.decision.findUniqueOrThrow({ where: { id: p.existingId! }, select: { id: true, text: true } });
      if (Object.keys(p.data ?? {}).length) {
        await tx.decision.update({ where: { id: cur.id }, data: p.data! });
        await tx.auditLog.create({
          data: { action: "meeting.decision", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "decision", entityId: cur.id, field: "Решение обновлено из наполнения", before: cur.text, after: p.data!.text === undefined ? cur.text : d.text, ip: actor.ip ?? null, via: actor.via ?? null },
        });
      }
      // Новые связи с задачами добавляем, прежние не убираем
      if (taskIds.length) await tx.decisionTask.createMany({ data: taskIds.map((taskId) => ({ decisionId: cur.id, taskId })), skipDuplicates: true });
      await remember(tx, "decision", d.key, cur.id, d, p.kept!);
    }
    decisionsDone += 1;
  }

  // Связи задач с целями: через то же правило, что в карточке задачи
  let linksDone = 0;
  for (const p of plan.links) {
    if (p.action === "skip") continue;
    const l = p.l;
    const number = "number" in l.task ? l.task.number : taskNumbers.get(l.task.key);
    const goalId = !p.goal ? null : "id" in p.goal ? p.goal.id : (goalIds.get(p.goal.key) ?? null);
    if (!number || !goalId) {
      ctx.notes.push({ what: `Связь ${l.key}`, text: "задача или цель не нашлась после загрузки, связь пропущена" });
      continue;
    }
    const task = await tx.task.findUniqueOrThrow({ where: { number }, select: { id: true, goalId: true } });
    if (task.goalId !== goalId) await where(`Связь задачи ${number} с целью`, () => linkTaskGoal(actor, number, goalId, tx));
    await remember(tx, "link", l.key, task.id, l, { goalId });
    linksDone += 1;
  }

  const result: ImportResult = { ...(await summarize(ctx, pkg, plan)), applied: { tasks: created, goals: goalsDone, decisions: decisionsDone, links: linksDone } };
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
}
