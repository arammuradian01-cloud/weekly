// Хаб данных «Единая воронка: данные» (этап 58): загрузка снимков «Все СК» и плана ОСАГО по СК, ранрейт по СК для
// карточки ОСАГО. Хаб читается служебным аккаунтом только на чтение, как таблица-связка LRF. Боевые файлы и хаб ресурс не
// меняет

import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { getSetting, setSetting } from "@/lib/settings";
import { canEditDictionaries, canManagePeople } from "@/lib/admin/service";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { GoogleSheets, GoogleSheetsError, serviceAccountFromEnv } from "@/lib/sheet/google";
import { FakeSheets } from "@/lib/sheet/fake";
import { PROD_SHEET_ID, colLetter, q, type Grid as SheetGrid, type SheetsClient } from "@/lib/sheet/client";
import { serviceEmail } from "@/lib/sheet/runner";
import { moscowToday } from "@/lib/tasks/dates";
import { addMonths } from "@/lib/forecast/codes";
import { PRODUCTS } from "./spec";
import { PARTNER_DEFAULT_OWNERS, PARTNER_OWNER_CODE } from "./partners";
import { HUB_LIMITS, HUB_SHEETS, SK_METRICS, SK_SENSITIVE, SK_TOTAL, daysIn, parseHubSource, readSkPlan, readVseSk, runRate, type SkMetric, type SkMonthRow } from "./hub";
import { hubImitation } from "./hub-imitation";
import type { Grid } from "./lrf";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

type Reader = Pick<SheetsClient, "getValues" | "sheets">;
type Conn = { reader: Reader; mode: "google" | "imitation"; sourceId: string };
const g = globalThis as unknown as { __hubGoogle?: { id: string; email: string; client: GoogleSheets }; __hubFake?: { day: string; fake: FakeSheets } };
const imitationOn = () => process.env.SHEET_FAKE === "1";

/** Имитация хаба: снимок на сегодня по Москве, прошлый месяц целиком */
export function imitationHub(now = new Date()): FakeSheets {
  const day = moscowToday(now);
  if (!g.__hubFake || g.__hubFake.day !== day) {
    const fake = new FakeSheets();
    for (const [name, grid] of Object.entries(hubImitation(day, addMonths(day.slice(0, 7), -1)))) fake.addTab(name, grid as SheetGrid, { rows: 1000, cols: 60 });
    g.__hubFake = { day, fake };
  }
  return g.__hubFake.fake;
}

/** Хаб задаёт владелец ссылкой. Без ссылки (и не в имитации) загрузки нет */
export async function hubConnection(now = new Date()): Promise<Conn | null> {
  const id = await getSetting<string | null>("plan.hubId", null);
  if (imitationOn()) return { reader: imitationHub(now), mode: "imitation", sourceId: id ?? "imitation" };
  if (!id) return null;
  const account = serviceAccountFromEnv();
  if (!account) return null;
  if (!g.__hubGoogle || g.__hubGoogle.id !== id || g.__hubGoogle.email !== account.client_email) {
    g.__hubGoogle = { id, email: account.client_email, client: new GoogleSheets(id, account, fetch, "read") };
  }
  const client = g.__hubGoogle.client;
  return { reader: { getValues: (range) => client.getValues(range), sheets: () => client.sheets() }, mode: "google", sourceId: id };
}

function errorText(error: unknown): string {
  if (error instanceof GoogleSheetsError) {
    if (error.status === 403) return "Нет доступа к хабу: дайте служебному аккаунту право «Читатель» на таблицу «Единая воронка: данные»";
    if (error.status === 404) return "Хаб не найден: проверьте ссылку на таблицу";
    return error.message.split(". ")[0]!;
  }
  if (error instanceof TaskRuleError) return error.message;
  return "Google не ответил. Попробуйте ещё раз через минуту";
}

const requirePull = (actor: Actor) => {
  if (!canEditDictionaries(actor)) fail("Хаб загружают владелец и администраторы в режиме управления");
};

async function readHub(conn: Conn): Promise<{ vseSk: Grid | undefined; skPlan: Grid | undefined }> {
  const infos = await conn.reader.sheets();
  const read = async (name: string, rows: number): Promise<Grid | undefined> => {
    const info = infos.find((i) => i.title.toLowerCase() === name.toLowerCase());
    if (!info) return undefined;
    const r = Math.min(info.rowCount ?? rows, rows);
    const c = Math.min(info.columnCount ?? HUB_LIMITS.cols, HUB_LIMITS.cols);
    if (r < 1 || c < 1) return [];
    return (await conn.reader.getValues(`${q(info.title)}!A1:${colLetter(c)}${r}`)) as Grid;
  };
  const [vseSk, skPlan] = await Promise.all([read(HUB_SHEETS.vseSk, HUB_LIMITS.vseSkRows), read(HUB_SHEETS.skPlan, HUB_LIMITS.skPlanRows)]);
  return { vseSk, skPlan };
}

const pending = (grid: Grid | undefined) => !!grid && grid.length <= 2 && /^(#REF!|#N\/A|#ERROR!|Загрузка|Loading)/i.test(String(grid[0]?.[0] ?? "").trim());

export type HubPreview = {
  day: string;
  problems: string[];
  warnings: string[];
  ready: boolean;
  /** Что прочитано из «Все СК»: месяцы, число СК, полисы текущего месяца нарастающим итогом */
  vseSk: { months: string[]; companies: number; policiesMtd: number | null } | null;
  /** Что прочитано из плана по СК: периоды, число СК, полисы ИТОГО за текущий месяц */
  skPlan: { periods: string[]; companies: number; planUnits: number | null } | null;
  /** Снимок на этот день уже есть: загрузка его заменит */
  replaces: boolean;
};

async function readAll(now: Date) {
  const conn = await hubConnection(now);
  if (!conn) fail(serviceEmail() ? "Хаб данных не задан: вставьте ссылку на таблицу «Единая воронка: данные»" : "Ключ служебного аккаунта Google не задан на сервере");
  let grids: { vseSk: Grid | undefined; skPlan: Grid | undefined };
  try {
    grids = await readHub(conn!);
  } catch (error) {
    return fail(errorText(error));
  }
  const problems: string[] = [];
  for (const [name, grid] of [[HUB_SHEETS.vseSk, grids.vseSk], [HUB_SHEETS.skPlan, grids.skPlan]] as const) {
    if (pending(grid)) problems.push(`Лист «${name}» ещё не получил цифры: откройте хаб, нажмите «Открыть доступ» у ячейки A1 и подождите минуту`);
  }
  const vse = readVseSk(grids.vseSk);
  const plan = readSkPlan(grids.skPlan);
  if (vse.problem) problems.push(vse.problem);
  if (plan.problem) problems.push(plan.problem);
  return { conn: conn!, vse, plan, problems: [...new Set(problems)] };
}

/** Что загрузится из хаба: ничего не пишет */
export async function previewHub(actor: Actor, now = new Date()): Promise<HubPreview> {
  requirePull(actor);
  const day = moscowToday(now);
  const month = day.slice(0, 7);
  const { vse, plan, problems } = await readAll(now);
  const warnings: string[] = [];
  const months = [...new Set(vse.rows.map((r) => r.month))].sort();
  const current = vse.rows.filter((r) => r.month === month);
  const policiesMtd = current.length ? current.reduce((s, r) => s + r.policies, 0) : null;
  if (vse.rows.length && !current.length) warnings.push(`В «Все СК» нет строк за ${month}: источник ещё не обновлён, снимок на ${day} не будет сделан`);
  const periods = [...new Set(plan.rows.map((r) => r.period))].sort();
  const total = plan.rows.find((r) => r.period === month && r.sk === SK_TOTAL && r.metric === "pol");
  const skSum = plan.rows.filter((r) => r.period === month && r.sk !== SK_TOTAL && r.metric === "pol").reduce((s, r) => s + (r.value ?? 0), 0);
  if (total?.value && skSum && Math.abs(skSum - total.value) > 0.005 * total.value) warnings.push(`План по СК за ${month}: сумма СК ${Math.round(skSum).toLocaleString("ru-RU")} не сходится с итогом ${Math.round(total.value).toLocaleString("ru-RU")}`);
  const replaces = current.length ? (await prisma.planSkSnapshot.count({ where: { day: new Date(`${day}T00:00:00Z`), month } })) > 0 : false;
  return {
    day,
    problems,
    warnings,
    ready: problems.length === 0,
    vseSk: vse.rows.length ? { months, companies: new Set(current.map((r) => r.sk)).size, policiesMtd } : null,
    skPlan: plan.rows.length ? { periods, companies: new Set(plan.rows.map((r) => r.sk)).size - (plan.rows.some((r) => r.sk === SK_TOTAL) ? 1 : 0), planUnits: total?.value ?? null } : null,
    replaces,
  };
}

/** Загрузить снимок «Все СК» на сегодня и строки плана по СК. Снимок дня заменяется, строки плана заменяются целиком */
export async function applyHub(actor: Actor, now = new Date()): Promise<{ day: string; snapshots: number; lines: number }> {
  requirePull(actor);
  const day = moscowToday(now);
  const { vse, plan, problems } = await readAll(now);
  if (problems.length) fail(`Не загружено: ${problems[0]}`);
  const dayDate = new Date(`${day}T00:00:00Z`);
  // Снимок всех месяцев листа: прошлые месяцы закрыты и не меняются, но снимок на день держит их для сверки
  const snapshotRows = vse.rows.map((r: SkMonthRow) => ({ day: dayDate, month: r.month, sk: r.sk, pool: r.pool, upsale: r.upsale, policies: r.policies, premium: r.premium, revenue: r.revenue }));
  const lineRows = plan.rows.map((r) => ({ period: r.period, sk: r.sk, metric: r.metric, value: r.value }));
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('plan.hub'))`;
    await tx.planSkSnapshot.deleteMany({ where: { day: dayDate } });
    if (snapshotRows.length) await tx.planSkSnapshot.createMany({ data: snapshotRows });
    await tx.planSkLine.deleteMany();
    if (lineRows.length) await tx.planSkLine.createMany({ data: lineRows });
    await tx.auditLog.create({
      data: { action: "plan.hub", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "plan", entityId: day, field: "Загрузка из хаба", before: Prisma.JsonNull, after: `снимок ${day}: ${snapshotRows.length} строк, план по СК: ${lineRows.length} строк`, ip: actor.ip ?? null, via: actor.via ?? null },
    });
  });
  await setSetting("plan.hubPulled", { at: now.toISOString(), by: actor.fullName, day });
  return { day, snapshots: snapshotRows.length, lines: lineRows.length };
}

/** Хаб задаёт владелец ссылкой: id таблицы «Единая воронка: данные» */
export async function setHubSource(actor: Actor, input: string): Promise<string> {
  if (!canManagePeople(actor)) fail("Хаб данных задаёт владелец в режиме управления");
  const id = parseHubSource(input) ?? fail("Не похоже на ссылку на Google-таблицу. Скопируйте адрес хаба из браузера целиком");
  if (id === PROD_SHEET_ID) fail("Это рабочий Bord, а не хаб данных");
  const before = await getSetting<string | null>("plan.hubId", null);
  if (before === id) return id;
  await setSetting("plan.hubId", id);
  await prisma.auditLog.create({
    data: { action: "plan.hubSource", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "plan", entityId: "hub", field: "Хаб данных для прогноза", before: before ?? "не задан", after: id, ip: actor.ip ?? null, via: actor.via ?? null },
  });
  return id;
}

export type SkRow = {
  sk: string;
  /** План месяца из модели: полисы */
  plan: number | null;
  /** Факт с начала месяца по последнему снимку */
  mtd: number | null;
  /** Доля пула в факте с начала месяца */
  poolShare: number | null;
  forecast: number | null;
  linear: number | null;
  profile: number | null;
  unstable: boolean;
  /** Прогноз к плану: доля */
  vsPlan: number | null;
  /** Выручка с начала месяца, млн; только для тех, кому видны чувствительные показатели */
  revenueMtd: number | null;
  /** КВ плана месяца, доля; только для тех, кому видны чувствительные показатели */
  kvPlan: number | null;
};

export type SkView = {
  month: string;
  /** Последний день снимка в месяце: null, если снимков нет */
  day: string | null;
  elapsed: number;
  days: number;
  rows: SkRow[];
  total: SkRow;
  /** LBE полисов ОСАГО на месяц из версий месяца: сверка итога ранрейта */
  lbeUnits: number | null;
  /** Чувствительные показатели (выручка, КВ) показаны этому человеку */
  sensitive: boolean;
  /** Снимок старше вчерашнего дня по Москве */
  stale: boolean;
  /** Дневных снимков меньше, чем нужно профилю дней недели */
  profileDays: number;
  source: { sourceId: string; mode: "google" | "imitation" | "off"; pulledAt: string | null; pulledBy: string | null; serviceEmail: string | null };
  canPull: boolean;
  canSource: boolean;
};

/** Кому видны выручка и КВ по СК (решение 21.10): управление, команда ОСАГО и команда партнёрского канала */
export async function seesSensitive(actor: Actor): Promise<boolean> {
  if (canEditDictionaries(actor)) return true;
  if (actor.role === "OBSERVER") return false;
  const owners = await getSetting<Record<string, string[]>>("plan.owners", {});
  const of = (code: string, fallback: string[]) => (Array.isArray(owners?.[code]) ? owners[code]! : fallback);
  const osago = of("osago", PRODUCTS.find((p) => p.code === "osago")?.owners ?? []);
  const partners = of(PARTNER_OWNER_CODE, PARTNER_DEFAULT_OWNERS);
  return osago.includes(actor.slug) || partners.includes(actor.slug);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Откуда читается хаб: для панели загрузки, даже пока загрузок не было */
export async function hubSource(actor: Actor): Promise<SkView["source"]> {
  const [pulled, hubId] = await Promise.all([getSetting<{ at: string; by: string; day: string } | null>("plan.hubPulled", null), getSetting<string | null>("plan.hubId", null)]);
  const manager = canEditDictionaries(actor);
  const mode: SkView["source"]["mode"] = imitationOn() ? "imitation" : hubId && serviceAccountFromEnv() ? "google" : "off";
  return { sourceId: manager ? (hubId ?? "") : "", mode, pulledAt: pulled?.at ?? null, pulledBy: pulled?.by ?? null, serviceEmail: manager ? serviceEmail() : null };
}

/** Ранрейт ОСАГО по СК для карточки продукта. null: загрузок из хаба ещё не было */
export async function skView(actor: Actor, month: string, now = new Date()): Promise<SkView | null> {
  const [snapshots, lines, pulled, lbe] = await Promise.all([
    prisma.planSkSnapshot.findMany({ where: { month }, orderBy: { day: "asc" } }),
    prisma.planSkLine.findMany({ where: { period: month } }),
    getSetting<{ at: string; by: string; day: string } | null>("plan.hubPulled", null),
    prisma.planLine.findFirst({ where: { month, version: "LBE", product: "osago", metric: "units" }, select: { value: true } }),
  ]);
  const anyLoad = pulled !== null || snapshots.length > 0 || lines.length > 0;
  if (!anyLoad) return null;
  const sensitive = await seesSensitive(actor);
  const planOf = (sk: string, metric: SkMetric) => lines.find((l) => l.sk === sk && l.metric === metric)?.value ?? null;
  // Снимки по СК и дням: сумма пула и апсейла в полисы, премия и выручка отдельно
  type Acc = { policies: number; pool: number; revenue: number };
  const bySk = new Map<string, Map<string, Acc>>();
  for (const s of snapshots) {
    const d = iso(s.day);
    const m = bySk.get(s.sk) ?? new Map<string, Acc>();
    const a = m.get(d) ?? { policies: 0, pool: 0, revenue: 0 };
    a.policies += s.policies;
    if (s.pool) a.pool += s.policies;
    a.revenue += s.revenue ?? 0;
    m.set(d, a);
    bySk.set(s.sk, m);
  }
  const companies = [...new Set([...bySk.keys(), ...lines.map((l) => l.sk)])].filter((sk) => sk !== SK_TOTAL);
  const row = (sk: string, acc: Map<string, Acc> | undefined, plan: number | null, kvPlan: number | null): SkRow => {
    const series = acc ? [...acc.entries()].map(([day, a]) => ({ day, mtd: a.policies })) : [];
    const rr = series.length ? runRate(month, series) : null;
    const last = rr ? acc!.get(rr.day)! : null;
    const forecast = rr?.forecast ?? null;
    return {
      sk,
      plan,
      mtd: rr?.mtd ?? null,
      poolShare: last && last.policies > 0 ? last.pool / last.policies : null,
      forecast,
      linear: rr?.linear ?? null,
      profile: rr?.profile ?? null,
      unstable: rr?.unstable ?? false,
      vsPlan: forecast !== null && plan ? forecast / plan : null,
      revenueMtd: sensitive && last ? last.revenue / 1e6 : null,
      kvPlan: sensitive ? kvPlan : null,
    };
  };
  const rows = companies.map((sk) => row(sk, bySk.get(sk), planOf(sk, "pol"), planOf(sk, "kv_tot"))).sort((a, b) => (b.forecast ?? b.plan ?? 0) - (a.forecast ?? a.plan ?? 0));
  // Итог: снимки всех СК по дням складываются, чтобы ранрейт итога считался по тем же дням
  const totalAcc = new Map<string, Acc>();
  for (const m of bySk.values()) {
    for (const [d, a] of m) {
      const t = totalAcc.get(d) ?? { policies: 0, pool: 0, revenue: 0 };
      t.policies += a.policies;
      t.pool += a.pool;
      t.revenue += a.revenue;
      totalAcc.set(d, t);
    }
  }
  const totalPlan = planOf(SK_TOTAL, "pol") ?? (rows.some((r) => r.plan !== null) ? rows.reduce((s, r) => s + (r.plan ?? 0), 0) : null);
  // КВ итога: из модели, а если там нет, средневзвешенно по премии плана СК
  let totalKv = planOf(SK_TOTAL, "kv_tot");
  if (totalKv === null) {
    const pairs = companies.map((sk) => [planOf(sk, "kv_tot"), planOf(sk, "prem_tot")] as const).filter((x): x is readonly [number, number] => x[0] !== null && x[1] !== null && x[1] > 0);
    const prem = pairs.reduce((s, [, p]) => s + p, 0);
    totalKv = prem > 0 ? pairs.reduce((s, [kv, p]) => s + kv * p, 0) / prem : null;
  }
  const total = row(SK_TOTAL, totalAcc.size ? totalAcc : undefined, totalPlan, totalKv);
  const days = [...totalAcc.keys()].sort();
  const day = days[days.length - 1] ?? null;
  const today = moscowToday(now);
  const yesterday = iso(new Date(new Date(`${today}T00:00:00Z`).getTime() - 86_400_000));
  const known = days.filter((d, i) => i > 0 && Number(d.slice(8, 10)) - Number(days[i - 1]!.slice(8, 10)) === 1).length;
  const manager = canEditDictionaries(actor);
  return {
    month,
    day,
    elapsed: day ? Number(day.slice(8, 10)) : 0,
    days: daysIn(month),
    rows,
    total,
    lbeUnits: lbe?.value ?? null,
    sensitive,
    stale: !!day && month === today.slice(0, 7) && day < yesterday,
    profileDays: known,
    source: await hubSource(actor),
    canPull: manager,
    canSource: canManagePeople(actor),
  };
}

export { SK_METRICS, SK_SENSITIVE };
