// Прогноз месяца в процессах (этап 35): когда загружен LBE, проверила ли команда продукта прогноз после загрузки и факт
// месяца по дням. Только чтение из базы, без прав: права проверяет вызывающий

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { getSetting } from "@/lib/settings";
import { FACT_METRICS, type FactMetric } from "./facts";
import type { ProductFacts, ReviewView } from "./types";
import { PARTNER_OWNER_CODE } from "./partners";

/** Последняя загрузка месяца: снимок загрузки, а если снимков ещё нет (загружено до этапа 35), отметка в настройках */
export async function lastPullAt(month: string): Promise<Date | null> {
  const [pull, pulled] = await Promise.all([
    prisma.planPull.findFirst({ where: { month }, orderBy: { at: "desc" }, select: { at: true } }),
    getSetting<Record<string, { at: string }>>("plan.pulled", {}),
  ]);
  if (pull) return pull.at;
  const at = pulled?.[month]?.at;
  return at ? new Date(at) : null;
}

/**
 * Проверка прогноза по продуктам после загрузки: последняя корректировка или отметка «Прогноз проверен» позже загрузки.
 * adjustments: корректировки месяца, новые сверху
 */
export async function reviewsOf(month: string, since: Date | null, adjustments: { product: string; createdAt: Date; author: { fullName: string } }[]): Promise<Map<string, ReviewView>> {
  const out = new Map<string, ReviewView>();
  if (!since) return out;
  const checks = await prisma.planCheck.findMany({ where: { month, at: { gt: since } }, include: { author: { select: { fullName: true } } }, orderBy: { at: "desc" } });
  const products = new Set([...adjustments.map((a) => a.product), ...checks.map((c) => c.product)]);
  for (const product of products) {
    const adj = adjustments.find((a) => a.product === product && a.createdAt > since);
    const check = checks.find((c) => c.product === product);
    if (adj && (!check || adj.createdAt >= check.at)) out.set(product, { state: "adjusted", by: adj.author.fullName, at: adj.createdAt.toISOString(), since: since.toISOString() });
    else if (check) out.set(product, { state: "checked", by: check.author.fullName, at: check.at.toISOString(), since: since.toISOString() });
  }
  return out;
}

export const waitingReview = (since: Date): ReviewView => ({ state: "waiting", by: null, at: null, since: since.toISOString() });

/**
 * Событие «Проверьте прогноз» разобрано у тех из команды продукта, у кого после загрузки проверены все продукты с LBE:
 * корректировкой или отметкой, кем угодно из команды. Проверили один продукт из восьми: напоминание остаётся
 */
export async function closePlanReminders(tx: Prisma.TransactionClient, month: string, product: string, owners: Record<string, string[]>): Promise<void> {
  const since = await lastPullAt(month);
  if (!since) return;
  const slugs = owners[product] ?? [];
  if (!slugs.length) return;
  const people = await tx.person.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } });
  const all = [...new Set(people.flatMap((p) => Object.entries(owners).filter(([, list]) => list.includes(p.slug)).map(([code]) => code)))];
  const loaded = new Set((await tx.planLine.findMany({ where: { month, version: "LBE", product: { in: all } }, distinct: ["product"], select: { product: true } })).map((l) => l.product));
  // Партнёрский канал (этап 35б): загружен, если есть партнёры месяца; проверен корректировкой партнёра или отметкой
  if (all.includes(PARTNER_OWNER_CODE) && (await tx.planPartner.count({ where: { month } }))) loaded.add(PARTNER_OWNER_CODE);
  const [adjusted, checked, partnerAdjusted] = await Promise.all([
    tx.planAdjustment.findMany({ where: { month, product: { in: [...loaded] }, createdAt: { gt: since } }, distinct: ["product"], select: { product: true } }),
    tx.planCheck.findMany({ where: { month, product: { in: [...loaded] }, at: { gt: since } }, distinct: ["product"], select: { product: true } }),
    loaded.has(PARTNER_OWNER_CODE) ? tx.planPartnerAdjustment.findFirst({ where: { month, createdAt: { gt: since } }, select: { id: true } }) : null,
  ]);
  const done = new Set([...adjusted, ...checked].map((x) => x.product));
  if (partnerAdjusted) done.add(PARTNER_OWNER_CODE);
  const finished = people.filter((p) => Object.entries(owners).every(([code, list]) => !list.includes(p.slug) || !loaded.has(code) || done.has(code)));
  if (!finished.length) return;
  await tx.inboxEvent.updateMany({ where: { recipientId: { in: finished.map((p) => p.id) }, subject: `plan:${month}`, doneAt: null }, data: { doneAt: new Date() } });
}

/** Факт месяца по дням по продуктам: дни по порядку, кто и когда загрузил последним */
export async function factsOf(month: string): Promise<Map<string, ProductFacts>> {
  const rows = await prisma.planFact.findMany({ where: { month }, orderBy: [{ day: "asc" }] });
  const out = new Map<string, ProductFacts>();
  const metrics = new Set(FACT_METRICS.map((m) => m.key));
  for (const r of rows) {
    if (!metrics.has(r.metric as FactMetric)) continue;
    const f = out.get(r.product) ?? { daily: {}, loadedAt: r.loadedAt.toISOString(), loadedBy: r.loadedBy };
    const list = f.daily[r.metric as FactMetric] ?? [];
    list.push({ day: r.day.toISOString().slice(0, 10), value: r.value });
    f.daily[r.metric as FactMetric] = list;
    if (r.loadedAt.toISOString() > f.loadedAt) {
      f.loadedAt = r.loadedAt.toISOString();
      f.loadedBy = r.loadedBy;
    }
    out.set(r.product, f);
  }
  return out;
}
