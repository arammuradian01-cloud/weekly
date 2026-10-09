// Прогноз месяца в процессах (этап 35):
// - «Прогноз проверен»: команда продукта отмечает, что после загрузки LBE корректировки не нужны;
// - факт месяца по дням из отчёта аналитиков: проверка вставки и запись;
// - сравнение двух любых версий месяца: бюджет, LBE, прогноз сейчас, LBE прежних загрузок, прогноз на конец любого дня;
// - сводка для отчёта CEO и встречи: итог, отклонения, причины корректировок и кто ещё не проверил прогноз

import { prisma } from "@/lib/db";
import { canEditDictionaries } from "@/lib/admin/service";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { moscowToday } from "@/lib/tasks/dates";
import { monthLabel } from "@/lib/forecast/codes";
import { derive } from "./model";
import { formatPlan } from "./format";
import { PRODUCTS, UNITS, metricLabel, productOf, type MetricKey } from "./spec";
import { planLabel, summarize, type Drivers, type PlanInput, type PlanSummary, type Triple } from "./summary";
import { parseFacts, type FactMetric } from "./facts";
import { canAdjustPlan, currentMonth, isMonth, monthPlan, ownersMap, personalPlanActor, planMonthOrFail } from "./service";
import { lastPullAt } from "./status";
import { TOP_TEAM } from "@/lib/org/scope";
import type { Values } from "./lrf";
import type { CompareMetric, CompareRow, CompareView, MonthPlanView, VersionOption } from "./types";
import { briefOf, type PlanBrief } from "./brief";

export { planMonthOfWeek, planBriefText, type PlanBrief } from "./brief";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

const MSK = 3 * 60 * 60 * 1000;
/** «07.10, 14:20» по Москве */
const stamp = (d: Date) => {
  const m = new Date(d.getTime() + MSK).toISOString();
  return `${m.slice(8, 10)}.${m.slice(5, 7)}, ${m.slice(11, 16)}`;
};
/** Календарный день момента по Москве: 2026-10-07 */
const mskDay = (d: Date) => new Date(d.getTime() + MSK).toISOString().slice(0, 10);
/** Конец дня по Москве: начало следующего */
const endOfMskDay = (day: string) => new Date(new Date(`${day}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000 - MSK);
const ddmm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;

// ---------- «Прогноз проверен» ----------

/** Команда продукта отмечает, что после загрузки LBE прогноз проверен и корректировки не нужны */
export async function checkPlan(actor: Actor, monthInput: string, productCode: string): Promise<MonthPlanView> {
  const month = planMonthOrFail(monthInput);
  const spec = productOf(String(productCode ?? "")) ?? fail("Нет такого продукта");
  if (!personalPlanActor(actor)) fail(actor.role === "OBSERVER" ? "Наблюдатель прогноз не проверяет" : "Прогноз отмечают проверенным при личном входе: так видно, кто проверил");
  if (month < currentMonth()) fail(`${monthLabel(month)} закрыт: прогноз прошлого месяца не меняется`);
  const owners = (await ownersMap())[spec.code] ?? [];
  if (!canAdjustPlan(actor, owners)) fail(`Прогноз продукта «${spec.label}» проверяет его команда`);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`plan:${month}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`plan:${month}:${spec.code}`}))`;
    if (!(await tx.planLine.count({ where: { month, product: spec.code, version: "LBE" } }))) fail(`Версии ${monthLabel(month)} ещё не загружены из LRF`);
    const since = await lastPullAt(month);
    if (!since) fail("Неизвестно, когда загружен LBE: загрузите месяц из LRF заново");
    const adj = await tx.planAdjustment.findFirst({ where: { month, product: spec.code, createdAt: { gt: since! } }, include: { author: { select: { fullName: true } } }, orderBy: { createdAt: "desc" } });
    if (adj) fail(`После загрузки LBE прогноз уже скорректирован: ${adj.author.fullName}, ${stamp(adj.createdAt)}`);
    const check = await tx.planCheck.findFirst({ where: { month, product: spec.code, at: { gt: since! } }, include: { author: { select: { fullName: true } } }, orderBy: { at: "desc" } });
    if (check) fail(`Прогноз уже отмечен проверенным: ${check.author.fullName}, ${stamp(check.at)}`);
    await tx.planCheck.create({ data: { month, product: spec.code, authorId: actor.personId } });
    // Человек взялся за прогноз: его событие «Проверьте прогноз» разобрано
    await tx.inboxEvent.updateMany({ where: { recipientId: actor.personId, subject: `plan:${month}`, doneAt: null }, data: { doneAt: new Date() } });
    await tx.auditLog.create({
      data: {
        action: "plan.check",
        actorId: actor.personId,
        actorName: actor.fullName,
        source: "APP",
        entity: "plan",
        entityId: `${month}:${spec.code}`,
        field: `${spec.label}, ${monthLabel(month)}`,
        before: "ждёт проверки после загрузки LBE",
        after: "прогноз проверен, корректировки не нужны",
        ip: actor.ip ?? null,
        via: actor.via ?? null,
      },
    });
  });
  return monthPlan(actor, month);
}

// ---------- Факт по дням ----------

export type FactsPreview = {
  ready: boolean;
  problems: string[];
  rows: number;
  values: number;
  /** Сколько значений заменят уже загруженные */
  replaced: number;
  products: { code: string; label: string; days: number; from: string; to: string; totals: Partial<Record<FactMetric, number>> }[];
};

function requireFacts(actor: Actor) {
  if (!canEditDictionaries(actor)) fail("Факт по дням загружают владелец и администраторы в режиме управления");
}

async function readFacts(text: string) {
  const parsed = parseFacts(text, moscowToday());
  const keys = parsed.entries.map((e) => `${e.product}:${e.metric}:${e.day}`);
  let existing = 0;
  if (parsed.entries.length) {
    const days = parsed.entries.map((e) => e.day).sort();
    const rows = await prisma.planFact.findMany({
      where: { product: { in: [...new Set(parsed.entries.map((e) => e.product))] }, day: { gte: new Date(`${days[0]}T00:00:00Z`), lte: new Date(`${days[days.length - 1]}T00:00:00Z`) } },
      select: { product: true, metric: true, day: true },
    });
    const have = new Set(rows.map((r) => `${r.product}:${r.metric}:${r.day.toISOString().slice(0, 10)}`));
    existing = keys.filter((k) => have.has(k)).length;
  }
  return { parsed, existing };
}

/** Что загрузится: продукты, дни и итоги, ошибки по строкам. Ничего не пишет */
export async function previewFacts(actor: Actor, text: string): Promise<FactsPreview> {
  requireFacts(actor);
  const { parsed, existing } = await readFacts(text);
  const products = PRODUCTS.filter((p) => parsed.entries.some((e) => e.product === p.code)).map((p) => {
    const mine = parsed.entries.filter((e) => e.product === p.code);
    const days = [...new Set(mine.map((e) => e.day))].sort();
    const totals: Partial<Record<FactMetric, number>> = {};
    for (const e of mine) totals[e.metric] = (totals[e.metric] ?? 0) + e.value;
    return { code: p.code, label: p.label, days: days.length, from: days[0]!, to: days[days.length - 1]!, totals };
  });
  return { ready: parsed.problems.length === 0 && parsed.entries.length > 0, problems: parsed.problems, rows: parsed.rows, values: parsed.entries.length, replaced: existing, products };
}

/** Записать факт: тот же день продукта и показатель заменяется. С ошибками в строках не пишет ничего */
export async function applyFacts(actor: Actor, text: string): Promise<{ saved: number; replaced: number }> {
  requireFacts(actor);
  const { parsed, existing } = await readFacts(text);
  if (parsed.problems.length) fail(`Не загружено: ${parsed.problems[0]}`);
  if (!parsed.entries.length) fail("В строках нет значений");
  const now = new Date();
  const days = parsed.entries.map((e) => e.day).sort();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('plan.facts'))`;
    for (let i = 0; i < parsed.entries.length; i += 500) {
      const chunk = parsed.entries.slice(i, i + 500);
      await tx.planFact.deleteMany({ where: { OR: chunk.map((e) => ({ product: e.product, metric: e.metric, day: new Date(`${e.day}T00:00:00Z`) })) } });
      await tx.planFact.createMany({ data: chunk.map((e) => ({ month: e.day.slice(0, 7), product: e.product, metric: e.metric, day: new Date(`${e.day}T00:00:00Z`), value: e.value, loadedAt: now, loadedBy: actor.fullName })) });
    }
    await tx.auditLog.create({
      data: {
        action: "plan.facts",
        actorId: actor.personId,
        actorName: actor.fullName,
        source: "APP",
        entity: "plan",
        entityId: days[0]!.slice(0, 7),
        field: `Факт по дням: ${[...new Set(parsed.entries.map((e) => planLabel(e.product)))].join(", ")}`,
        before: existing ? `заменено значений: ${existing}` : "новые дни",
        after: `значений ${parsed.entries.length}, с ${days[0]!.split("-").reverse().join(".")} по ${days[days.length - 1]!.split("-").reverse().join(".")}`,
        ip: actor.ip ?? null,
        via: actor.via ?? null,
      },
    });
    // До 5 000 строк по три показателя: дольше обычных пяти секунд транзакции
  }, { timeout: 30_000 });
  return { saved: parsed.entries.length, replaced: existing };
}

// ---------- Версии месяца и сравнение ----------

type LineLike = { version: string; product: string; metric: string; value: number | null };
type AdjLike = { product: string; metric: string; value: number | null; createdAt: Date };

function inputFrom(lines: LineLike[], adjustments: AdjLike[], until: Date | null): PlanInput {
  const by = (version: string) => {
    const out = new Map<string, Values>();
    for (const l of lines) {
      if (l.version !== version) continue;
      const v = out.get(l.product) ?? {};
      v[l.metric as MetricKey] = l.value;
      out.set(l.product, v);
    }
    return out;
  };
  const lbe = by("LBE");
  const budget = by("BUDGET");
  // Действующая корректировка: последняя по показателю до момента until (null: все)
  const drivers = new Map<string, Drivers>();
  const seen = new Set<string>();
  const sorted = [...adjustments].filter((a) => !until || a.createdAt < until).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const a of sorted) {
    const key = `${a.product}:${a.metric}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (a.value !== null) drivers.set(a.product, { ...(drivers.get(a.product) ?? {}), [a.metric]: a.value });
  }
  return {
    products: PRODUCTS.filter((p) => lbe.has(p.code)).map((p) => ({ code: p.code, lbe: lbe.get(p.code)!, budget: budget.get(p.code) ?? {}, drivers: drivers.get(p.code) ?? {} })),
    groups: [...lbe.entries()].filter(([code]) => !productOf(code)).map(([code, v]) => ({ code, lbe: v, budget: budget.get(code) ?? {} })),
  };
}

type Pick3 = "budget" | "lbe" | "forecast";

/** Строки сравнения из сводки: продукты, группы с продуктами внутри и итог */
function rowsOf(summary: PlanSummary, field: Pick3): Map<string, Partial<Record<CompareMetric, number | null>>> {
  const out = new Map<string, Partial<Record<CompareMetric, number | null>>>();
  for (const p of summary.products) out.set(p.code, { units: p.units[field], revenue: p.revenue[field], promoMargin: p.promoMargin[field], directMargin: p.directMargin[field] });
  for (const t of summary.top) if (t.kind === "group") out.set(t.code, { revenue: t.revenue[field], promoMargin: t.promoMargin[field], directMargin: t.directMargin[field] });
  out.set("total", { revenue: summary.total.revenue[field], promoMargin: summary.total.promoMargin[field], directMargin: summary.total.directMargin[field] });
  return out;
}

async function loadVersions(month: string) {
  const [lines, adjustments, pulls] = await Promise.all([
    prisma.planLine.findMany({ where: { month }, select: { version: true, product: true, metric: true, value: true } }),
    prisma.planAdjustment.findMany({ where: { month }, select: { product: true, metric: true, value: true, createdAt: true } }),
    prisma.planPull.findMany({ where: { month }, orderBy: { at: "asc" }, select: { id: true, at: true, byName: true } }),
  ]);
  return { lines, adjustments, pulls };
}

/** Какие версии месяца можно сравнить */
export function versionOptions(month: string, data: { adjustments: AdjLike[]; pulls: { id: string; at: Date; byName: string }[] }, now = new Date()): VersionOption[] {
  const today = mskDay(now);
  const out: VersionOption[] = [
    { id: "budget", label: "Бюджет", group: "Версии месяца" },
    { id: "lbe", label: "LBE, последняя загрузка", group: "Версии месяца" },
    { id: "forecast", label: "Прогноз сейчас", group: "Версии месяца" },
  ];
  // Прежние загрузки: последняя и есть «LBE»
  for (const p of data.pulls.slice(0, -1).reverse()) out.push({ id: `pull:${p.id}`, label: `LBE загрузки ${stamp(p.at)}`, group: "Загрузки LBE" });
  // Дни, когда менялся прогноз: корректировки и загрузки. Сегодня это «Прогноз сейчас»
  const days = new Set<string>([...data.adjustments.map((a) => mskDay(a.createdAt)), ...data.pulls.map((p) => mskDay(p.at))]);
  for (const day of [...days].filter((d) => d < today).sort().reverse()) out.push({ id: `day:${day}`, label: `Прогноз на конец ${ddmm(day)}`, group: "Прогноз на дату" });
  return out;
}

/** Сравнить две версии месяца. a и b: id из списка версий; неизвестная версия заменяется на бюджет и прогноз сейчас */
export async function compareVersions(monthInput: string | null | undefined, aInput?: string | null, bInput?: string | null, now = new Date()): Promise<CompareView | null> {
  const month = isMonth(monthInput) ? monthInput : currentMonth(now);
  const data = await loadVersions(month);
  if (!data.lines.length) return null;
  const options = versionOptions(month, data, now);
  const a = options.find((o) => o.id === aInput) ?? options[0]!;
  const b = options.find((o) => o.id === bInput) ?? options.find((o) => o.id === "forecast")!;
  const notes: string[] = [];
  const pullLines = new Map<string, LineLike[]>();
  const pullOf = async (id: string) => {
    if (!pullLines.has(id)) {
      const row = await prisma.planPull.findUnique({ where: { id }, select: { lines: true } });
      pullLines.set(id, (row?.lines as LineLike[] | null) ?? []);
    }
    return pullLines.get(id)!;
  };
  const valuesOf = async (o: VersionOption) => {
    if (o.id === "budget" || o.id === "lbe" || o.id === "forecast") {
      return rowsOf(summarize(inputFrom(data.lines, data.adjustments, null)), o.id === "budget" ? "budget" : o.id === "lbe" ? "lbe" : "forecast");
    }
    if (o.id.startsWith("pull:")) return rowsOf(summarize(inputFrom(await pullOf(o.id.slice(5)), [], null)), "lbe");
    // Прогноз на конец дня: LBE загрузки, действовавшей в тот день, и корректировки до конца дня
    const day = o.id.slice(4);
    const end = endOfMskDay(day);
    const pull = [...data.pulls].reverse().find((p) => p.at < end);
    let lines: LineLike[] = data.lines;
    if (pull) lines = await pullOf(pull.id);
    else notes.push(`Снимков загрузки LBE до ${ddmm(day)} нет: для этого дня взят LBE последней загрузки`);
    return rowsOf(summarize(inputFrom(lines, data.adjustments, end)), "forecast");
  };
  const [va, vb] = await Promise.all([valuesOf(a), valuesOf(b)]);
  const summary = summarize(inputFrom(data.lines, data.adjustments, null));
  const rows: CompareRow[] = [];
  const push = (code: string, label: string, kind: CompareRow["kind"]) => rows.push({ code, label, kind, a: va.get(code) ?? {}, b: vb.get(code) ?? {} });
  for (const t of summary.top) {
    if (t.kind === "product") push(t.code, t.label, "product");
    else {
      push(t.code, t.label, "group");
      for (const code of t.parts) push(code, planLabel(code), "sub");
    }
  }
  push("total", "Итого по продуктам", "total");
  return { month, monthLabel: monthLabel(month), options, a, b, rows, notes: [...new Set(notes)] };
}

// ---------- Сводка для отчёта CEO и встречи ----------

/**
 * Сводка на встрече команды: у топ-команды всегда, у других команд, если в ней есть кто-то из команд продуктов.
 * null: прогноза нет или команде он не нужен
 */
export async function planForTeam(actor: Actor, teamId: string, month: string): Promise<PlanBrief | null> {
  if (teamId !== TOP_TEAM) {
    const [team, owners] = await Promise.all([
      prisma.team.findUnique({ where: { id: teamId }, select: { leader: { select: { slug: true } }, members: { select: { person: { select: { slug: true } } } } } }),
      ownersMap(),
    ]);
    if (!team) return null;
    const slugs = new Set([team.leader?.slug, ...team.members.map((m) => m.person.slug)].filter(Boolean));
    if (!Object.values(owners).some((list) => list.some((s) => slugs.has(s)))) return null;
  }
  return planBrief(actor, month);
}

/** Сводка месяца для отчёта CEO и встречи. null: прогноза на этот месяц нет */
export async function planBrief(actor: Actor, month: string): Promise<PlanBrief | null> {
  if (!isMonth(month)) return null;
  const view = await monthPlan(actor, month);
  if (view.empty || view.month !== month) return null;
  return briefOf(view);
}
