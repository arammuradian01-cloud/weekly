// Данные для автосборки weekly по смысловым блокам (этап 66): цифры недели, прогноз месяца из LRF, хаб ОСАГО по СК,
// новости за неделю, записи weekly, задачи, цели и черновик разбора встречи. Сама сборка чистая
// (src/lib/weekly-blocks/assemble.ts): здесь только чтение из базы. Боевые таблицы не читаются: цифры приходят из уже
// загруженных снимков (недельный отчёт, LRF, хаб).
//
// Охват: для отчёта CEO команда страхования и инвестиций (топ-команда, как раньше: её weekly, отмеченные «В отчёт CEO»
// записи любой команды, задачи команды и её людей); для отчёта команды её руководитель и участники.

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { WeekKey } from "@/domain/types";
import { addDays } from "@/domain/dates";
import type { Actor } from "@/lib/tasks/service";
import { dbDate, isoFromDbDate } from "@/lib/tasks/dates";
import { shiftWeek, weekNumberOf } from "@/lib/weekly/weeks";
import { currentReportingKey } from "@/lib/weekly/service";
import { weekNumbers } from "@/lib/numbers/service";
import { numbersLevel, type NumbersLevel } from "@/lib/plan/access";
import { monthPlan } from "@/lib/plan/service";
import { briefOf, planAsOfWeek, planMonthOfWeek } from "@/lib/plan/brief";
import { summarize, type PlanSummary } from "@/lib/plan/summary";
import { PRODUCTS, groupOf, type ProductSpec } from "@/lib/plan/spec";
import { derive, rollUp } from "@/lib/plan/model";
import { skView } from "@/lib/plan/hub-service";
import type { MonthPlanView } from "@/lib/plan/types";
import { addMonths, monthLabel } from "@/lib/forecast/codes";
import { quarterOf } from "@/lib/goals/parse";
import { getSetting } from "@/lib/settings";
import { TOP_TEAM } from "@/lib/org/scope";
import { assembleBlocks, type AssembleInput, type EntryInput, type GoalInput, type MonthInput, type MonthProduct, type NewsInput, type SalesWeek, type TaskInput, type WowInput } from "./assemble";
import { COMPETITORS_KEY, competitorsOf } from "./competitors";
import { STANDARD_TEMPLATE, draftBlocksOf, type Labels, type ProductRef, type ReportBlock, type TemplateBlock } from "./types";

export type BlocksMeta = { labels: Labels; order: string[]; products: ProductRef[] };

/** Продукты для блоков: направления из справочника. Подписи у всех (старые строки), в выборе только видимые */
export async function blocksMeta(): Promise<BlocksMeta> {
  const rows = await prisma.dictionaryItem.findMany({ where: { kind: "DIRECTION" }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }], select: { code: true, label: true, active: true } });
  return {
    labels: Object.fromEntries(rows.map((r) => [r.code, r.label])),
    order: rows.map((r) => r.code),
    products: rows.filter((r) => r.active).map((r) => ({ code: r.code, label: r.label })),
  };
}

export async function loadCompetitors() {
  return competitorsOf(await getSetting<unknown>(COMPETITORS_KEY, null));
}

/** Начало недели по Москве и начало следующей */
const weekWindow = (key: WeekKey) => {
  const start = new Date(`${key}T00:00:00+03:00`);
  return { start, end: new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000) };
};

const RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/** Формы слова продаж продукта по названию продаж в LRF */
function formsOf(spec: Pick<ProductSpec, "nouns">): [string, string, string] {
  const noun = spec.nouns.units.toLowerCase();
  if (noun.startsWith("лид")) return ["лид", "лида", "лидов"];
  if (noun.startsWith("клик")) return ["клик", "клика", "кликов"];
  return ["полис", "полиса", "полисов"];
}

/** Направление продукта LRF: продукты RED идут в RED */
const directionOf = (spec: ProductSpec) => spec.group ?? spec.code;

type MonthNumbers = { units: number | null; revenue: number | null };

/** Продажи и выручка продуктов верхнего уровня (RED целиком) по прогнозу месяца */
function topNumbers(view: MonthPlanView, summary: PlanSummary): Map<string, MonthNumbers & { units0: number | null; revenue0: number | null; label: string; forms: [string, string, string] }> {
  const out = new Map<string, MonthNumbers & { units0: number | null; revenue0: number | null; label: string; forms: [string, string, string] }>();
  const byCode = new Map(view.products.map((p) => [p.code, p]));
  for (const t of summary.top) {
    if (t.kind === "product") {
      const s = summary.products.find((p) => p.code === t.code)!;
      out.set(t.code, { label: t.label, forms: formsOf(s.spec), units: s.units.forecast, units0: s.units.budget, revenue: t.revenue.forecast, revenue0: t.revenue.budget });
    } else {
      const group = view.groups.find((g) => g.code === t.code);
      const parts = summary.products.filter((p) => t.parts.includes(p.code));
      const units = group ? (rollUp(group.lbe, parts.map((p) => ({ lbe: byCode.get(p.code)!.lbe, current: p.current }))).units ?? null) : null;
      out.set(t.code, {
        label: groupOf(t.code)?.label ?? t.label,
        forms: ["полис", "полиса", "полисов"],
        units,
        units0: group ? (derive(group.budget).units ?? null) : null,
        revenue: t.revenue.forecast,
        revenue0: t.revenue.budget,
      });
    }
  }
  return out;
}

async function closedMonth(actor: Actor, month: string, level: NumbersLevel): Promise<{ view: MonthPlanView; summary: PlanSummary } | null> {
  try {
    const view = await monthPlan(actor, month, new Date(), null, { sk: false, level });
    if (view.empty || view.month !== month) return null;
    return { view, summary: summarize({ products: view.products.map((p) => ({ code: p.code, lbe: p.lbe, budget: p.budget, drivers: p.drivers })), groups: view.groups }) };
  } catch {
    return null;
  }
}

/**
 * Месяц недели из LRF: план продаж по продуктам и итог, прошлый месяц и прошлый год (если они есть в LRF), ОСАГО по СК
 * из хаба (только у кого все цифры и только для текущего среза)
 */
async function monthInput(actor: Actor, key: WeekKey, level: NumbersLevel, now: Date): Promise<MonthInput | null> {
  const month = planMonthOfWeek(key);
  const reporting = await currentReportingKey(now);
  const asOf = planAsOfWeek(key, reporting, weekNumberOf(key));
  let view: MonthPlanView;
  try {
    view = await monthPlan(actor, month, now, asOf, { sk: false, level });
  } catch {
    return null;
  }
  if (view.empty || view.month !== month) return null;
  const summary = summarize({ products: view.products.map((p) => ({ code: p.code, lbe: p.lbe, budget: p.budget, drivers: p.drivers })), groups: view.groups });
  const prevMonth = addMonths(month, -1);
  const prevYear = addMonths(month, -12);
  const [pm, py] = await Promise.all([closedMonth(actor, prevMonth, level), closedMonth(actor, prevYear, level)]);
  const current = topNumbers(view, summary);
  const pmNums = pm ? topNumbers(pm.view, pm.summary) : null;
  const pyNums = py ? topNumbers(py.view, py.summary) : null;
  const products: MonthProduct[] = [];
  for (const [code, n] of current) {
    const spec = PRODUCTS.find((p) => p.code === code);
    const direction = spec ? directionOf(spec) : code;
    const pick = (m: typeof pmNums) => {
      const x = m?.get(code);
      return x ? { units: x.units, revenue: x.revenue } : null;
    };
    products.push({ product: direction, label: n.label, forms: n.forms, units: { forecast: n.units, budget: n.units0 }, revenue: { forecast: n.revenue, budget: n.revenue0 }, prevMonth: pick(pmNums), prevYear: pick(pyNums) });
  }
  const brief = briefOf(view);
  const href = `/forecast?month=${month}`;
  let hub: MonthInput["hub"] = null;
  if (level === "full" && !asOf) {
    try {
      const [sk, prevSk] = await Promise.all([skView(actor, month, now, { level }), skView(actor, prevMonth, now, { level })]);
      if (sk && (sk.total.mtd !== null || sk.total.plan !== null)) hub = { mtd: sk.total.mtd, plan: sk.total.plan, forecast: sk.total.forecast, day: sk.day, prevTotal: prevSk?.total.mtd ?? null, href };
    } catch {
      hub = null;
    }
  }
  return {
    month,
    monthLabel: monthLabel(month),
    href,
    asOf: asOf?.when ?? null,
    products,
    total: { revenue: { forecast: summary.total.revenue.forecast, budget: summary.total.revenue.budget }, prevMonth: pm?.summary.total.revenue.forecast ?? null, prevYear: py?.summary.total.revenue.forecast ?? null },
    prevMonthLabel: monthLabel(prevMonth),
    prevYearLabel: monthLabel(prevYear),
    hasPrevMonth: !!pm,
    hasPrevYear: !!py,
    hub,
    partners: brief.partners ? { revenue: { forecast: brief.partners.revenue.forecast, budget: brief.partners.revenue.budget }, href: `/forecast?tab=partners&month=${month}` } : null,
  };
}

/** Продажи по дням из отчёта аналитиков: неделя и прошлая неделя, только если обе недели загружены целиком */
async function salesWeeks(key: WeekKey): Promise<SalesWeek[]> {
  const prev = shiftWeek(key, -1);
  const rows = await prisma.planFact.findMany({ where: { metric: "units", day: { gte: dbDate(prev), lte: dbDate(addDays(key, 6)) } }, select: { product: true, day: true, value: true } });
  const acc = new Map<string, { label: string; forms: [string, string, string]; cur: Set<string>; old: Set<string>; value: number; prev: number }>();
  for (const r of rows) {
    const spec = PRODUCTS.find((p) => p.code === r.product);
    if (!spec) continue;
    const dir = directionOf(spec);
    const a = acc.get(dir) ?? { label: spec.group ? (groupOf(spec.group)?.label ?? dir) : spec.label, forms: formsOf(spec), cur: new Set(), old: new Set(), value: 0, prev: 0 };
    const day = isoFromDbDate(r.day);
    if (day >= key) {
      a.cur.add(`${r.product}:${day}`);
      a.value += r.value;
    } else {
      a.old.add(`${r.product}:${day}`);
      a.prev += r.value;
    }
    acc.set(dir, a);
  }
  const out: SalesWeek[] = [];
  for (const [dir, a] of acc) {
    const days = (s: Set<string>) => new Set([...s].map((x) => x.split(":")[1])).size;
    if (days(a.cur) < 7 || days(a.old) < 7) continue;
    out.push({ product: dir, label: a.label, forms: a.forms, value: a.value, prev: a.prev, href: `/forecast?month=${planMonthOfWeek(key)}` });
  }
  return out;
}

async function wowInput(key: WeekKey): Promise<WowInput> {
  const [n, sales] = await Promise.all([weekNumbers(key), salesWeeks(key)]);
  return {
    connected: n.connected,
    ready: n.ready,
    week: n.week,
    latestWeek: n.latestWeek,
    figures: n.figures.map((f) => ({ label: f.label, unit: f.unit, value: f.value, prev: f.prev })),
    href: `/forecast?tab=week&week=${key}`,
    sales,
  };
}

async function weekNews(key: WeekKey): Promise<NewsInput[]> {
  const { start, end } = weekWindow(key);
  const rows = await prisma.newsItem.findMany({
    where: { publishedAt: { gte: start, lt: end }, NOT: { directions: { isEmpty: true } } },
    select: { title: true, url: true, summary: true, directions: true, source: { select: { name: true } } },
    orderBy: { publishedAt: "desc" },
    take: 300,
  });
  return rows.map((r) => ({ title: r.title, url: r.url, summary: r.summary, directions: r.directions, source: r.source.name }));
}

const entrySelect = {
  section: true,
  what: true,
  fact: true,
  impact: true,
  next: true,
  links: true,
  ceo: true,
  direction: { select: { code: true } },
  block: { select: { code: true } },
  type: { select: { code: true } },
} satisfies Prisma.WeeklyEntrySelect;

function toEntryInput(e: Prisma.WeeklyEntryGetPayload<{ select: typeof entrySelect }>): EntryInput {
  const links = Array.isArray(e.links) ? (e.links as { url?: unknown; title?: unknown }[]) : [];
  const first = links.find((l) => typeof l?.url === "string");
  return {
    direction: e.direction.code,
    block: e.block.code,
    type: e.type.code,
    section: e.section,
    what: e.what,
    fact: e.fact,
    impact: e.impact,
    next: e.next,
    link: first ? { url: String(first.url), title: typeof first.title === "string" ? first.title : "" } : null,
  };
}

type Scope = { teamId: string; people: string[]; ceo: boolean };

async function scopeEntries(key: WeekKey, scope: Scope): Promise<{ entries: EntryInput[]; hint: string | null }> {
  const week = await prisma.week.findUnique({ where: { start: dbDate(key) }, select: { id: true } });
  if (!week) return { entries: [], hint: null };
  const rows = await prisma.weeklyEntry.findMany({
    where: { weekId: week.id, OR: [{ authorId: { in: scope.people } }, ...(scope.ceo ? [{ authorId: null }, { ceo: true }] : [])] },
    select: entrySelect,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (!scope.ceo) return { entries: rows.map(toEntryInput), hint: null };
  // Отчёт CEO: записи с отметкой «В отчёт CEO», как раньше. Отметок за неделю нет: все записи weekly команды
  const flagged = rows.filter((r) => r.ceo);
  if (flagged.length) return { entries: flagged.map(toEntryInput), hint: null };
  return { entries: rows.map(toEntryInput), hint: rows.length ? "Отметок «В отчёт CEO» за неделю нет: в блоки взяты все записи weekly команды" : null };
}

const taskSelect = {
  number: true,
  title: true,
  due: true,
  state: true,
  riskNote: true,
  blockedBy: true,
  priority: true,
  direction: { select: { code: true } },
} satisfies Prisma.TaskSelect;

function toTask(t: Prisma.TaskGetPayload<{ select: typeof taskSelect }>): TaskInput {
  return {
    number: t.number,
    title: t.title,
    direction: t.direction.code,
    due: isoFromDbDate(t.due),
    blocked: t.state === "BLOCKED",
    note: (t.state === "BLOCKED" ? t.blockedBy : t.riskNote) ?? null,
    rank: t.priority ? (RANK[t.priority] ?? 2) : 2,
  };
}

async function scopeTasks(key: WeekKey, scope: Scope) {
  const { start, end } = weekWindow(key);
  const nextKey = shiftWeek(key, 1);
  const base: Prisma.TaskWhereInput = { archivedAt: null, OR: [{ teamId: scope.teamId }, { ownerId: { in: scope.people } }] };
  const [done, atRisk, next] = await Promise.all([
    prisma.task.findMany({ where: { ...base, status: { in: ["DONE", "PARTIAL"] }, closedAt: { gte: start, lt: end } }, select: taskSelect, take: 200, orderBy: { number: "asc" } }),
    prisma.task.findMany({ where: { ...base, status: { in: ["IN_PROGRESS", "CLARIFY"] }, state: { in: ["AT_RISK", "BLOCKED"] } }, select: taskSelect, take: 200, orderBy: { number: "asc" } }),
    prisma.task.findMany({ where: { ...base, status: { in: ["IN_PROGRESS", "CLARIFY"] }, due: { gte: dbDate(nextKey), lte: dbDate(addDays(nextKey, 6)) } }, select: taskSelect, take: 200, orderBy: { due: "asc" } }),
  ]);
  return { done: done.map(toTask), atRisk: atRisk.map(toTask), next: next.map(toTask) };
}

async function scopeGoals(key: WeekKey, scope: Scope): Promise<GoalInput[]> {
  const rows = await prisma.goal.findMany({
    where: { quarter: quarterOf(addDays(key, 3)), atRisk: true, result: "IN_PROGRESS", OR: [{ teamId: scope.teamId }, { ownerId: { in: scope.people } }] },
    select: { code: true, title: true, riskNote: true, owner: { select: { defaultDirection: { select: { code: true } } } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: 10,
  });
  return rows.map((g) => ({ code: g.code, title: g.title, note: g.riskNote, product: g.owner?.defaultDirection?.code ?? null }));
}

/** Черновик weekly из последнего готового разбора встречи команды за эту неделю (этап 61) */
async function notionDraft(key: WeekKey, teamId: string, products: ProductRef[]): Promise<ReportBlock[] | null> {
  const row = await prisma.meetingParse.findFirst({
    where: { status: "READY", meeting: { teamId, week: { start: dbDate(key) } } },
    orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
    select: { result: true },
  });
  if (!row?.result || typeof row.result !== "object") return null;
  const blocks = draftBlocksOf((row.result as { ceo?: unknown }).ceo, products);
  return blocks.length ? blocks : null;
}

export type Assembly = { blocks: ReportBlock[]; hint: string | null };

async function assemble(actor: Actor, key: WeekKey, scope: Scope, template: readonly TemplateBlock[], focus: string[] | null, now: Date): Promise<Assembly> {
  const keys = new Set(template.map((t) => t.key));
  const needs = (k: string) => keys.has(k);
  const [meta, level] = await Promise.all([blocksMeta(), numbersLevel({ personId: actor.personId, role: actor.role, management: actor.management })]);
  const numbersOn = level !== "none";
  const [wow, month, news, competitors, entries, tasks, goals, notion] = await Promise.all([
    needs("wow") ? (numbersOn ? wowInput(key) : Promise.resolve({ closed: true } as WowInput)) : Promise.resolve(null),
    needs("month") || needs("partners") ? (numbersOn ? monthInput(actor, key, level, now) : Promise.resolve("closed" as const)) : Promise.resolve(null),
    needs("news") || needs("competitors") ? weekNews(key) : Promise.resolve([]),
    loadCompetitors(),
    scopeEntries(key, scope),
    scopeTasks(key, scope),
    needs("risks") ? scopeGoals(key, scope) : Promise.resolve([]),
    notionDraft(key, scope.teamId, meta.products),
  ]);
  const input: AssembleInput = {
    template,
    products: meta.products,
    wow,
    month,
    news,
    competitors,
    entries: entries.entries,
    done: tasks.done,
    atRisk: tasks.atRisk,
    next: tasks.next,
    goals,
    notion,
    focus,
  };
  return { blocks: assembleBlocks(input), hint: entries.hint };
}

/** Черновик weekly для CEO по стандартным блокам: команда страхования и инвестиций за неделю */
export async function assembleCeoBlocks(actor: Actor, key: WeekKey, now = new Date()): Promise<Assembly> {
  return assemble(actor, key, { teamId: TOP_TEAM, people: await topPeople(), ceo: true }, STANDARD_TEMPLATE, null, now);
}

/** Люди команды страхования и инвестиций: руководитель и участники топ-команды, как у отчёта CEO раньше */
export async function topPeople(): Promise<string[]> {
  const top = await prisma.team.findUnique({ where: { id: TOP_TEAM }, select: { leaderId: true, members: { select: { personId: true } } } });
  return top ? [...new Set([...(top.leaderId ? [top.leaderId] : []), ...top.members.map((m) => m.personId)])] : [];
}

/**
 * Продукты команды для цифр и новостей: направления её людей. Есть кто-то из департамента целиком, страхования в целом
 * или без направления: команда смотрит на все продукты (null)
 */
export async function teamFocus(people: string[]): Promise<string[] | null> {
  if (!people.length) return null;
  const rows = await prisma.person.findMany({ where: { id: { in: people }, active: true }, select: { defaultDirection: { select: { code: true } } } });
  const codes = rows.map((r) => r.defaultDirection?.code ?? null);
  if (!codes.length || codes.some((c) => !c || c === "department" || c === "insurance")) return null;
  return [...new Set(codes as string[])];
}

/** Черновик weekly команды по её шаблону: записи её людей, задачи и цели команды, цифры по продуктам команды */
export async function assembleTeamBlocks(actor: Actor, teamId: string, people: string[], template: readonly TemplateBlock[], key: WeekKey, now = new Date()): Promise<Assembly> {
  return assemble(actor, key, { teamId, people, ceo: false }, template, await teamFocus(people), now);
}
