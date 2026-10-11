// Сводка прогноза месяца для отчёта CEO и встречи (этап 35): итог, отклонения, причины корректировок и кто ещё не
// проверил прогноз после загрузки LBE. Чистые функции: текст отчёта собирается и на сервере, и на экране

import { derive } from "./model";
import { formatPlan, lcFirst } from "./format";
import { UNITS, metricLabel, productOf, type MetricKey } from "./spec";
import { planLabel, summarize, type PlanSummary, type Triple } from "./summary";
import type { MonthPlanView, ReviewView } from "./types";
import { PARTNER_LABEL, PARTNER_UNITS, activePartnerDrivers, derivePartner, partnerMetricLabel, partnerTotals, productName, type PartnerMetric } from "./partners";

export type PlanBriefRow = { code: string; label: string; kind: "product" | "group" | "sub"; revenue: Triple; promoMargin: Triple; adjusted: number; review: ReviewView | null; owners: string[] };

export type PlanBrief = {
  month: string;
  monthLabel: string;
  total: PlanSummary["total"];
  rows: PlanBriefRow[];
  /** Действующие корректировки: свежие сверху */
  reasons: { product: string; metric: string; value: string; lbe: string; reason: string; comment: string; author: string; at: string }[];
  /** Продукты, где после загрузки LBE прогноз ещё не проверен */
  waiting: { product: string; owners: string[] }[];
  pulledAt: string | null;
  /** Партнёрский канал (этап 35б): выручка и маржа канала, бюджет из P&L b2b. null: партнёры не загружены */
  partners: { revenue: Triple; margin: Triple; adjusted: number; partners: number; review: ReviewView | null; owners: string[] } | null;
  /** Корректировки партнёров отдельным списком: десяток правок партнёров не вытесняет причины продуктов */
  partnerReasons: PlanBrief["reasons"];
  /** Сколько ещё партнёров с действующими корректировками не попало в список */
  partnersMore: number;
  /**
   * Прогноз на прошлый момент (этап 39): отчёт CEO за прошлую неделю показывает прогноз на конец той недели. day:
   * последний день, который вошёл (воскресенье), для сравнения с прогнозом сейчас. null: прогноз сейчас
   */
  asOf: { at: string; when: string; day: string; notes: string[] } | null;
};

export const PLAN_BRIEF_PARTNER_REASONS = 3;

/** Месяц недели: месяц её четверга, как у номера недели */
export function planMonthOfWeek(weekKey: string): string {
  const d = new Date(`${weekKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3);
  return d.toISOString().slice(0, 7);
}

/**
 * На какой момент брать прогноз для отчёта CEO недели (этап 39). Отчётная неделя и новее: прогноз сейчас (null).
 * Прошлые недели: конец недели, воскресенье 24:00 по Москве
 */
export function planAsOfWeek(weekKey: string, reportingKey: string, weekNumber: number): { at: Date; when: string } | null {
  if (weekKey >= reportingKey) return null;
  const monday = new Date(`${weekKey}T00:00:00Z`);
  const at = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000 - 3 * 60 * 60 * 1000);
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { at, when: `конец недели ${weekNumber}, ${sunday.slice(8, 10)}.${sunday.slice(5, 7)}` };
}

export const PLAN_BRIEF_REASONS = 6;

export function briefOf(view: MonthPlanView): PlanBrief {
  const summary = summarize({ products: view.products.map((p) => ({ code: p.code, lbe: p.lbe, budget: p.budget, drivers: p.drivers })), groups: view.groups });
  const byCode = new Map(view.products.map((p) => [p.code, p]));
  const rows: PlanBriefRow[] = [];
  for (const t of summary.top) {
    if (t.kind === "product") {
      const p = byCode.get(t.code)!;
      rows.push({ code: t.code, label: t.label, kind: "product", revenue: t.revenue, promoMargin: t.promoMargin, adjusted: t.adjusted, review: p.review, owners: p.owners.map((o) => o.name) });
    } else {
      rows.push({ code: t.code, label: t.label, kind: "group", revenue: t.revenue, promoMargin: t.promoMargin, adjusted: t.adjusted, review: null, owners: [] });
      for (const code of t.parts) {
        const s = summary.products.find((x) => x.code === code)!;
        const p = byCode.get(code)!;
        rows.push({ code, label: planLabel(code), kind: "sub", revenue: s.revenue, promoMargin: s.promoMargin, adjusted: s.adjusted, review: p.review, owners: p.owners.map((o) => o.name) });
      }
    }
  }
  const reasons: PlanBrief["reasons"] = [];
  for (const p of view.products) {
    const spec = productOf(p.code)!;
    const L = derive(p.lbe);
    for (const [metric, a] of Object.entries(p.last) as [MetricKey, NonNullable<(typeof p.last)[MetricKey]>][]) {
      if (a.value === null) continue;
      const unit = UNITS[metric];
      reasons.push({ product: spec.label, metric: metricLabel(spec, metric), value: formatPlan(a.value, unit), lbe: formatPlan(L[metric] ?? null, unit), reason: a.reasonLabel, comment: a.comment, author: a.author.name, at: a.at });
    }
  }
  // Корректировки партнёров рядом с корректировками продуктов: «Партнёрский канал, Банк, ОСАГО»
  let partners: PlanBrief["partners"] = null;
  const partnerReasons: (PlanBrief["reasons"][number] & { code: string })[] = [];
  const activeCodes = new Set<string>();
  if (view.partners) {
    for (const l of view.partners.lines) {
      const L = derivePartner(l.lbe);
      // Только действующие корректировки: равная LBE после перезагрузки или драйвер, которого нет в LBE, не в счёт
      const active = activePartnerDrivers(l.lbe, l.drivers);
      if (Object.keys(active).length) activeCodes.add(l.code);
      for (const [metric, a] of Object.entries(l.last) as [PartnerMetric, NonNullable<(typeof l.last)[PartnerMetric]>][]) {
        if (a.value === null || active[metric] === undefined) continue;
        const unit = PARTNER_UNITS[metric];
        partnerReasons.push({ code: l.code, product: `${l.label}, ${productName(l.product)}`, metric: partnerMetricLabel(metric, l.channel), value: formatPlan(a.value, unit), lbe: formatPlan(L[metric] ?? null, unit), reason: a.reasonLabel, comment: a.comment, author: a.author.name, at: a.at });
      }
    }
    const t = partnerTotals(view.partners.lines, view.partners.totals).total;
    partners = { revenue: t.revenue, margin: t.margin, adjusted: t.adjusted, partners: t.partners, review: view.partners.review, owners: view.partners.owners.map((o) => o.name) };
  }
  reasons.sort((x, y) => y.at.localeCompare(x.at));
  partnerReasons.sort((x, y) => y.at.localeCompare(x.at));
  const waiting = view.products.filter((p) => p.review?.state === "waiting").map((p) => ({ product: productOf(p.code)!.label, owners: p.owners.map((o) => o.name) }));
  if (partners?.review?.state === "waiting") waiting.push({ product: PARTNER_LABEL, owners: partners.owners });
  const asOf = view.asOf
    ? { at: view.asOf.at, when: view.asOf.when, day: new Date(new Date(view.asOf.at).getTime() - 1 + 3 * 60 * 60 * 1000).toISOString().slice(0, 10), notes: view.asOf.notes }
    : null;
  return { month: view.month, monthLabel: view.monthLabel, total: summary.total, rows, reasons: reasons.slice(0, PLAN_BRIEF_REASONS), waiting, pulledAt: view.source.pulledAt, partners, ...partnerList(partnerReasons, activeCodes), asOf };
}

/** Самые свежие корректировки партнёров и сколько ещё партнёров с корректировками осталось за списком */
function partnerList(all: (PlanBrief["reasons"][number] & { code: string })[], active: Set<string>): Pick<PlanBrief, "partnerReasons" | "partnersMore"> {
  const shown = all.slice(0, PLAN_BRIEF_PARTNER_REASONS);
  const codes = new Set(shown.map((r) => r.code));
  return { partnerReasons: shown.map(({ code: _code, ...r }) => r), partnersMore: [...active].filter((c) => !codes.has(c)).length };
}

const pctTo = (value: number | null, base: number | null) => (value === null || base === null || base === 0 ? null : ((value - base) / Math.abs(base)) * 100);
const pctText = (p: number | null) => (p === null ? "" : `${p > 0 ? "+" : ""}${p.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);

/** Кто ждёт проверки одной фразой: продукты, потом люди без повторов (Рева в каждом продукте не повторяется) */
export function waitingText(waiting: PlanBrief["waiting"]): string {
  const people = [...new Set(waiting.flatMap((w) => w.owners))];
  return `Ждут проверки после загрузки LBE: ${waiting.map((w) => w.product).join(", ")}${people.length ? `. Проверяют: ${people.join(", ")}` : ""}`;
}

/** Сводка текстом для копирования и письма отчёта CEO */
export function planBriefText(b: PlanBrief): string[] {
  const line = (label: string, t: Triple) => {
    const toBudget = pctText(pctTo(t.forecast, t.budget));
    return `${label}: прогноз ${formatPlan(t.forecast, "mln")} млн, LBE ${formatPlan(t.lbe, "mln")}, бюджет ${formatPlan(t.budget, "mln")}${toBudget ? `, к бюджету ${toBudget}` : ""}`;
  };
  const head = `${b.monthLabel.replace(/^./, (c) => c.toUpperCase())}, итог по продуктам${b.asOf ? ` на ${b.asOf.when}` : ""}`;
  const out = [head, line("Выручка", b.total.revenue), line("Промо-маржа", b.total.promoMargin), line("Прямая маржа", b.total.directMargin)];
  // Партнёрский канал входит в продукты (это их полисы B2B), поэтому отдельной строкой, а не слагаемым итога
  if (b.partners) out.push(`${PARTNER_LABEL}, внутри продуктов: ${line("выручка", b.partners.revenue).replace(/^выручка: /, "выручка ")}; ${line("маржа", b.partners.margin).replace(/^маржа: /, "маржа ")}`);
  if (b.reasons.length) {
    out.push("Корректировки команд:");
    for (const r of b.reasons) out.push(`- ${r.product}, ${lcFirst(r.metric)}: ${r.value} вместо ${r.lbe} по LBE. ${r.reason}: ${r.comment} (${r.author})`);
  }
  if (b.partnerReasons.length) {
    out.push("Корректировки партнёрского канала:");
    for (const r of b.partnerReasons) out.push(`- ${r.product}, ${lcFirst(r.metric)}: ${r.value} вместо ${r.lbe} по LBE. ${r.reason}: ${r.comment} (${r.author})`);
    if (b.partnersMore > 0) out.push(`Ещё партнёров с корректировками: ${b.partnersMore}`);
  }
  if (b.waiting.length) out.push(waitingText(b.waiting));
  for (const n of b.asOf?.notes ?? []) out.push(n);
  return out;
}
