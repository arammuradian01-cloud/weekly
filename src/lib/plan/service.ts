// Прогноз месяца по драйверам (этап 32). Версии месяца, бюджет и LBE, ресурс берёт из LRF «INSURANCE & INVEST: 5Y_LRF
// (CURRENT)» служебным аккаунтом только на чтение. LBE заполняют за пять дней до начала месяца, после этого команда
// продукта корректирует драйверы (трафик, конверсию, выручку на продажу, расходы) с причиной и обоснованием, а ресурс
// пересчитывает выручку и маржу и показывает, как прогноз отличается от LBE и от бюджета. LRF не меняется

import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { ForecastReason, PlanVersion } from "@/generated/prisma/enums";
import { getSetting, setSetting } from "@/lib/settings";
import { canEditDictionaries, canManagePeople } from "@/lib/admin/service";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { GoogleSheets, GoogleSheetsError, serviceAccountFromEnv } from "@/lib/sheet/google";
import { FakeSheets } from "@/lib/sheet/fake";
import { PROD_SHEET_ID, colLetter, q, type Grid as SheetGrid, type SheetsClient } from "@/lib/sheet/client";
import { serviceEmail } from "@/lib/sheet/runner";
import { moscowToday } from "@/lib/tasks/dates";
import { FORECAST_REASONS, addMonths, monthLabel, type ForecastReasonCode } from "@/lib/forecast/codes";
import { lrfImitation } from "./imitation";
import { readLrf, type Grid, type Values } from "./lrf";
import { derive, rowsOf } from "./model";
import { GROUPS, PRODUCTS, SHEETS, UNITS, metricLabel, productOf, type MetricKey, type PlanUnit, type ProductSpec } from "./spec";
import { formatPlan, driverBounds } from "./format";
import { summarize, type Drivers, type PlanInput } from "./summary";
import { notify } from "@/lib/inbox/notify";
import { factsOf, lastPullAt, reviewsOf, waitingReview } from "./status";
import type { AdjustInput, AdjustmentView, MonthPlanView, PlanPerson, PlanSource, PullPreview } from "./types";

export type { AdjustInput, AdjustmentView, MonthPlanView, PullPreview } from "./types";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

/**
 * Боевой LRF «INSURANCE & INVEST: 5Y_LRF (CURRENT)». Доступ служебному аккаунту на него не дают, поэтому ресурс читает
 * таблицу-связку: в ней четыре листа с формулой IMPORTRANGE на листы боевого LRF. Владелец может указать другой источник
 */
export const LRF_SHEET_ID = "1NyXreA9PYUC-CTeUmIvh_w1L7kIggCxhjpo5-f5vK7k";
/** Таблица-связка «LRF для Weekly (только чтение, связь с LRF INSURANCE & INVEST)»: источник по умолчанию */
export const LRF_MIRROR_ID = "1KFYKwsRcxC98rHwxbAnV2s29IxQCicq4PVnB0AOEzsg";
export const PLAN_LIMITS = { comment: 300, commentMin: 3, owners: 12, history: 60, rows: 1500, cols: 1500 };

type Reader = Pick<SheetsClient, "getValues" | "sheets">;
type Conn = { reader: Reader; mode: "google" | "imitation"; sourceId: string };

const g = globalThis as unknown as { __planGoogle?: { id: string; email: string; client: GoogleSheets }; __planFake?: FakeSheets };
const imitationOn = () => process.env.SHEET_FAKE === "1";

/** Месяц по Москве: «2026-10» */
export const currentMonth = (now = new Date()) => moscowToday(now).slice(0, 7);
export const isMonth = (m: unknown): m is string => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

/** Имитация LRF для тестов и показа без ключа: текущий месяц (цифры как в имитации), следующий и прошлый */
export function imitationLrf(now = new Date()): FakeSheets {
  if (!g.__planFake) {
    const month = currentMonth(now);
    const fake = new FakeSheets();
    for (const [name, grid] of Object.entries(lrfImitation([month, addMonths(month, 1), addMonths(month, -1)]))) fake.addTab(name, grid as SheetGrid, { rows: 1000, cols: 60 });
    g.__planFake = fake;
  }
  return g.__planFake;
}

export async function planConnection(): Promise<Conn | null> {
  const id = await getSetting<string | null>("plan.sourceId", LRF_MIRROR_ID);
  if (!id) return null;
  if (imitationOn()) return { reader: imitationLrf(), mode: "imitation", sourceId: id };
  const account = serviceAccountFromEnv();
  if (!account) return null;
  if (!g.__planGoogle || g.__planGoogle.id !== id || g.__planGoogle.email !== account.client_email) {
    g.__planGoogle = { id, email: account.client_email, client: new GoogleSheets(id, account, fetch, "read") };
  }
  const client = g.__planGoogle.client;
  return { reader: { getValues: (range) => client.getValues(range), sheets: () => client.sheets() }, mode: "google", sourceId: id };
}

function errorText(error: unknown): string {
  if (error instanceof GoogleSheetsError) {
    if (error.status === 403) return "Нет доступа к LRF: дайте служебному аккаунту право «Читатель» на таблицу";
    if (error.status === 404) return "LRF не найден: проверьте ссылку на таблицу";
    return error.message.split(". ")[0]!;
  }
  if (error instanceof TaskRuleError) return error.message;
  return "Google не ответил. Попробуйте ещё раз через минуту";
}

/**
 * Листы LRF: только значения, без форматов. Сначала размер сетки каждого листа, потом диапазон не больше лимита, чтобы
 * огромный лист не читался целиком. Нет листа: undefined, его отметит разбор. Лист больше лимита: заметка владельцу
 */
async function readSheets(conn: Conn): Promise<{ sheets: Record<string, Grid | undefined>; notes: string[] }> {
  const infos = await conn.reader.sheets();
  const out: Record<string, Grid | undefined> = {};
  const notes: string[] = [];
  await Promise.all(
    SHEETS.map(async (name) => {
      const info = infos.find((i) => i.title.toLowerCase() === name.toLowerCase());
      if (!info) {
        out[name] = undefined;
        return;
      }
      const rows = Math.min(info.rowCount ?? PLAN_LIMITS.rows, PLAN_LIMITS.rows);
      const cols = Math.min(info.columnCount ?? PLAN_LIMITS.cols, PLAN_LIMITS.cols);
      if ((info.rowCount ?? 0) > PLAN_LIMITS.rows || (info.columnCount ?? 0) > PLAN_LIMITS.cols) notes.push(`Лист «${name}» больше ${PLAN_LIMITS.rows} строк или колонок: читаются первые`);
      if (rows < 1 || cols < 1) {
        out[name] = [];
        return;
      }
      const grid = await conn.reader.getValues(`${q(info.title)}!A1:${colLetter(cols)}${rows}`);
      out[name] = grid.slice(0, PLAN_LIMITS.rows).map((row) => row.slice(0, PLAN_LIMITS.cols)) as Grid;
    }),
  );
  return { sheets: out, notes };
}

function requirePull(actor: Actor) {
  if (!canEditDictionaries(actor)) fail("Версии месяца из LRF загружают владелец и администраторы в режиме управления");
}

function monthOrFail(month: unknown): string {
  if (!isMonth(month)) fail("Неверный месяц");
  return month as string;
}

type Pulled = Record<string, { at: string; by: string }>;

async function readMonth(month: string) {
  const conn = await planConnection();
  if (!conn) fail(serviceEmail() ? "Источник LRF не задан" : "Ключ служебного аккаунта Google не задан на сервере");
  let sheets: Record<string, Grid | undefined>;
  let notes: string[];
  try {
    ({ sheets, notes } = await readSheets(conn!));
  } catch (error) {
    return fail(errorText(error));
  }
  // Связь IMPORTRANGE ещё не открыта или данные ещё грузятся: на листе одна ячейка с ошибкой или «Загрузка»
  const waiting = Object.entries(sheets).filter(([, grid]) => grid && grid.length <= 2 && /^(#REF!|#N\/A|#ERROR!|Загрузка|Loading)/i.test(String(grid[0]?.[0] ?? "").trim()));
  if (waiting.length) {
    return fail(`Лист «${waiting[0]![0]}» ещё не получил цифры из LRF. Откройте таблицу-связку, нажмите «Открыть доступ» у ячейки A1 и подождите минуту`);
  }
  const read = readLrf(sheets, month);
  const problems = [...read.problems];
  // Без любой строки продукта пересчёт врёт, поэтому пропуск строки не даёт загрузить: строку в LRF переименовали или
  // перенесли, и правило поиска нужно поправить
  for (const p of read.products) {
    if (p.problem) problems.push(p.problem);
    else if (p.missing.length) problems.push(`${p.label}: в LRF не найдены строки: ${p.missing.map((k) => metricLabel(productOf(p.code)!, k).toLowerCase()).join(", ")}`);
    else if (p.values.LBE.revenue == null) problems.push(`${p.label}: в LBE за ${monthLabel(month)} нет выручки`);
  }
  for (const gr of read.groups) {
    if (gr.problem) problems.push(gr.problem);
    else if (gr.missing.length) problems.push(`${gr.label}: в LRF не найдены строки итога группы`);
  }
  return { read, problems: [...new Set(problems)], notes };
}

/** Что будет загружено: выручка по версиям, пропущенные строки и несходящиеся цифры. Ничего не пишет */
export async function previewPull(actor: Actor, monthInput: string): Promise<PullPreview> {
  requirePull(actor);
  const month = monthOrFail(monthInput);
  const { read, problems, notes } = await readMonth(month);
  const lines = await prisma.planLine.findMany({ where: { month, version: "LBE" } });
  const beforeOf = (code: string) => lines.find((l) => l.product === code && l.metric === "revenue")?.value ?? null;
  const adjustments = await prisma.planAdjustment.findMany({ where: { month }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  // Корректировки хранят значение, а не сдвиг: если LBE драйвера поменялся, корректировка теперь значит другое. Показываем такие
  const seen = new Set<string>();
  const changed: PullPreview["changed"] = [];
  let active = 0;
  for (const a of adjustments) {
    const key = `${a.product}:${a.metric}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (a.value === null) continue;
    active += 1;
    const spec = productOf(a.product);
    const fresh = read.products.find((p) => p.code === a.product);
    if (!spec || !fresh) continue;
    const metric = a.metric as MetricKey;
    const was = derive(Object.fromEntries(lines.filter((l) => l.product === a.product).map((l) => [l.metric, l.value])) as Values)[metric] ?? null;
    const now = derive(fresh.values.LBE)[metric] ?? null;
    if (was === null || now === null || Math.abs(was - now) <= 1e-9 * Math.max(1, Math.abs(was))) continue;
    const unit = UNITS[metric];
    changed.push({ product: spec.label, metric: metricLabel(spec, metric), value: formatPlan(a.value, unit), lbeBefore: formatPlan(was, unit), lbeAfter: formatPlan(now, unit) });
  }
  return {
    month,
    monthLabel: monthLabel(month),
    problems,
    notes,
    changed,
    ready: problems.length === 0,
    products: read.products.map((p) => ({
      code: p.code,
      label: p.label,
      missing: p.missing.map((k) => metricLabel(productOf(p.code)!, k)),
      warnings: p.warnings,
      revenue: { lbe: p.values.LBE.revenue ?? null, budget: p.values.BUD.revenue ?? null, before: beforeOf(p.code) },
    })),
    adjustments: active,
  };
}

const VERSIONS: [string, PlanVersion][] = [
  ["LBE", "LBE"],
  ["BUD", "BUDGET"],
];

/** Загрузить бюджет и LBE месяца из LRF: строки месяца заменяются, корректировки команды остаются */
export async function applyPull(actor: Actor, monthInput: string): Promise<{ month: string; lines: number }> {
  requirePull(actor);
  const month = monthOrFail(monthInput);
  const { read, problems } = await readMonth(month);
  if (problems.length) fail(`Не загружено: ${problems[0]}`);
  const data: Prisma.PlanLineCreateManyInput[] = [];
  const now = new Date();
  for (const item of [...read.products, ...read.groups]) {
    for (const [from, version] of VERSIONS) {
      const values = item.values[from as "LBE" | "BUD"];
      for (const [metric, value] of Object.entries(values)) {
        data.push({ month, version, product: item.code, metric, value: value ?? null, pulledAt: now });
      }
    }
  }
  const revenue = (items: typeof read.products, v: "LBE" | "BUD") => items.reduce((s, p) => s + (p.values[v].revenue ?? 0), 0);
  const groupsRevenue = (v: "LBE" | "BUD") => read.groups.reduce((s, gr) => s + (gr.values[v].revenue ?? 0), 0);
  const total = (v: "LBE" | "BUD") => revenue(read.products.filter((p) => !productOf(p.code)?.group), v) + groupsRevenue(v);
  const owners = await ownersMap();
  const loaded = new Set(read.products.map((p) => p.code));
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`plan:${month}`}))`;
    const had = await tx.planLine.count({ where: { month } });
    await tx.planLine.deleteMany({ where: { month } });
    await tx.planLine.createMany({ data });
    // Снимок загрузки (этап 35): строки месяца заменяются, а снимок остаётся для сравнения версий и прогноза на дату
    await tx.planPull.create({ data: { month, at: now, byName: actor.fullName, lines: data.map((d) => ({ version: d.version, product: d.product, metric: d.metric, value: d.value ?? null })) } });
    // Событие в «Мне» командам продуктов: проверить прогноз после нового LBE (сам загрузивший события не получает)
    const bySlug = new Map<string, string[]>();
    for (const p of PRODUCTS) {
      if (!loaded.has(p.code)) continue;
      for (const slug of owners[p.code] ?? []) bySlug.set(slug, [...(bySlug.get(slug) ?? []), p.label]);
    }
    const people = bySlug.size ? await tx.person.findMany({ where: { slug: { in: [...bySlug.keys()] }, active: true }, select: { id: true, slug: true } }) : [];
    for (const person of people) {
      const labels = bySlug.get(person.slug)!;
      await notify(
        tx,
        {
          kind: "PLAN",
          recipients: [person.id],
          actor: { personId: actor.personId, fullName: actor.fullName },
          subject: `plan:${month}`,
          text: `Загружен LBE на ${monthLabel(month)}. Проверьте прогноз: ${labels.join(", ")}. Скорректируйте драйверы с причиной или отметьте «Прогноз проверен»`,
        },
        now,
      );
    }
    // Карта «когда загружен месяц» общая на все месяцы: две загрузки разных месяцев не должны потерять друг друга
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('plan.settings'))`;
    const pulled = await tx.setting.findUnique({ where: { key: "plan.pulled" } });
    const map = { ...((pulled?.value as Pulled | null) ?? {}), [month]: { at: now.toISOString(), by: actor.fullName } };
    await tx.setting.upsert({ where: { key: "plan.pulled" }, update: { value: map }, create: { key: "plan.pulled", value: map } });
    await tx.auditLog.create({
      data: {
        action: "plan.pull",
        actorId: actor.personId,
        actorName: actor.fullName,
        source: "APP",
        entity: "plan",
        entityId: month,
        field: `Бюджет и LBE, ${monthLabel(month)}`,
        before: had ? "загружено раньше" : "не загружено",
        after: `выручка по продуктам: LBE ${formatPlan(total("LBE"), "mln")} млн, бюджет ${formatPlan(total("BUD"), "mln")} млн`,
        ip: actor.ip ?? null,
        via: actor.via ?? null,
      },
    });
  });
  return { month, lines: data.length };
}

/** Кто корректирует продукт: владельцы из настройки или по умолчанию из справочника продуктов */
async function ownersMap(): Promise<Record<string, string[]>> {
  const saved = await getSetting<Record<string, string[]>>("plan.owners", {});
  const out: Record<string, string[]> = {};
  for (const p of PRODUCTS) out[p.code] = Array.isArray(saved?.[p.code]) ? saved[p.code]!.filter((s) => typeof s === "string") : p.owners;
  return out;
}

/**
 * Корректирует человек, которого видно: личный вход или режим владельца (пароль владельца знает только он). Пароль
 * администраторов общий, поэтому общий логин с режимом администратора не подходит: под ним можно выбрать чужой профиль
 */
const personal = (actor: Actor) => actor.role !== "OBSERVER" && (actor.via !== "TEAM" || actor.management === "OWNER");

function canAdjust(actor: Actor, owners: string[]): boolean {
  if (!personal(actor)) return false;
  return canEditDictionaries(actor) || owners.includes(actor.slug);
}

const reasonDb = (code: string): ForecastReason => (FORECAST_REASONS.find((r) => r.code === code)?.db as ForecastReason | undefined) ?? fail("Выберите причину корректировки");
const reasonCode = (db: string): ForecastReasonCode => FORECAST_REASONS.find((r) => r.db === db)?.code ?? "other";
const reasonLabelOf = (db: string) => FORECAST_REASONS.find((r) => r.db === db)?.label ?? "Другое";

type AdjRow = Prisma.PlanAdjustmentGetPayload<{ include: { author: { select: { slug: true; fullName: true } } } }>;

function adjustmentView(a: AdjRow): AdjustmentView {
  const spec = productOf(a.product);
  const metric = a.metric as MetricKey;
  return {
    id: a.id,
    product: a.product,
    productLabel: spec?.label ?? a.product,
    metric,
    metricLabel: spec ? metricLabel(spec, metric) : a.metric,
    unit: UNITS[metric] ?? "count",
    value: a.value,
    previous: a.previous,
    reason: reasonCode(a.reason),
    reasonLabel: reasonLabelOf(a.reason),
    comment: a.comment,
    author: { slug: a.author.slug, name: a.author.fullName },
    at: a.createdAt.toISOString(),
  };
}

/** Значения версии по продуктам и группам: product → metric → value */
function valuesBy(lines: { product: string; metric: string; value: number | null; version: PlanVersion }[], version: PlanVersion): Map<string, Values> {
  const out = new Map<string, Values>();
  for (const l of lines) {
    if (l.version !== version) continue;
    const v = out.get(l.product) ?? {};
    v[l.metric as MetricKey] = l.value;
    out.set(l.product, v);
  }
  return out;
}

/** Действующие корректировки: последняя по каждому драйверу, если у неё есть значение */
function driversOf(adjustments: AdjRow[]): { drivers: Map<string, Drivers>; last: Map<string, Partial<Record<MetricKey, AdjustmentView>>> } {
  const drivers = new Map<string, Drivers>();
  const last = new Map<string, Partial<Record<MetricKey, AdjustmentView>>>();
  // Новые сверху: первая встреченная по показателю и есть действующая
  for (const a of adjustments) {
    const l = last.get(a.product) ?? {};
    if (l[a.metric as MetricKey]) continue;
    l[a.metric as MetricKey] = adjustmentView(a);
    last.set(a.product, l);
    if (a.value !== null) drivers.set(a.product, { ...(drivers.get(a.product) ?? {}), [a.metric]: a.value });
  }
  return { drivers, last };
}

async function people(slugs: string[]): Promise<Map<string, PlanPerson>> {
  const rows = await prisma.person.findMany({ where: { slug: { in: [...new Set(slugs)] }, active: true }, select: { slug: true, fullName: true } });
  return new Map(rows.map((r) => [r.slug, { slug: r.slug, name: r.fullName }]));
}

/** Откуда и когда загружен месяц. Ссылку на таблицу и служебный аккаунт видят только те, кто загружает */
async function source(month: string, manager: boolean): Promise<PlanSource> {
  const [id, pulled] = await Promise.all([getSetting<string | null>("plan.sourceId", LRF_MIRROR_ID), getSetting<Pulled>("plan.pulled", {})]);
  const mode: PlanSource["mode"] = !id ? "off" : imitationOn() ? "imitation" : serviceAccountFromEnv() ? "google" : "off";
  return { sourceId: manager ? (id ?? "") : "", mode, serviceEmail: manager ? serviceEmail() : null, pulledAt: pulled?.[month]?.at ?? null, pulledBy: pulled?.[month]?.by ?? null };
}

/** Прогноз месяца для экрана: версии, корректировки, владельцы продуктов и история. month: из адреса страницы */
export async function monthPlan(actor: Actor, monthInput?: string | null, now = new Date()): Promise<MonthPlanView> {
  const monthRows = await prisma.planLine.findMany({ distinct: ["month"], select: { month: true }, orderBy: { month: "desc" } });
  const months = monthRows.map((r) => r.month);
  const current = currentMonth(now);
  const month = isMonth(monthInput) ? monthInput : months.includes(current) ? current : (months[0] ?? current);
  // Прошлый месяц закрыт: прогноз виден, но не меняется
  const closed = month < current;
  const [lines, adjustments, owners, src, since, facts] = await Promise.all([
    prisma.planLine.findMany({ where: { month } }),
    prisma.planAdjustment.findMany({ where: { month }, include: { author: { select: { slug: true, fullName: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    ownersMap(),
    source(month, canEditDictionaries(actor)),
    lastPullAt(month),
    factsOf(month),
  ]);
  const reviews = await reviewsOf(month, since, adjustments);
  const lbe = valuesBy(lines, "LBE");
  const budget = valuesBy(lines, "BUDGET");
  const { drivers, last } = driversOf(adjustments);
  const names = await people(Object.values(owners).flat());
  const products = PRODUCTS.filter((p) => lbe.has(p.code)).map((p) => ({
    code: p.code,
    lbe: lbe.get(p.code)!,
    budget: budget.get(p.code) ?? {},
    drivers: drivers.get(p.code) ?? {},
    last: last.get(p.code) ?? {},
    owners: (owners[p.code] ?? []).map((s) => names.get(s)).filter((x): x is PlanPerson => !!x),
    canAdjust: !closed && canAdjust(actor, owners[p.code] ?? []),
    review: since ? (reviews.get(p.code) ?? waitingReview(since)) : null,
    facts: facts.get(p.code) ?? null,
  }));
  const groups = GROUPS.filter((gr) => lbe.has(gr.code)).map((gr) => ({ code: gr.code, lbe: lbe.get(gr.code)!, budget: budget.get(gr.code) ?? {} }));
  return {
    month,
    monthLabel: monthLabel(month),
    months: [...new Set([...months, month])].sort().reverse(),
    empty: products.length === 0,
    products,
    groups,
    history: adjustments.slice(0, PLAN_LIMITS.history).map(adjustmentView),
    canPull: canEditDictionaries(actor),
    canOwners: canEditDictionaries(actor),
    canSource: canManagePeople(actor),
    canAdjustAny: products.some((p) => p.canAdjust),
    closed,
    adjustHint: closed ? `${monthLabel(month).replace(/^./, (c) => c.toUpperCase())} закрыт: прогноз прошлого месяца не меняется.` : actor.role === "OBSERVER" ? "Наблюдатель видит прогноз, но не корректирует его." : actor.via === "TEAM" && actor.management !== "OWNER" ? "Вы вошли под общим логином. Корректировать прогноз можно при личном входе: так видно, кто и почему меняет цифру." : null,
    source: src,
    canFacts: canEditDictionaries(actor),
    canExport: canExportPlan(actor, owners),
  };
}

/** Выгрузку прогноза в Excel берут управление и команды продуктов при личном входе: файл уходит из ресурса */
export function canExportPlan(actor: Actor, owners: Record<string, string[]>): boolean {
  if (!personal(actor)) return false;
  return canEditDictionaries(actor) || Object.values(owners).some((list) => list.includes(actor.slug));
}

export { ownersMap, personal as personalPlanActor, canAdjust as canAdjustPlan, monthOrFail as planMonthOrFail };

/** Сводка месяца для отчётов: те же числа, что на экране */
export function planSummary(view: Pick<MonthPlanView, "products" | "groups">) {
  const input: PlanInput = { products: view.products.map((p) => ({ code: p.code, lbe: p.lbe, budget: p.budget, drivers: p.drivers })), groups: view.groups };
  return summarize(input);
}

const near = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)));

/** Совпадают ли значения с точностью поля ввода: штуки до единицы, доли до тысячной процента, рубли до копейки */
function sameInput(unit: PlanUnit, a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  const step = unit === "count" ? 0.5 : unit === "pct" ? 0.000005 : unit === "rub" ? 0.005 : 0.00005;
  return Math.abs(a - b) < step || near(a, b);
}

/** Корректировка драйвера: новое значение вместо LBE (или вернуть как в LBE), причина и обоснование */
export async function adjust(actor: Actor, input: AdjustInput): Promise<MonthPlanView> {
  const month = monthOrFail(input?.month);
  const spec: ProductSpec = productOf(String(input?.product ?? "")) ?? fail("Нет такого продукта");
  const metric = String(input?.metric ?? "") as MetricKey;
  const driver = rowsOf(spec).find((r) => r.key === metric && r.kind === "driver");
  if (!driver) fail("Этот показатель пересчитывается сам: меняйте драйверы");
  const owners = (await ownersMap())[spec.code] ?? [];
  if (!personal(actor)) fail(actor.role === "OBSERVER" ? "Наблюдатель прогноз не корректирует" : "Прогноз корректируют при личном входе: так видно, кто и почему меняет цифру");
  if (month < currentMonth()) fail(`${monthLabel(month)} закрыт: прогноз прошлого месяца не меняется`);
  if (!canAdjust(actor, owners)) fail(`Прогноз продукта «${spec.label}» корректирует его команда`);
  const reason = reasonDb(String(input?.reason ?? ""));
  const comment = String(input?.comment ?? "").replace(/\s+/g, " ").trim();
  // Длина в символах, как считает база: эмодзи один символ
  const length = [...comment].length;
  if (length < PLAN_LIMITS.commentMin) fail("Напишите, почему меняется прогноз: одной фразой");
  if (length > PLAN_LIMITS.comment) fail(`Обоснование не длиннее ${PLAN_LIMITS.comment} знаков`);
  const raw = input?.value;
  if (raw !== null && (typeof raw !== "number" || !Number.isFinite(raw))) fail("Укажите значение числом");
  const seen = typeof input?.seen === "number" && Number.isFinite(input.seen) ? input.seen : null;

  await prisma.$transaction(async (tx) => {
    // Загрузка версий месяца ждёт, пока идут корректировки, и наоборот; корректировки одного продукта идут по очереди
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`plan:${month}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`plan:${month}:${spec.code}`}))`;
    const lines = await tx.planLine.findMany({ where: { month, product: spec.code, version: "LBE" } });
    if (!lines.length) fail(`Версии ${monthLabel(month)} ещё не загружены из LRF`);
    const lbe = derive(Object.fromEntries(lines.map((l) => [l.metric, l.value])) as Values);
    const base = lbe[metric] ?? null;
    const latest = await tx.planAdjustment.findFirst({ where: { month, product: spec.code, metric }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    // Без LBE драйвера корректировать не от чего, но снять старую корректировку можно: после повторной загрузки строка
    // могла пропасть
    if (base === null && !(raw === null && latest?.value != null)) fail("В LBE нет этого показателя: корректировать не от чего");
    const effective = latest?.value ?? base;
    if (!near(seen, effective)) fail("Пока вы правили, прогноз уже поменяли. Обновите страницу и проверьте цифру");
    const unit = UNITS[metric];
    let value = raw as number | null;
    if (value !== null) {
      const { min, max } = driverBounds(unit, base);
      if (value < min || value > max) fail(`Значение вне разумных границ: от ${formatPlan(min, unit)} до ${formatPlan(max, unit)}. Проверьте единицы${unit === "pct" ? ": конверсия вводится в процентах" : ""}`);
      // Значение как в LBE с точностью ввода (1 547 218 при LBE 1 547 218,14): это возврат к LBE
      if (sameInput(unit, value, base)) value = null;
    }
    if (value === null && (latest?.value ?? null) === null) fail("Показатель и так как в LBE");
    if (value !== null && sameInput(unit, value, effective)) fail("Значение не изменилось");
    await tx.planAdjustment.create({ data: { month, product: spec.code, metric, value, previous: effective, reason, comment, authorId: actor.personId } });
    await tx.auditLog.create({
      data: {
        action: "plan.adjust",
        actorId: actor.personId,
        actorName: actor.fullName,
        source: "APP",
        entity: "plan",
        entityId: `${month}:${spec.code}`,
        field: `${spec.label}, ${metricLabel(spec, metric)}, ${monthLabel(month)}`,
        before: formatPlan(effective, unit),
        after: `${value === null ? `как в LBE, ${formatPlan(base, unit)}` : formatPlan(value, unit)}. ${reasonLabelOf(reason)}: ${comment}`,
        ip: actor.ip ?? null,
        via: actor.via ?? null,
      },
    });
  });
  return monthPlan(actor, month);
}

/** Кто корректирует прогноз продукта: владелец и администраторы в режиме управления */
export async function setOwners(actor: Actor, productCode: string, slugs: string[]): Promise<MonthPlanView["products"][number]["owners"]> {
  if (!canEditDictionaries(actor)) fail("Команду продукта меняют владелец и администраторы в режиме управления");
  const spec = productOf(String(productCode ?? "")) ?? fail("Нет такого продукта");
  if (!Array.isArray(slugs)) fail("Список людей не разобран");
  const clean = [...new Set(slugs.map((s) => String(s ?? "").trim()).filter(Boolean))];
  if (clean.length > PLAN_LIMITS.owners) fail(`Не больше ${PLAN_LIMITS.owners} человек на продукт`);
  const found = await people(clean);
  const unknown = clean.filter((s) => !found.has(s));
  if (unknown.length) fail("Нет такого сотрудника или он неактивен");
  await prisma.$transaction(async (tx) => {
    // Карта владельцев общая на все продукты: правки двух продуктов одновременно не теряют друг друга
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('plan.settings'))`;
    const saved = (await tx.setting.findUnique({ where: { key: "plan.owners" } }))?.value as Record<string, string[]> | null;
    const map: Record<string, string[]> = {};
    for (const p of PRODUCTS) map[p.code] = Array.isArray(saved?.[p.code]) ? saved![p.code]!.filter((x) => typeof x === "string") : p.owners;
    const before = map[spec.code] ?? [];
    const beforeNames = await people(before);
    map[spec.code] = clean;
    await tx.setting.upsert({ where: { key: "plan.owners" }, update: { value: map }, create: { key: "plan.owners", value: map } });
    await tx.auditLog.create({
      data: {
        action: "plan.owners",
        actorId: actor.personId,
        actorName: actor.fullName,
        source: "APP",
        entity: "plan",
        entityId: spec.code,
        field: `Кто корректирует прогноз: ${spec.label}`,
        before: before.map((s) => beforeNames.get(s)?.name ?? s).join(", ") || "никто",
        after: clean.map((s) => found.get(s)!.name).join(", ") || "никто",
        ip: actor.ip ?? null,
        via: actor.via ?? null,
      },
    });
  });
  return clean.map((s) => found.get(s)!);
}

/** ID таблицы из ссылки или как есть */
export function parsePlanSource(input: string): string {
  const raw = String(input ?? "").trim();
  const id = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(raw)?.[1] ?? raw;
  if (!/^[a-zA-Z0-9_-]{25,100}$/.test(id)) fail("Не похоже на ссылку на Google-таблицу. Скопируйте адрес LRF из браузера целиком");
  return id;
}

/** Другой LRF как источник версий: только владелец. Рабочий Bord источником быть не может */
export async function setPlanSource(actor: Actor, input: string): Promise<string> {
  if (!canManagePeople(actor)) fail("Источник прогноза меняет владелец в режиме управления");
  const id = parsePlanSource(input);
  if (id === PROD_SHEET_ID) fail("Это рабочий Bord, а не LRF");
  const before = await getSetting<string | null>("plan.sourceId", LRF_MIRROR_ID);
  if (before === id) return id;
  await setSetting("plan.sourceId", id);
  await prisma.auditLog.create({
    data: { action: "plan.source", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "plan", entityId: "source", field: "LRF для прогноза месяца", before: before ?? "не задан", after: id, ip: actor.ip ?? null, via: actor.via ?? null },
  });
  return id;
}

/** Люди для выбора команды продукта: активные, по алфавиту */
export async function planPeople(actor: Actor): Promise<PlanPerson[]> {
  if (!canEditDictionaries(actor)) fail("Команду продукта меняют владелец и администраторы в режиме управления");
  const rows = await prisma.person.findMany({ where: { active: true, role: { not: "OBSERVER" } }, select: { slug: true, fullName: true }, orderBy: { fullName: "asc" } });
  return rows.map((r) => ({ slug: r.slug, name: r.fullName }));
}
