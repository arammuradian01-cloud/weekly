// Партнёрский канал в прогнозе месяца (этап 35б): чтение и запись в базе без проверки прав. Права, загрузку и
// корректировки проверяют service.ts и processes.ts. Партнёры месяца заменяются целиком при загрузке LBE, корректировки
// команды канала остаются: код партнёра от загрузки к загрузке тот же

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { FORECAST_REASONS, type ForecastReasonCode } from "@/lib/forecast/codes";
import {
  PARTNER_OWNER_CODE,
  PARTNER_UNITS,
  partnerMetricLabel,
  type PartnerChannel,
  type PartnerDrivers,
  type PartnerMetric,
  type PartnerPull,
  type PartnerTotalInput,
  type PartnerValues,
} from "./partners";
import type { PartnerAdjustmentView, PartnerChannelView, PartnerLineView, PlanPerson, ReviewView } from "./types";

export const PARTNER_HISTORY = 60;

type Tx = Prisma.TransactionClient;
type AdjRow = Prisma.PlanPartnerAdjustmentGetPayload<{ include: { author: { select: { slug: true; fullName: true } } } }>;
type LineMeta = { label: string; product: string; channel: PartnerChannel };

const reasonCode = (db: string): ForecastReasonCode => FORECAST_REASONS.find((r) => r.db === db)?.code ?? "other";
const reasonLabel = (db: string) => FORECAST_REASONS.find((r) => r.db === db)?.label ?? "Другое";

export function partnerAdjustmentView(a: AdjRow, meta: LineMeta | undefined): PartnerAdjustmentView {
  const metric = a.metric as PartnerMetric;
  const channel = meta?.channel ?? "cpa";
  return {
    id: a.id,
    partner: a.partner,
    partnerLabel: meta?.label ?? "Партнёр не найден в последней загрузке",
    product: meta?.product ?? "",
    channel,
    metric,
    metricLabel: partnerMetricLabel(metric, channel),
    unit: PARTNER_UNITS[metric] ?? "count",
    value: a.value,
    previous: a.previous,
    reason: reasonCode(a.reason),
    reasonLabel: reasonLabel(a.reason),
    comment: a.comment,
    author: { slug: a.author.slug, name: a.author.fullName },
    at: a.createdAt.toISOString(),
  };
}

/** Записать партнёров и бюджет канала месяца из загрузки: прежние строки месяца заменяются */
export async function writePartners(tx: Tx, month: string, pull: PartnerPull, now: Date): Promise<number> {
  await tx.planPartner.deleteMany({ where: { month } });
  await tx.planPartnerTotal.deleteMany({ where: { month } });
  await tx.planPartner.createMany({
    data: pull.lines.map((l) => ({ month, code: l.code, label: l.label, product: l.product, channel: l.channel, kind: l.kind, position: l.position, lbe: l.lbe as Prisma.InputJsonValue, pulledAt: now })),
  });
  await tx.planPartnerTotal.createMany({
    data: pull.totals.map((t) => ({ month, product: t.product, channel: t.channel, version: t.version === "BUD" ? "BUDGET" : "LBE", revenue: t.revenue, costs: t.costs, margin: t.margin, pulledAt: now })),
  });
  return pull.lines.length;
}

/** Партнёры месяца: код, продукт, канал и LBE. Для корректировки и итогов */
export async function partnerLines(month: string, db: Pick<Tx, "planPartner"> = prisma) {
  return db.planPartner.findMany({ where: { month }, orderBy: { position: "asc" } });
}

/** Проверка канала после загрузки LBE: корректировка партнёра или отметка «Прогноз проверен» позже загрузки */
async function reviewOf(month: string, since: Date, adjustments: AdjRow[]): Promise<ReviewView> {
  const check = await prisma.planCheck.findFirst({ where: { month, product: PARTNER_OWNER_CODE, at: { gt: since } }, include: { author: { select: { fullName: true } } }, orderBy: { at: "desc" } });
  const adj = adjustments.find((a) => a.createdAt > since);
  if (adj && (!check || adj.createdAt >= check.at)) return { state: "adjusted", by: adj.author.fullName, at: adj.createdAt.toISOString(), since: since.toISOString() };
  if (check) return { state: "checked", by: check.author.fullName, at: check.at.toISOString(), since: since.toISOString() };
  return { state: "waiting", by: null, at: null, since: since.toISOString() };
}

/** Партнёрский канал для экрана. null: партнёры месяца не загружены */
export async function partnerView(month: string, opts: { owners: PlanPerson[]; canAdjust: boolean; since: Date | null; closed: boolean }): Promise<PartnerChannelView | null> {
  const [rows, totals, adjustments] = await Promise.all([
    partnerLines(month),
    prisma.planPartnerTotal.findMany({ where: { month } }),
    prisma.planPartnerAdjustment.findMany({ where: { month }, include: { author: { select: { slug: true, fullName: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
  ]);
  if (!rows.length) return null;
  const meta = new Map(rows.map((r) => [r.code, { label: r.label, product: r.product, channel: r.channel as PartnerChannel }]));
  const drivers = new Map<string, PartnerDrivers>();
  const last = new Map<string, Partial<Record<PartnerMetric, PartnerAdjustmentView>>>();
  // Новые сверху: первая встреченная по показателю и есть действующая
  for (const a of adjustments) {
    const l = last.get(a.partner) ?? {};
    if (l[a.metric as PartnerMetric]) continue;
    l[a.metric as PartnerMetric] = partnerAdjustmentView(a, meta.get(a.partner));
    last.set(a.partner, l);
    if (a.value !== null) drivers.set(a.partner, { ...(drivers.get(a.partner) ?? {}), [a.metric]: a.value });
  }
  const lines: PartnerLineView[] = rows.map((r) => ({
    code: r.code,
    label: r.label,
    product: r.product,
    channel: r.channel as PartnerChannel,
    kind: r.kind,
    lbe: r.lbe as PartnerValues,
    drivers: drivers.get(r.code) ?? {},
    last: last.get(r.code) ?? {},
  }));
  const total: PartnerTotalInput[] = totals.map((t) => ({ product: t.product, channel: t.channel as PartnerChannel, version: t.version === "BUDGET" ? "BUD" : "LBE", revenue: t.revenue, costs: t.costs, margin: t.margin }));
  return {
    lines,
    totals: total,
    owners: opts.owners,
    canAdjust: opts.canAdjust,
    review: opts.since && !opts.closed ? await reviewOf(month, opts.since, adjustments) : null,
    // Корректировки партнёров, которых нет в последней загрузке, в журнале остаются с пометкой
    history: adjustments.slice(0, PARTNER_HISTORY).map((a) => partnerAdjustmentView(a, meta.get(a.partner))),
    pulledAt: rows[0]!.pulledAt.toISOString(),
  };
}
