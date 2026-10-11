// Партнёрский канал в прогнозе месяца (этап 35б): чтение и запись в базе без проверки прав. Права, загрузку и
// корректировки проверяют service.ts и processes.ts. Партнёры месяца заменяются целиком при загрузке LBE, корректировки
// команды канала остаются: код партнёра от загрузки к загрузке тот же

import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { FORECAST_REASONS, type ForecastReasonCode } from "@/lib/forecast/codes";
import {
  PARTNER_OWNER_CODE,
  PARTNER_UNITS,
  partnerMetricLabel,
  type PartnerChannel,
  type PartnerDrivers,
  type PartnerMetric,
  type PartnerPull,
  type PartnerSnapshotLine,
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
  // Без листа P&L прежний бюджет канала остаётся: лист могли временно переименовать
  if (pull.pnl === false) {
    await tx.planPartner.createMany({
      data: pull.lines.map((l) => ({ month, code: l.code, label: l.label, product: l.product, channel: l.channel, kind: l.kind, position: l.position, lbe: l.lbe as Prisma.InputJsonValue, pulledAt: now })),
    });
    return pull.lines.length;
  }
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

/** Снимок партнёров для загрузки LBE (этап 39): из него считаются LBE прежней загрузки и прогноз на дату */
export function partnerSnapshot(pull: PartnerPull): Prisma.InputJsonValue {
  return pull.lines.map((l) => ({ code: l.code, label: l.label, kind: l.kind, product: l.product, channel: l.channel, lbe: l.lbe })) as Prisma.InputJsonValue;
}

export type PartnerRow = { code: string; label: string; kind: string; product: string; channel: PartnerChannel; lbe: PartnerValues };

const MSK = 3 * 60 * 60 * 1000;
const stamp = (d: Date) => {
  const m = new Date(d.getTime() + MSK).toISOString();
  return `${m.slice(8, 10)}.${m.slice(5, 7)}, ${m.slice(11, 16)}`;
};

/**
 * Партнёры, которые действовали в момент t (этап 39): последняя загрузка партнёров до t (inclusive: и в сам момент).
 * Снимка до момента нет: партнёры ближайшей загрузки после него (первой со снимком). Снимков нет совсем (загрузки до
 * этапа 39): партнёры последней загрузки. В обоих случаях пометка. null: партнёров у месяца нет. current: уже прочитанные
 * текущие партнёры, чтобы не читать их ещё раз
 */
export async function partnerRowsAt(
  month: string,
  t: Date | null,
  opts: { inclusive?: boolean; when?: string; current?: PartnerRow[] | null; pulledAt?: Date } = {},
): Promise<{ rows: PartnerRow[]; pulledAt: Date; note: string | null } | null> {
  let rows = opts.current ?? null;
  let pulledAt = opts.pulledAt ?? null;
  if (!rows || !pulledAt) {
    const current = await partnerLines(month);
    if (!current.length) return null;
    rows = current.map((r) => ({ code: r.code, label: r.label, kind: r.kind, product: r.product, channel: r.channel as PartnerChannel, lbe: r.lbe as PartnerValues }));
    pulledAt = current[0]!.pulledAt;
  }
  if (!rows.length) return null;
  if (!t) return { rows, pulledAt, note: null };
  if (opts.inclusive ? pulledAt <= t : pulledAt < t) return { rows, pulledAt, note: null };
  const when = opts.when ?? stamp(t);
  const known = new Map(rows.map((r) => [r.code, r]));
  const fromSnapshot = (lines: PartnerSnapshotLine[]): PartnerRow[] =>
    lines.map((l) => ({
      code: l.code,
      label: l.label ?? known.get(l.code)?.label ?? "Партнёр не найден в последней загрузке",
      kind: l.kind ?? known.get(l.code)?.kind ?? "",
      product: l.product,
      channel: l.channel,
      lbe: l.lbe,
    }));
  const snap = await prisma.planPull.findFirst({
    where: { month, partners: { not: Prisma.DbNull }, at: opts.inclusive ? { lte: t } : { lt: t } },
    orderBy: { at: "desc" },
    select: { at: true, partners: true },
  });
  if (snap) return { rows: fromSnapshot(snap.partners as PartnerSnapshotLine[]), pulledAt: snap.at, note: null };
  const first = await prisma.planPull.findFirst({ where: { month, partners: { not: Prisma.DbNull } }, orderBy: { at: "asc" }, select: { at: true, partners: true } });
  if (first) return { rows: fromSnapshot(first.partners as PartnerSnapshotLine[]), pulledAt: first.at, note: `Снимка партнёров на ${when} нет: показаны партнёры ближайшей загрузки, ${stamp(first.at)}` };
  return { rows, pulledAt, note: `Снимка партнёров на ${when} нет: показаны партнёры последней загрузки, ${stamp(pulledAt)}` };
}

/** Проверка канала после загрузки LBE: корректировка партнёра или отметка «Прогноз проверен» позже загрузки */
async function reviewOf(month: string, since: Date, adjustments: AdjRow[]): Promise<ReviewView> {
  const check = await prisma.planCheck.findFirst({ where: { month, product: PARTNER_OWNER_CODE, at: { gt: since } }, include: { author: { select: { fullName: true } } }, orderBy: { at: "desc" } });
  const adj = adjustments.find((a) => a.createdAt > since);
  if (adj && (!check || adj.createdAt >= check.at)) return { state: "adjusted", by: adj.author.fullName, at: adj.createdAt.toISOString(), since: since.toISOString() };
  if (check) return { state: "checked", by: check.author.fullName, at: check.at.toISOString(), since: since.toISOString() };
  return { state: "waiting", by: null, at: null, since: since.toISOString() };
}

/**
 * Партнёрский канал для экрана. null: партнёры месяца не загружены. at (этап 39): канал на момент, для отчёта CEO за
 * прошлую неделю: партнёры того момента и корректировки до него, без проверки и правки
 */
export async function partnerView(month: string, opts: { owners: PlanPerson[]; canAdjust: boolean; since: Date | null; closed: boolean; at?: Date | null; when?: string }): Promise<PartnerChannelView | null> {
  const at = opts.at ?? null;
  const [state, totals, adjustments] = await Promise.all([
    partnerRowsAt(month, at, { when: opts.when }),
    prisma.planPartnerTotal.findMany({ where: { month } }),
    prisma.planPartnerAdjustment.findMany({ where: { month, ...(at ? { createdAt: { lt: at } } : {}) }, include: { author: { select: { slug: true, fullName: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
  ]);
  if (!state) return null;
  const rows = state.rows;
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
    canAdjust: at ? false : opts.canAdjust,
    // Проверка канала считается от загрузки партнёров: если последняя загрузка LBE прошла без листов b2b, партнёры прежние,
    // и проверять их заново не нужно. На прошлый момент проверки нет
    review: !at && opts.since && !opts.closed ? await reviewOf(month, state.pulledAt, adjustments) : null,
    // Корректировки партнёров, которых нет в последней загрузке, в журнале остаются с пометкой
    history: adjustments.slice(0, PARTNER_HISTORY).map((a) => partnerAdjustmentView(a, meta.get(a.partner))),
    pulledAt: state.pulledAt.toISOString(),
    ...(state.note ? { note: state.note } : {}),
  };
}
