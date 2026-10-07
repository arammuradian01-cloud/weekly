// Прогноз до конца месяца (этап 24, модуль М9). Лидер раз в неделю ставит прогноз по своим линиям и метрикам
// и называет причину отклонения от бюджета. Строка на неделю хранится как есть: история по неделям и отклонение
// от прошлого прогноза получаются сами. Видят прогноз те же, кто видит weekly человека

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { canEdit, weekContext, type WeekAudience } from "@/lib/weekly/service";
import { audit } from "@/lib/weekly/service";
import { isoFromDbDate } from "@/lib/tasks/dates";
import { shiftWeek, weekNumberOf } from "@/lib/weekly/weeks";
import { TOP_TEAM, loadScope } from "@/lib/org/scope";
import type { PersonSlug, WeekKey } from "@/domain/types";
import { FORECAST_METRICS, FORECAST_REASONS, addMonths, deltaPct, formatForecast, metricLabel, monthOf, reasonLabel, type ForecastMetricCode, type ForecastReasonCode } from "./codes";
import type { ForecastHistory, ForecastLineInput, ForecastLineView, ForecastSummary, MyForecast } from "./types";

export type { ForecastHistory, ForecastLineInput, ForecastLineView, ForecastSummary, MyForecast } from "./types";
export { forecastText } from "./codes";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export const FORECAST_LIMITS = { comment: 500, lines: 40, historyWeeks: 12 };

const metricDb = (code: string) => FORECAST_METRICS.find((m) => m.code === code)?.db ?? fail("Нет такой метрики прогноза");
const metricCode = (db: string): ForecastMetricCode => FORECAST_METRICS.find((m) => m.db === db)?.code ?? "revenue";
const reasonDb = (code: string | null) => (code ? (FORECAST_REASONS.find((r) => r.code === code)?.db ?? fail("Нет такой причины")) : null);
const reasonCode = (db: string | null): ForecastReasonCode | null => (db ? (FORECAST_REASONS.find((r) => r.db === db)?.code ?? null) : null);

const include = { week: { select: { start: true } }, author: { select: { slug: true } }, direction: { select: { code: true, label: true } } } satisfies Prisma.ForecastInclude;
type Row = Prisma.ForecastGetPayload<{ include: typeof include }>;

function toView(row: Row, previous: Row | null): ForecastLineView {
  const metric = metricCode(row.metric);
  const week = isoFromDbDate(row.week.start) as WeekKey;
  const prev = previous ? { week: isoFromDbDate(previous.week.start) as WeekKey, weekNumber: weekNumberOf(isoFromDbDate(previous.week.start)), forecast: previous.forecast } : null;
  return {
    id: row.id,
    week,
    weekNumber: weekNumberOf(week),
    author: row.author.slug as PersonSlug,
    team: row.teamId,
    direction: row.direction.code,
    directionLabel: row.direction.label,
    metric,
    metricLabel: metricLabel(metric),
    unit: FORECAST_METRICS.find((m) => m.code === metric)?.unit ?? "mln",
    month: row.month,
    budget: row.budget,
    forecast: row.forecast,
    reason: reasonCode(row.reason),
    reasonLabel: reasonLabel(reasonCode(row.reason)),
    comment: row.comment,
    previous: prev,
    toBudgetPct: deltaPct(row.forecast, row.budget),
    toPreviousPct: prev ? deltaPct(row.forecast, prev.forecast) : null,
  };
}

const lineKey = (r: { authorId: string; directionId: string; metric: string; month: string }) => `${r.authorId}|${r.directionId}|${r.metric}|${r.month}`;

/** Для каждой строки недели найти прошлый прогноз той же линии: последняя неделя раньше */
async function withPrevious(rows: Row[], key: WeekKey): Promise<ForecastLineView[]> {
  if (!rows.length) return [];
  const authors = [...new Set(rows.map((r) => r.authorId))];
  const months = [...new Set(rows.map((r) => r.month))];
  const earlier = await prisma.forecast.findMany({
    where: { authorId: { in: authors }, month: { in: months }, week: { start: { lt: new Date(`${key}T00:00:00Z`) } } },
    include,
    orderBy: { week: { start: "desc" } },
  });
  const prevByLine = new Map<string, Row>();
  for (const e of earlier) if (!prevByLine.has(lineKey(e))) prevByLine.set(lineKey(e), e);
  return rows.map((r) => toView(r, prevByLine.get(lineKey(r)) ?? null));
}

/** Мой прогноз за неделю и что перенести с прошлой */
export async function myForecast(actor: Actor, key: WeekKey): Promise<MyForecast> {
  const { info, row: weekRow } = await weekContext(prisma, key, actor.personId);
  const rows = await prisma.forecast.findMany({ where: { authorId: actor.personId, weekId: weekRow.id }, include, orderBy: [{ direction: { sortOrder: "asc" } }, { metric: "asc" }, { month: "asc" }] });
  const lines = await withPrevious(rows, key);
  const have = new Set(rows.map((r) => `${r.directionId}|${r.metric}|${r.month}`));
  // Линии последних восьми недель, которых ещё нет: за тот же месяц или, если месяц прошёл, за следующий
  const earlier = await prisma.forecast.findMany({
    where: { authorId: actor.personId, week: { start: { lt: new Date(`${key}T00:00:00Z`), gte: new Date(`${shiftWeek(key, -8)}T00:00:00Z`) } } },
    include,
    orderBy: { week: { start: "desc" } },
  });
  const month = monthOf(key);
  const carry: ForecastLineView[] = [];
  const seen = new Set<string>();
  for (const e of earlier) {
    const targetMonth = e.month < month ? month : e.month;
    const id = `${e.directionId}|${e.metric}|${targetMonth}`;
    if (have.has(id) || seen.has(id)) continue;
    seen.add(id);
    const v = toView(e, null);
    carry.push({ ...v, month: targetMonth, budget: targetMonth === e.month ? e.budget : null, reason: targetMonth === e.month ? v.reason : null, reasonLabel: targetMonth === e.month ? v.reasonLabel : "", comment: null, previous: targetMonth === e.month ? { week: v.week, weekNumber: v.weekNumber, forecast: e.forecast } : null, toPreviousPct: null });
  }
  return { week: key, weekNumber: weekNumberOf(key), closed: info.closed, month, lines, carry };
}

function num(v: unknown, what: string, allowNull: boolean): number | null {
  if (v === null || v === undefined || v === "") {
    if (allowNull) return null;
    return fail(`${what}: нужно число`);
  }
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) fail(`${what}: нужно число`);
  if (n < 0) fail(`${what}: отрицательным не бывает`);
  if (Math.abs(n) > 1e12) fail(`${what}: слишком большое число`);
  return Math.round(n * 1000) / 1000;
}

/** В какую команду пишется прогноз: топ-команда, если человек в ней, иначе первая своя команда */
async function teamFor(actor: Actor): Promise<string> {
  const scope = await loadScope(prisma, { id: actor.personId, role: actor.role, limited: actor.via === "TEAM" && !actor.management });
  if (scope.member.includes(TOP_TEAM) || scope.all) return TOP_TEAM;
  return scope.member[0] ?? scope.leads[0] ?? TOP_TEAM;
}

/**
 * Сохранить мой прогноз за неделю целиком: строки из списка создаются или обновляются, остальные мои строки этой недели
 * убираются. Причина обязательна, когда прогноз отличается от бюджета больше чем на 2%
 */
export async function saveForecast(actor: Actor, key: WeekKey, input: ForecastLineInput[]): Promise<MyForecast> {
  if (!Array.isArray(input)) fail("Строки прогноза не разобраны");
  if (input.length > FORECAST_LIMITS.lines) fail(`Не больше ${FORECAST_LIMITS.lines} строк прогноза`);
  const { info, row: weekRow, reporting } = await weekContext(prisma, key, actor.personId);
  canEdit(info, reporting, actor, actor.slug);
  const directions = new Map((await prisma.dictionaryItem.findMany({ where: { kind: "DIRECTION", active: true } })).map((d) => [d.code, d]));
  const current = monthOf(key);
  const allowedMonths = new Set([addMonths(current, -1), current, addMonths(current, 1), addMonths(current, 2), addMonths(current, 3)]);
  const teamId = await teamFor(actor);
  const clean = input.map((l, i) => {
    const direction = directions.get(String(l?.direction ?? "")) ?? fail(`Строка ${i + 1}: выберите направление из списка`);
    const metric = metricDb(String(l?.metric ?? ""));
    const month = String(l?.month ?? "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail(`Строка ${i + 1}: месяц в виде ГГГГ-ММ`);
    if (!allowedMonths.has(month)) fail(`Строка ${i + 1}: прогноз ставится на прошлый, текущий и три месяца вперёд`);
    const label = `${direction.label}, ${metricLabel(String(l.metric))}`;
    const budget = num(l?.budget, `${label}: бюджет`, true);
    const forecast = num(l?.forecast, `${label}: прогноз`, false)!;
    const reason = reasonDb(l?.reason ? String(l.reason) : null);
    if (!reason && budget !== null && budget !== 0 && Math.abs(forecast - budget) / Math.abs(budget) > 0.02) fail(`${label}: прогноз отличается от бюджета, назовите причину`);
    const comment = String(l?.comment ?? "").replace(/[—–]/g, "-").trim().slice(0, FORECAST_LIMITS.comment) || null;
    return { directionId: direction.id, metric, month, budget, forecast, reason, comment, label };
  });
  const keys = new Set(clean.map((c) => `${c.directionId}|${c.metric}|${c.month}`));
  if (keys.size !== clean.length) fail("Одна и та же линия, метрика и месяц встречаются дважды");
  await prisma.$transaction(async (tx) => {
    const before = await tx.forecast.findMany({ where: { authorId: actor.personId, weekId: weekRow.id }, include });
    const beforeByKey = new Map(before.map((b) => [`${b.directionId}|${b.metric}|${b.month}`, b]));
    for (const c of clean) {
      await tx.forecast.upsert({
        where: { weekId_authorId_directionId_metric_month: { weekId: weekRow.id, authorId: actor.personId, directionId: c.directionId, metric: c.metric, month: c.month } },
        create: { weekId: weekRow.id, authorId: actor.personId, teamId, directionId: c.directionId, metric: c.metric, month: c.month, budget: c.budget, forecast: c.forecast, reason: c.reason, comment: c.comment },
        update: { budget: c.budget, forecast: c.forecast, reason: c.reason, comment: c.comment },
      });
    }
    const gone = before.filter((b) => !keys.has(`${b.directionId}|${b.metric}|${b.month}`));
    if (gone.length) await tx.forecast.deleteMany({ where: { id: { in: gone.map((b) => b.id) } } });
    const text = (list: { label?: string; direction?: { label: string }; metric: string; month: string; forecast: number; budget: number | null }[]) =>
      list.map((l) => `${"label" in l && l.label ? l.label : `${(l as Row).direction.label}, ${metricLabel(metricCode(l.metric))}`} ${l.month}: ${formatForecast(l.forecast, FORECAST_METRICS.find((m) => m.db === l.metric)?.unit ?? "mln")}${l.budget !== null ? ` при бюджете ${formatForecast(l.budget, FORECAST_METRICS.find((m) => m.db === l.metric)?.unit ?? "mln")}` : ""}`).join("; ") || "пусто";
    const changed = clean.some((c) => {
      const b = beforeByKey.get(`${c.directionId}|${c.metric}|${c.month}`);
      return !b || b.forecast !== c.forecast || b.budget !== c.budget || b.reason !== c.reason || b.comment !== c.comment;
    }) || gone.length > 0;
    if (changed) await audit(tx, actor, "weekly.forecast", "weekly", `${key}/${actor.slug}`, `Прогноз месяца, неделя ${weekNumberOf(key)}`, text(before), text(clean));
  });
  return myForecast(actor, key);
}

/** Прогнозы недели по людям аудитории: для отчёта CEO, встречи и страницы прогноза */
export async function forecastSummary(key: WeekKey, audience: Pick<WeekAudience, "personIds" | "authorIds">): Promise<ForecastSummary> {
  const authors = audience.authorIds ?? audience.personIds;
  const week = await prisma.week.findUnique({ where: { start: new Date(`${key}T00:00:00Z`) }, select: { id: true } });
  const rows = week && authors.length ? await prisma.forecast.findMany({ where: { weekId: week.id, authorId: { in: authors } }, include, orderBy: [{ direction: { sortOrder: "asc" } }, { metric: "asc" }, { month: "asc" }] }) : [];
  const lines = await withPrevious(rows, key);
  const groups: ForecastSummary["groups"] = [];
  for (const l of lines) {
    const g = groups.find((x) => x.direction === l.direction) ?? (groups.push({ direction: l.direction, label: l.directionLabel, lines: [] }), groups[groups.length - 1]!);
    g.lines.push(l);
  }
  return { week: key, lines, groups };
}

/** История прогноза по неделям: строка на линию, колонки недели. Бюджет берётся из последней строки */
export async function forecastHistory(audience: Pick<WeekAudience, "personIds" | "authorIds">, upTo: WeekKey, weeks = FORECAST_LIMITS.historyWeeks): Promise<ForecastHistory> {
  const authors = audience.authorIds ?? audience.personIds;
  const keys: WeekKey[] = Array.from({ length: weeks }, (_, i) => shiftWeek(upTo, -(weeks - 1 - i)));
  if (!authors.length) return { weeks: keys.map((k) => ({ key: k, number: weekNumberOf(k) })), rows: [] };
  const rows = await prisma.forecast.findMany({
    where: { authorId: { in: authors }, week: { start: { gte: new Date(`${keys[0]}T00:00:00Z`), lte: new Date(`${upTo}T00:00:00Z`) } } },
    include,
    orderBy: [{ direction: { sortOrder: "asc" } }, { metric: "asc" }, { month: "asc" }, { week: { start: "asc" } }],
  });
  const out = new Map<string, ForecastHistory["rows"][number]>();
  for (const r of rows) {
    const k = lineKey(r);
    const week = isoFromDbDate(r.week.start);
    const idx = keys.indexOf(week);
    if (idx < 0) continue;
    const metric = metricCode(r.metric);
    const row = out.get(k) ?? { author: r.author.slug as PersonSlug, direction: r.direction.code, directionLabel: r.direction.label, metric, metricLabel: metricLabel(metric), unit: FORECAST_METRICS.find((m) => m.code === metric)?.unit ?? "mln", month: r.month, budget: null, values: keys.map(() => null) };
    row.values[idx] = r.forecast;
    row.budget = r.budget ?? row.budget;
    out.set(k, row);
  }
  return { weeks: keys.map((k) => ({ key: k, number: weekNumberOf(k) })), rows: [...out.values()] };
}
