// Этап 81: расчёты экрана «Неделя к плану» без базы. На входе справочник строк, план по неделям и месяцам, факт по
// неделям и фиксации; на выходе цифры для вкладок «Итог», «Продукт», «Партнёрка».
//
// Правила (ТЗ аналитикам, разделы 8 и 11):
// - факт недели против плана выбранной версии (бюджет или LRF), рядом вторая версия;
// - к прошлому году: та же неделя 364 дня назад, если по ней есть факт;
// - месяц к дате: недели, которые начинаются в месяце выбранной недели, по выбранную включительно: факт против плана
//   этих же недель целиком; прогноз месяца по темпу = месяц к дате × план месяца;
// - неделя, у которой план есть не за все дни (28.09-04.10.2026 и 27.12.2027-02.01.2028), неполная: процент к плану по
//   ней не показывается;
// - срезы не складываются между собой: итог продукта берётся строкой итога, партнёры сверяются с каналом партнёров.

import { addDays, nextMonth, type Cut, type PlanLine, type Unit, type Version } from "./contract";

export type PlanData = {
  lines: PlanLine[];
  /** Недели плана по возрастанию */
  weeks: string[];
  /** Первый и последний день плана: неделя, которая выходит за них, неполная */
  first: string;
  last: string;
  /** План недели: сумма частей. Ключ line|version|week */
  week: Map<string, number>;
  /** План месяца: части недель и строки только по месяцам. Ключ line|version|month */
  month: Map<string, number>;
  /** Факт недели. Ключ line|week */
  fact: Map<string, number>;
};

export const wkey = (line: string, version: Version, week: string) => `${line}|${version}|${week}`;
export const mkey = (line: string, version: Version, month: string) => `${line}|${version}|${month}`;
export const fkey = (line: string, week: string) => `${line}|${week}`;

export const other = (v: Version): Version => (v === "BUD" ? "LRF" : "BUD");

/** Неделя неполная: часть её дней вне плана */
export const incomplete = (data: Pick<PlanData, "first" | "last">, week: string) => week < data.first || addDays(week, 6) > data.last;

/** Первый день месяца, в котором начинается неделя */
export const monthOfWeek = (week: string) => `${week.slice(0, 7)}-01`;

/**
 * Неделя по умолчанию: последняя закрытая (кончилась до сегодня), по которой есть факт. Факта нет: последняя закрытая
 * неделя плана; план ещё не начался: первая неделя
 */
export function defaultWeek(data: Pick<PlanData, "weeks" | "fact">, today: string): string | null {
  if (!data.weeks.length) return null;
  const closed = data.weeks.filter((w) => addDays(w, 6) < today);
  const withFact = new Set([...data.fact.keys()].map((k) => k.slice(k.indexOf("|") + 1)));
  return closed.filter((w) => withFact.has(w)).at(-1) ?? closed.at(-1) ?? data.weeks[0]!;
}

export type Figure = {
  fact: number | null;
  /** Часть строк без факта: сумма неполная */
  partial: boolean;
  plan: number | null;
  other: number | null;
  /** Факт к плану: доля (0.05 = +5%). null: нет факта, нет плана или неделя неполная */
  vsPlan: number | null;
  vsOther: number | null;
  /** К той же неделе год назад */
  vsYear: number | null;
  /** Месяц к дате: факт и план недель месяца по выбранную, доля */
  mtdFact: number | null;
  mtdPlan: number | null;
  mtd: number | null;
  /** План месяца выбранной версии и прогноз месяца по темпу */
  monthPlan: number | null;
  forecast: number | null;
};

const ratio = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b - 1);

function sum(ids: string[], get: (id: string) => number | undefined): { value: number | null; missing: number } {
  let value: number | null = null;
  let missing = 0;
  for (const id of ids) {
    const v = get(id);
    if (v === undefined) missing += 1;
    else value = (value ?? 0) + v;
  }
  return { value, missing };
}

/** Цифры строки или суммы строк (итог всех продуктов) за неделю */
export function figure(data: PlanData, ids: string[], week: string, base: Version): Figure {
  const alt = other(base);
  const fact = sum(ids, (id) => data.fact.get(fkey(id, week)));
  const plan = sum(ids, (id) => data.week.get(wkey(id, base, week))).value;
  const otherPlan = sum(ids, (id) => data.week.get(wkey(id, alt, week))).value;
  const year = sum(ids, (id) => data.fact.get(fkey(id, addDays(week, -364)))).value;
  const full = !incomplete(data, week);
  const month = monthOfWeek(week);
  const mtdWeeks = data.weeks.filter((w) => w <= week && monthOfWeek(w) === month);
  // Месяц к дате только по неделям, где факт есть у всех строк: иначе факт без части недель шёл бы против полного плана
  const mtdFactWeeks = mtdWeeks.filter((w) => ids.every((id) => data.fact.has(fkey(id, w))));
  const mtdOk = mtdFactWeeks.length === mtdWeeks.length && mtdWeeks.length > 0 && mtdWeeks.every((w) => !incomplete(data, w));
  const mtdFact = mtdOk ? mtdWeeks.reduce((s, w) => s + sum(ids, (id) => data.fact.get(fkey(id, w))).value!, 0) : null;
  const mtdPlan = mtdOk ? mtdWeeks.reduce((s, w) => s + (sum(ids, (id) => data.week.get(wkey(id, base, w))).value ?? 0), 0) : null;
  const monthPlan = sum(ids, (id) => data.month.get(mkey(id, base, month))).value;
  const mtd = ratio(mtdFact, mtdPlan);
  return {
    fact: fact.value,
    partial: fact.value !== null && fact.missing > 0,
    plan,
    other: otherPlan,
    vsPlan: full && fact.missing === 0 ? ratio(fact.value, plan) : null,
    vsOther: full && fact.missing === 0 ? ratio(fact.value, otherPlan) : null,
    vsYear: fact.missing === 0 ? ratio(fact.value, year) : null,
    mtdFact,
    mtdPlan,
    mtd,
    monthPlan,
    forecast: mtd !== null && monthPlan !== null ? (mtd + 1) * monthPlan : null,
  };
}

/** Ряд по неделям для графика: факт и план выбранной версии */
export function series(data: PlanData, ids: string[], base: Version): { weeks: string[]; fact: (number | null)[]; plan: (number | null)[] } {
  return {
    weeks: data.weeks,
    fact: data.weeks.map((w) => (ids.every((id) => data.fact.has(fkey(id, w))) ? sum(ids, (id) => data.fact.get(fkey(id, w))).value : null)),
    plan: data.weeks.map((w) => sum(ids, (id) => data.week.get(wkey(id, base, w))).value),
  };
}

// ---------- Продукты и строки ----------

export type Product = { code: string; name: string };

/** Код продукта: начало line_id (OS, CA, MI…) */
export const codeOf = (id: string) => id.slice(0, id.indexOf("."));
/** Показатель строки: последняя часть line_id (S продажи, R выручка, L лиды, K клики) */
export const metricOf = (id: string) => id.slice(id.lastIndexOf(".") + 1);
/** Строка без показателя: «OS.SK.ALFA» у полисов и выручки одной СК */
export const itemOf = (id: string) => id.slice(0, id.lastIndexOf("."));

export function products(lines: PlanLine[]): Product[] {
  const seen = new Map<string, string>();
  for (const l of lines) if (!seen.has(codeOf(l.id))) seen.set(codeOf(l.id), l.product);
  return [...seen].map(([code, name]) => ({ code, name }));
}

/** Строки итога продукта: выручка и продажи */
export const totalId = (code: string, metric: "S" | "R") => `${code}.TOT.${metric}`;

const METRIC_ORDER = ["S", "L", "K", "R"];
export const METRIC_TITLE: Record<string, string> = { S: "Продажи", L: "Лиды", K: "Клики", R: "Выручка" };

export type ItemRow = {
  key: string;
  /** Название позиции: канал, СК, тип продажи, регион или партнёр */
  name: string;
  cells: Record<string, { id: string; unit: Unit; figure: Figure }>;
};

/** Название позиции в срезе */
function itemName(l: PlanLine): string {
  switch (l.cut) {
    case "страховая":
    case "партнёр":
      return l.counterparty;
    case "регион":
      return l.region;
    case "тип продажи":
      return l.saleType;
    case "канал":
      return l.channel;
    default:
      return l.label;
  }
}

/** Таблица среза: позиция в строке, показатели колонками (продажи, лиды, клики, выручка) */
export function itemTable(data: PlanData, lines: PlanLine[], week: string, base: Version): { metrics: string[]; rows: ItemRow[] } {
  const rows = new Map<string, ItemRow>();
  const metrics = new Set<string>();
  for (const l of lines) {
    const key = itemOf(l.id);
    const m = metricOf(l.id);
    metrics.add(m);
    if (!rows.has(key)) rows.set(key, { key, name: itemName(l), cells: {} });
    rows.get(key)!.cells[m] = { id: l.id, unit: l.unit, figure: figure(data, [l.id], week, base) };
  }
  return { metrics: METRIC_ORDER.filter((m) => metrics.has(m)), rows: [...rows.values()] };
}

/** Строки продукта среза */
export const cutLines = (lines: PlanLine[], code: string, cut: Cut) => lines.filter((l) => codeOf(l.id) === code && l.cut === cut);

export type PartnerCheck = { metric: string; version: Version; partners: number; channel: number; ok: boolean };

/**
 * Сверка партнёров с каналом партнёров продукта за неделю (ТЗ, критерий приёмки 6): сумма плана партнёров против
 * строки канала. У ОСАГО отдельной строки канала партнёров нет (партнёры внутри b2b): сверки нет
 */
export function partnerChecks(data: PlanData, code: string, week: string): PartnerCheck[] {
  const partners = cutLines(data.lines, code, "партнёр");
  const out: PartnerCheck[] = [];
  for (const m of new Set(partners.map((l) => metricOf(l.id)))) {
    const channel = `${code}.PART.${m}`;
    if (!data.lines.some((l) => l.id === channel)) continue;
    for (const version of ["BUD", "LRF"] as const) {
      const p = partners.filter((l) => metricOf(l.id) === m).reduce((s, l) => s + (data.week.get(wkey(l.id, version, week)) ?? 0), 0);
      const c = data.week.get(wkey(channel, version, week)) ?? 0;
      out.push({ metric: m, version, partners: p, channel: c, ok: Math.abs(p - c) <= Math.max(0.01, Math.abs(c) * 1e-4) });
    }
  }
  return out;
}

/** Недели месяца (для подписи месяца к дате) */
export function monthWeeks(weeks: string[], week: string): string[] {
  const month = monthOfWeek(week);
  return weeks.filter((w) => w <= week && monthOfWeek(w) === month);
}

/** Последний день месяца */
export const monthEnd = (month: string) => addDays(nextMonth(month), -1);
