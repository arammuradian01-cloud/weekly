// Этап 81: факт к плану по неделям. Загрузка плана из таблицы недель (справочник строк и «План для DWH»), чтение факта
// раз в час, фиксация недели в понедельник в 18:00 по Москве, данные для экрана «Неделя к плану».
//
// Таблицу недель и таблицу факта ресурс читает служебным аккаунтом только на чтение (решение Арама 26.10). Факт пока из
// вкладки «Факт Weekly для приложения» таблицы недель (Weekly Sravni), потом из таблицы «Факт по неделям», которую
// выгружает BI: владелец меняет источник факта ссылкой, код тот же.
//
// Все показатели, включая выручку по страховым и партнёрам, видны всем (решение Арама 26.10)

import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { getSetting, setSetting } from "@/lib/settings";
import { canEditDictionaries, canManagePeople } from "@/lib/admin/service";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { GoogleSheets, GoogleSheetsError, serviceAccountFromEnv } from "@/lib/sheet/google";
import { FakeSheets } from "@/lib/sheet/fake";
import { PROD_SHEET_ID, colLetter, q, type Grid as SheetGrid, type SheetInfo } from "@/lib/sheet/client";
import { serviceEmail } from "@/lib/sheet/runner";
import { moscowToday } from "@/lib/tasks/dates";
import { LRF_SHEET_ID } from "@/lib/plan/lrf";
import {
  VERSION_LABEL,
  WEEKPLAN_LIMITS,
  WEEKPLAN_SHEET_ID,
  WEEKPLAN_TABS,
  addDays,
  mondayOf,
  nextMonth,
  parseSheetId,
  readDict,
  readFact,
  readPlan,
  type Cut,
  type FactValue,
  type Grid,
  type PlanLine,
  type PlanValue,
  type Unit,
  type Version,
} from "./contract";
import { weekPlanImitation } from "./imitation";
import { fkey, mkey, wkey, type PlanData } from "./view";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

type Reader = { getValues(range: string): Promise<SheetGrid>; sheets(): Promise<SheetInfo[]> };
type Conn = { plan: Reader; fact: Reader; mode: "google" | "imitation"; planId: string; factId: string; factTab: string };

const g = globalThis as unknown as { __weekPlanGoogle?: Map<string, GoogleSheets>; __weekPlanFake?: { day: string; fake: FakeSheets } };
const imitationOn = () => process.env.SHEET_FAKE === "1";

/** Имитация таблицы недель: факт по закрытым на сегодня неделям */
export function imitationWeekPlan(now = new Date()): FakeSheets {
  const day = moscowToday(now);
  if (!g.__weekPlanFake || g.__weekPlanFake.day !== day) {
    const fake = new FakeSheets();
    for (const [name, grid] of Object.entries(weekPlanImitation(day))) fake.addTab(name, grid as SheetGrid, { rows: grid.length + 10, cols: 20 });
    g.__weekPlanFake = { day, fake };
  }
  return g.__weekPlanFake.fake;
}

export type Sources = { planId: string; factId: string; factTab: string };

export async function sources(): Promise<Sources> {
  const [planId, factId, factTab] = await Promise.all([
    getSetting<string | null>("weekplan.sourceId", null),
    getSetting<string | null>("weekplan.factSourceId", null),
    getSetting<string | null>("weekplan.factTab", null),
  ]);
  const plan = planId || WEEKPLAN_SHEET_ID;
  return { planId: plan, factId: factId || plan, factTab: factTab || WEEKPLAN_TABS.appFact };
}

function google(id: string, account: NonNullable<ReturnType<typeof serviceAccountFromEnv>>): Reader {
  g.__weekPlanGoogle ??= new Map();
  const key = `${id}|${account.client_email}`;
  if (!g.__weekPlanGoogle.has(key)) g.__weekPlanGoogle.set(key, new GoogleSheets(id, account, fetch, "read"));
  const client = g.__weekPlanGoogle.get(key)!;
  return { getValues: (range) => client.getValues(range), sheets: () => client.sheets() };
}

/** Подключение к таблице недель и таблице факта. null: нет ключа служебного аккаунта (и не имитация) */
export async function weekPlanConnection(now = new Date()): Promise<Conn | null> {
  const src = await sources();
  if (imitationOn()) {
    const fake = imitationWeekPlan(now);
    return { plan: fake, fact: fake, mode: "imitation", ...src };
  }
  const account = serviceAccountFromEnv();
  if (!account) return null;
  return { plan: google(src.planId, account), fact: google(src.factId, account), mode: "google", ...src };
}

function errorText(error: unknown, what: string): string {
  if (error instanceof GoogleSheetsError) {
    if (error.status === 403) return `Нет доступа к ${what}: дайте служебному аккаунту право «Читатель»`;
    if (error.status === 404) return `${what[0]!.toUpperCase()}${what.slice(1)} не найдена: проверьте ссылку`;
    return error.message.split(". ")[0]!;
  }
  if (error instanceof TaskRuleError) return error.message;
  return "Google не ответил. Попробуйте ещё раз через минуту";
}

/** Лист целиком кусками по WEEKPLAN_LIMITS.planChunk строк. Лист длиннее лимита не читается: часть строк пропала бы */
async function readTab(reader: Reader, infos: SheetInfo[], name: string, limit: number, what: string): Promise<{ grid: Grid | undefined; problem: string | null }> {
  const info = infos.find((i) => i.title.toLowerCase() === name.toLowerCase());
  if (!info) return { grid: undefined, problem: `В ${what} нет листа «${name}»` };
  const rows = info.rowCount ?? limit;
  if (rows > limit) return { grid: undefined, problem: `Лист «${name}» больше ${limit.toLocaleString("ru-RU")} строк (в листе ${rows.toLocaleString("ru-RU")}): часть строк пропала бы` };
  const cols = Math.min(info.columnCount ?? 26, 26);
  const grid: Grid = [];
  try {
    for (let r0 = 1; r0 <= rows; r0 += WEEKPLAN_LIMITS.planChunk) {
      const r1 = Math.min(rows, r0 + WEEKPLAN_LIMITS.planChunk - 1);
      const part = (await reader.getValues(`${q(info.title)}!A${r0}:${colLetter(cols)}${r1}`)) as Grid;
      // Google не отдаёт пустые строки в конце куска: дополняем, чтобы номера строк в сообщениях были верными
      for (let i = 0; i < r1 - r0 + 1; i++) grid.push(part[i] ?? []);
    }
  } catch (error) {
    return { grid: undefined, problem: `Лист «${name}» не прочитан: ${errorText(error, what)}` };
  }
  while (grid.length && !grid.at(-1)!.some((c) => c !== "" && c !== null && c !== undefined)) grid.pop();
  return { grid, problem: null };
}

const requireLoad = (actor: Actor) => {
  if (!canEditDictionaries(actor)) fail("План и факт по неделям загружают владелец и администраторы в режиме управления");
};

const noConn = (): never => fail(serviceEmail() ? "Таблица недель не подключена" : "Ключ служебного аккаунта Google не задан на сервере");

// ---------- План ----------

export type PlanSum = { label: string; unit: Unit; bud: number; lrf: number };

export type PlanPreview = {
  problems: string[];
  warnings: string[];
  ready: boolean;
  info: { lines: number; rows: number; weeks: number; first: string | null; last: string | null; sums: PlanSum[]; replaces: boolean } | null;
};

async function readPlanSource(conn: Conn): Promise<{ lines: PlanLine[]; values: PlanValue[]; problems: string[]; warnings: string[] }> {
  let infos: SheetInfo[];
  try {
    infos = await conn.plan.sheets();
  } catch (error) {
    return fail(errorText(error, "таблице недель"));
  }
  const dictTab = await readTab(conn.plan, infos, WEEKPLAN_TABS.dict, WEEKPLAN_LIMITS.dictRows, "таблице недель");
  if (dictTab.problem) return { lines: [], values: [], problems: [dictTab.problem], warnings: [] };
  const dict = readDict(dictTab.grid);
  if (dict.problems.length) return { lines: [], values: [], problems: dict.problems, warnings: dict.warnings };
  const planTab = await readTab(conn.plan, infos, WEEKPLAN_TABS.plan, WEEKPLAN_LIMITS.planRows, "таблице недель");
  if (planTab.problem) return { lines: dict.rows, values: [], problems: [planTab.problem], warnings: dict.warnings };
  const plan = readPlan(planTab.grid, dict.rows);
  return { lines: dict.rows, values: plan.rows, problems: plan.problems, warnings: [...dict.warnings, ...plan.warnings] };
}

/** Контрольные суммы плана (ТЗ аналитикам, раздел 4.6): по ним сверяется загрузка */
export function planSums(lines: PlanLine[], values: PlanValue[]): PlanSum[] {
  const total = (pick: (v: PlanValue) => boolean, version: Version) => values.filter((v) => v.version === version && pick(v)).reduce((s, v) => s + v.value, 0);
  const tot = new Set(lines.filter((l) => l.cut === "итог" && l.unit === "млн ₽").map((l) => l.id));
  const monthly = new Set(lines.filter((l) => l.monthOnly).map((l) => l.id));
  const sums: PlanSum[] = [];
  const add = (label: string, unit: Unit, pick: (v: PlanValue) => boolean) => sums.push({ label, unit, bud: total(pick, "BUD"), lrf: total(pick, "LRF") });
  if (lines.some((l) => l.id === "OS.TOT.S")) add("ОСАГО, полисы (OS.TOT.S)", "шт", (v) => v.lineId === "OS.TOT.S");
  if (lines.some((l) => l.id === "OS.TOT.R")) add("ОСАГО, выручка от продаж (OS.TOT.R)", "млн ₽", (v) => v.lineId === "OS.TOT.R");
  if (tot.size) add("Выручка от продаж всех продуктов", "млн ₽", (v) => tot.has(v.lineId));
  if (monthly.size) add("Только по месяцам (ретро, EV, медиа, VAS)", "млн ₽", (v) => monthly.has(v.lineId));
  return sums;
}

/** Что загрузится из таблицы недель: ничего не пишет */
export async function previewPlan(actor: Actor, now = new Date()): Promise<PlanPreview> {
  requireLoad(actor);
  const conn = (await weekPlanConnection(now)) ?? noConn();
  const read = await readPlanSource(conn);
  const ready = read.problems.length === 0 && read.values.length > 0;
  const weeks = [...new Set(read.values.filter((v) => v.week).map((v) => v.week))].sort();
  return {
    problems: read.problems,
    warnings: read.warnings,
    ready,
    info: read.values.length
      ? { lines: read.lines.length, rows: read.values.length, weeks: weeks.length, first: weeks[0] ?? null, last: weeks.at(-1) ?? null, sums: planSums(read.lines, read.values), replaces: (await prisma.weekPlanLine.count()) > 0 }
      : null,
  };
}

export type PlanLoaded = { at: string; by: string; lines: number; rows: number } | null;

const stampOf = (v: unknown): PlanLoaded => {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  return o && typeof o.at === "string" ? { at: o.at, by: String(o.by ?? ""), lines: Number(o.lines ?? 0), rows: Number(o.rows ?? 0) } : null;
};

/**
 * Загрузить план: справочник и план заменяются целиком под блокировкой. Не прошла проверка: ничего не меняется. После
 * плана сразу читается факт: он ложится на новый справочник
 */
export async function applyPlan(actor: Actor, now = new Date()): Promise<{ lines: number; rows: number; fact: FactState }> {
  requireLoad(actor);
  const conn = (await weekPlanConnection(now)) ?? noConn();
  const read = await readPlanSource(conn);
  if (read.problems.length) fail(`Не загружено: ${read.problems[0]}`);
  if (!read.values.length) fail("Не загружено: в плане нет строк");
  const sums = planSums(read.lines, read.values);
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('weekplan.plan'))`;
      await tx.weekPlanValue.deleteMany();
      await tx.weekPlanLine.deleteMany();
      await tx.weekPlanLine.createMany({ data: read.lines.map((l) => ({ ...l })) });
      for (let i = 0; i < read.values.length; i += 5000) await tx.weekPlanValue.createMany({ data: read.values.slice(i, i + 5000) });
      // Факт строк, которых больше нет в справочнике, не показывается: удаляем его, фиксации остаются как история
      await tx.weekFact.deleteMany({ where: { lineId: { notIn: read.lines.map((l) => l.id) } } });
      const value = { at: now.toISOString(), by: actor.fullName, lines: read.lines.length, rows: read.values.length } as Prisma.InputJsonValue;
      await tx.setting.upsert({ where: { key: "weekplan.planLoaded" }, update: { value }, create: { key: "weekplan.planLoaded", value } });
      await tx.auditLog.create({
        data: {
          action: "weekplan.plan",
          actorId: actor.personId,
          actorName: actor.fullName,
          source: "APP",
          entity: "weekplan",
          entityId: conn.planId,
          field: "План по неделям",
          before: Prisma.JsonNull,
          after: `строк справочника ${read.lines.length}, строк плана ${read.values.length}; ${sums.map((s) => `${s.label}: бюджет ${num(s.bud, s.unit)}, LRF ${num(s.lrf, s.unit)}`).join("; ")}`.slice(0, 4000),
          ip: actor.ip ?? null,
          via: actor.via ?? null,
        },
      });
    },
    { timeout: 120_000 },
  );
  const fact = await pullFact(conn, "manual", now);
  return { lines: read.lines.length, rows: read.values.length, fact };
}

const num = (v: number, unit: Unit) => (unit === "шт" ? Math.round(v).toLocaleString("ru-RU") : v.toLocaleString("ru-RU", { maximumFractionDigits: 1, minimumFractionDigits: 1 }));

// ---------- Факт ----------

export type FactState = {
  lastAttemptAt: string | null;
  lastOkAt: string | null;
  ok: boolean | null;
  error: string | null;
  rows: number;
  latestWeek: string | null;
  warnings: string[];
};

const EMPTY_FACT: FactState = { lastAttemptAt: null, lastOkAt: null, ok: null, error: null, rows: 0, latestWeek: null, warnings: [] };
export const FACT_EVERY_MS = 60 * 60_000;
export const FACT_RETRY_MS = 10 * 60_000;

export async function factState(): Promise<FactState> {
  return { ...EMPTY_FACT, ...(await getSetting<Partial<FactState>>("weekplan.factPull", {})) };
}

async function dictLines(): Promise<PlanLine[]> {
  const rows = await prisma.weekPlanLine.findMany({ orderBy: { ord: "asc" } });
  return rows.map((r) => ({ ...r, cut: r.cut as Cut, unit: r.unit as Unit }));
}

/**
 * Прочитать факт и заменить его целиком, потом зафиксировать прошедшие недели. Ошибка пишется в состояние, не
 * бросается: чтение по расписанию не должно ронять цикл. Строк стало меньше половины прошлого чтения: факт не
 * заменяется (лист мог обрезаться или выгрузка BI пришла неполной)
 */
export async function pullFact(conn: Conn, how: "auto" | "manual", now = new Date()): Promise<FactState> {
  const prev = await factState();
  const failWith = async (error: string): Promise<FactState> => {
    const state: FactState = { ...prev, lastAttemptAt: now.toISOString(), ok: false, error };
    await setSetting("weekplan.factPull", state as unknown as Prisma.InputJsonValue);
    if (how === "auto") console.error("Чтение факта по неделям не прошло:", error);
    return state;
  };
  try {
    const lines = await dictLines();
    if (!lines.length) return await failWith("План по неделям ещё не загружен: факт не на что положить");
    let infos: SheetInfo[];
    try {
      infos = await conn.fact.sheets();
    } catch (error) {
      return await failWith(errorText(error, "таблице факта"));
    }
    const tab = await readTab(conn.fact, infos, conn.factTab, WEEKPLAN_LIMITS.factRows, "таблице факта");
    if (tab.problem) return await failWith(tab.problem);
    const read = readFact(tab.grid, lines, conn.factTab);
    if (read.problems.length) return await failWith(read.problems[0]!);
    const before = await prisma.weekFact.count();
    if (before > 0 && read.rows.length < before * WEEKPLAN_LIMITS.factShrink) {
      return await failWith(`Строк факта стало ${read.rows.length} против ${before} при прошлом чтении: лист мог обрезаться, факт не заменён. Проверьте источник`);
    }
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('weekplan.fact'))`;
        await tx.weekFact.deleteMany();
        for (let i = 0; i < read.rows.length; i += 5000) await tx.weekFact.createMany({ data: read.rows.slice(i, i + 5000).map((r) => ({ ...r, pulledAt: now })) });
      },
      { timeout: 60_000 },
    );
    const state: FactState = {
      lastAttemptAt: now.toISOString(),
      lastOkAt: now.toISOString(),
      ok: true,
      error: null,
      rows: read.rows.length,
      latestWeek: read.rows.map((r) => r.week).sort().at(-1) ?? null,
      warnings: read.warnings.slice(0, 5),
    };
    await setSetting("weekplan.factPull", state as unknown as Prisma.InputJsonValue);
    await fixPass(now);
    return state;
  } catch (error) {
    return failWith(error instanceof Error ? error.message : "Ошибка чтения факта");
  }
}

export async function factDue(now: Date): Promise<boolean> {
  const state = await factState();
  if (!state.lastAttemptAt) return true;
  return now.getTime() - new Date(state.lastAttemptAt).getTime() >= (state.ok === false ? FACT_RETRY_MS : FACT_EVERY_MS);
}

/** Из минутного цикла: факт раз в час (после ошибки через 10 минут), если план загружен. Фиксация после чтения */
export async function pullFactIfDue(now = new Date()): Promise<void> {
  try {
    if (!(await prisma.weekPlanLine.count())) return;
    const conn = await weekPlanConnection(now);
    if (!conn) return;
    if (await factDue(now)) await pullFact(conn, "auto", now);
    // Между чтениями фиксация нужна только раз, когда наступил понедельник 18:00
    else if ((await getSetting<string | null>("weekplan.fixCutoff", null)) !== fixCutoff(now)) await fixPass(now);
  } catch (error) {
    console.error("Чтение факта по неделям не прошло:", error instanceof Error ? error.message : error);
  }
}

export async function pullFactNow(actor: Actor, now = new Date()): Promise<FactState> {
  requireLoad(actor);
  const conn = (await weekPlanConnection(now)) ?? noConn();
  const state = await pullFact(conn, "manual", now);
  if (!state.ok) fail(state.error ?? "Факт не прочитан");
  return state;
}

// ---------- Фиксация ----------

/** Москва без перехода на летнее время: UTC+3 */
const MSK_MS = 3 * 60 * 60_000;
export const FIX_HOUR = 18;

/**
 * Последний понедельник 18:00 по Москве не позже now (день ГГГГ-ММ-ДД). Недели, которые кончились до этого понедельника,
 * зафиксированы: неделя W фиксируется в понедельник W+7 в 18:00
 */
export function fixCutoff(now: Date): string {
  const msk = new Date(now.getTime() + MSK_MS);
  const day = msk.toISOString().slice(0, 10);
  const monday = mondayOf(day);
  return day === monday && msk.getUTCHours() < FIX_HOUR ? addDays(monday, -7) : monday;
}

/**
 * Зафиксировать недели, которые пора: первая фиксация «предварительно», если источник потом изменил значение, новая
 * версия «уточнено» с разницей. Зафиксированное не перезаписывается. Возвращает число новых версий
 */
export async function fixPass(now = new Date()): Promise<number> {
  const cutoff = fixCutoff(now);
  const lastWeek = addDays(cutoff, -7);
  const facts = await prisma.weekFact.findMany({ where: { week: { lte: lastWeek } }, select: { lineId: true, week: true, value: true } });
  await setSetting("weekplan.fixCutoff", cutoff);
  if (!facts.length) return 0;
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('weekplan.fix'))`;
      const fixes = await tx.weekFactFix.findMany({ where: { week: { lte: lastWeek } }, orderBy: { version: "asc" }, select: { week: true, lineId: true, version: true, value: true } });
      const latest = new Map<string, { version: number; value: number }>();
      for (const f of fixes) latest.set(fkey(f.lineId, f.week), { version: f.version, value: f.value });
      const data: Prisma.WeekFactFixCreateManyInput[] = [];
      for (const f of facts) {
        const was = latest.get(fkey(f.lineId, f.week));
        if (!was) data.push({ week: f.week, lineId: f.lineId, version: 1, status: "предварительно", value: f.value, delta: null, fixedAt: now });
        else if (Math.abs(was.value - f.value) > WEEKPLAN_LIMITS.epsilon * Math.max(1, Math.abs(was.value)))
          data.push({ week: f.week, lineId: f.lineId, version: was.version + 1, status: "уточнено", value: f.value, delta: f.value - was.value, fixedAt: now });
      }
      if (data.length) await tx.weekFactFix.createMany({ data, skipDuplicates: true });
      return data.length;
    },
    { timeout: 60_000 },
  );
}

// ---------- Источники ----------

/** Владелец меняет таблицу недель и источник факта (вкладка «Факт Weekly для приложения» или таблица факта из BI) */
export async function setWeekPlanSources(actor: Actor, input: { plan?: string; fact?: string; factTab?: string }): Promise<Sources> {
  if (!canManagePeople(actor)) fail("Источники плана и факта по неделям задаёт владелец в режиме управления");
  const id = (raw: string | undefined, what: string): string | null => {
    if (raw === undefined || raw.trim() === "") return null;
    const v = parseSheetId(raw) ?? fail(`${what}: не похоже на ссылку на Google-таблицу. Скопируйте адрес из браузера целиком`);
    if (v === PROD_SHEET_ID) fail(`${what}: это рабочий Bord`);
    if (v === LRF_SHEET_ID) fail(`${what}: это боевой LRF, его ресурс только читает для прогноза месяца`);
    return v;
  };
  const plan = id(input.plan, "Таблица недель");
  const fact = id(input.fact, "Таблица факта");
  const tab = String(input.factTab ?? "").trim().slice(0, 100) || null;
  const before = await sources();
  await prisma.$transaction(async (tx) => {
    const put = async (key: string, value: string | null) => {
      const v = value ?? Prisma.JsonNull;
      await tx.setting.upsert({ where: { key }, update: { value: v }, create: { key, value: v } });
    };
    await put("weekplan.sourceId", plan);
    await put("weekplan.factSourceId", fact);
    await put("weekplan.factTab", tab);
    // Другой источник факта: прежний факт к нему не относится, следующее чтение заберёт новый сразу
    await tx.setting.deleteMany({ where: { key: "weekplan.factPull" } });
    await tx.auditLog.create({
      data: {
        action: "weekplan.sources",
        actorId: actor.personId,
        actorName: actor.fullName,
        source: "APP",
        entity: "weekplan",
        entityId: "sources",
        field: "Источники плана и факта по неделям",
        before: `таблица недель ${before.planId}; факт ${before.factId}, вкладка ${before.factTab}`,
        after: `таблица недель ${plan ?? WEEKPLAN_SHEET_ID}; факт ${fact ?? plan ?? WEEKPLAN_SHEET_ID}, вкладка ${tab ?? WEEKPLAN_TABS.appFact}`,
        ip: actor.ip ?? null,
        via: actor.via ?? null,
      },
    });
  });
  if (fact !== null && fact !== before.factId) await prisma.weekFact.deleteMany();
  return sources();
}

// ---------- Экран ----------

export type WeekPlanStatus = {
  sources: Sources;
  mode: "google" | "imitation" | "off";
  serviceEmail: string | null;
  plan: PlanLoaded;
  fact: FactState;
  canLoad: boolean;
  canSource: boolean;
};

export async function weekPlanStatus(actor: Actor): Promise<WeekPlanStatus> {
  const [src, plan, fact] = await Promise.all([sources(), getSetting<unknown>("weekplan.planLoaded", null), factState()]);
  const mode = imitationOn() ? "imitation" : serviceAccountFromEnv() ? "google" : "off";
  return { sources: src, mode, serviceEmail: imitationOn() ? "imitation@weekly.local" : serviceEmail(), plan: stampOf(plan), fact, canLoad: canEditDictionaries(actor), canSource: canManagePeople(actor) };
}

/** План и факт для экрана по строкам, которые выбирает pick (все строки, если не задано). Пустой справочник: null */
export async function planData(pick?: (lines: PlanLine[]) => string[]): Promise<PlanData | null> {
  const lines = await dictLines();
  if (!lines.length) return null;
  const ids = pick ? pick(lines) : undefined;
  const where = ids ? { lineId: { in: ids } } : {};
  const [weekly, monthly, bounds, facts, weekList] = await Promise.all([
    prisma.weekPlanValue.groupBy({ by: ["lineId", "version", "week"], where: { ...where, week: { not: "" } }, _sum: { value: true } }),
    prisma.weekPlanValue.groupBy({ by: ["lineId", "version", "month"], where, _sum: { value: true } }),
    prisma.weekPlanValue.aggregate({ _min: { month: true }, _max: { month: true } }),
    prisma.weekFact.findMany({ where: ids ? { lineId: { in: ids } } : {}, select: { lineId: true, week: true, value: true } }),
    prisma.weekPlanValue.findMany({ where: { week: { not: "" } }, distinct: ["week"], select: { week: true }, orderBy: { week: "asc" } }),
  ]);
  const week = new Map<string, number>();
  for (const r of weekly) week.set(wkey(r.lineId, r.version as Version, r.week), r._sum.value ?? 0);
  const month = new Map<string, number>();
  for (const r of monthly) month.set(mkey(r.lineId, r.version as Version, r.month), r._sum.value ?? 0);
  const fact = new Map<string, number>();
  for (const f of facts) fact.set(fkey(f.lineId, f.week), f.value);
  const first = bounds._min.month ?? "";
  const last = bounds._max.month ? addDays(nextMonth(bounds._max.month), -1) : "";
  return { lines, weeks: weekList.map((w) => w.week), first, last, week, month, fact };
}

export type WeekFix = { status: "до фиксации" | "предварительно" | "уточнено"; fixedAt: string | null; lines: number; refined: { lineId: string; delta: number; version: number }[] };

/** Фиксация недели: когда зафиксирована и какие строки потом уточнены */
export async function weekFix(week: string): Promise<WeekFix> {
  const fixes = await prisma.weekFactFix.findMany({ where: { week }, orderBy: [{ lineId: "asc" }, { version: "asc" }] });
  if (!fixes.length) return { status: "до фиксации", fixedAt: null, lines: 0, refined: [] };
  const byLine = new Map<string, typeof fixes>();
  for (const f of fixes) byLine.set(f.lineId, [...(byLine.get(f.lineId) ?? []), f]);
  const refined = [...byLine]
    .filter(([, list]) => list.length > 1)
    .map(([lineId, list]) => ({ lineId, version: list.at(-1)!.version, delta: list.at(-1)!.value - list[0]!.value }));
  const firstAt = fixes.reduce((a, f) => (f.fixedAt < a ? f.fixedAt : a), fixes[0]!.fixedAt);
  return { status: refined.length ? "уточнено" : "предварительно", fixedAt: firstAt.toISOString(), lines: byLine.size, refined };
}

export { VERSION_LABEL };
export type { FactValue };
