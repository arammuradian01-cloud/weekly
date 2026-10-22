// Хаб данных «Единая воронка: данные» (этап 58): загрузка снимков «Все СК» и плана ОСАГО по СК, ранрейт по СК для
// карточки ОСАГО. Хаб читается служебным аккаунтом только на чтение, как таблица-связка LRF. Боевые файлы и хаб ресурс не
// меняет.
//
// Загрузка из двух независимых частей: снимок факта («Все СК») и план по СК. Сломанный лист плана не блокирует дневной
// снимок и наоборот: что прошло проверку, то загружается, журнал пишет, что загружено и почему нет

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
import { addMonths, monthLabel } from "@/lib/forecast/codes";
import { PRODUCTS } from "./spec";
import { PARTNER_DEFAULT_OWNERS, PARTNER_OWNER_CODE } from "./partners";
import {
  HUB_LIMITS,
  HUB_SHEETS,
  RUN_RATE_FROM_DAY,
  SK_METRICS,
  SK_SENSITIVE,
  SK_TOTAL,
  aliasKeys,
  aliasText,
  aliasesOf,
  daysIn,
  factDay,
  isTotal,
  nameList,
  parseAliases,
  parseHubSource,
  readSkPlan,
  readVseSk,
  runRate,
  runRateReady,
  skKey,
  snapshotDayIn,
  snapshotMonths,
  type SkAliases,
  type SkMetric,
  type SkMonthRow,
  type SkPlanRead,
  type VseSkRead,
} from "./hub";
import { hubImitation } from "./hub-imitation";
import { numbersLevel, personalLogin, type NumbersLevel } from "./access";
import { LRF_MIRROR_ID, LRF_SHEET_ID, type Grid } from "./lrf";

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

/** Лист хаба как прочитан: сетка, что мешает его загрузить, о чём предупредить. failed: Google не отдал лист */
type SheetRead = { grid: Grid | undefined; failed: boolean; problems: string[]; warnings: string[] };

/**
 * Листы хаба: сначала размер сетки, потом диапазон не больше лимита. Лист длиннее лимита строк не загружается (часть СК
 * пропала бы молча), шире лимита колонок: предупреждение. Ошибка чтения одного листа не срывает другой
 */
async function readHub(conn: Conn): Promise<{ vseSk: SheetRead; skPlan: SheetRead }> {
  const infos = await conn.reader.sheets();
  const read = async (name: string, limit: number): Promise<SheetRead> => {
    const info = infos.find((i) => i.title.toLowerCase() === name.toLowerCase());
    if (!info) return { grid: undefined, failed: false, problems: [], warnings: [] };
    const problems: string[] = [];
    const warnings: string[] = [];
    if ((info.rowCount ?? 0) > limit) problems.push(`Лист «${name}» больше ${limit.toLocaleString("ru-RU")} строк (в листе ${info.rowCount!.toLocaleString("ru-RU")}): ресурс читает первые ${limit.toLocaleString("ru-RU")}, часть строк пропала бы. Удалите пустые строки внизу листа или поднимите лимит чтения`);
    if ((info.columnCount ?? 0) > HUB_LIMITS.cols) warnings.push(`Лист «${name}» шире ${HUB_LIMITS.cols} колонок: читаются первые ${HUB_LIMITS.cols}`);
    const r = Math.min(info.rowCount ?? limit, limit);
    const c = Math.min(info.columnCount ?? HUB_LIMITS.cols, HUB_LIMITS.cols);
    if (r < 1 || c < 1) return { grid: [], failed: false, problems, warnings };
    try {
      return { grid: (await conn.reader.getValues(`${q(info.title)}!A1:${colLetter(c)}${r}`)) as Grid, failed: false, problems, warnings };
    } catch (error) {
      return { grid: undefined, failed: true, problems: [`Лист «${name}» не прочитан: ${errorText(error)}`], warnings };
    }
  };
  const [vseSk, skPlan] = await Promise.all([read(HUB_SHEETS.vseSk, HUB_LIMITS.vseSkRows), read(HUB_SHEETS.skPlan, HUB_LIMITS.skPlanRows)]);
  return { vseSk, skPlan };
}

/** Лист ещё не получил цифры из IMPORTRANGE: в A1 ошибка или «Загрузка» */
const pending = (grid: Grid | undefined) => !!grid && grid.length <= 2 && /^(#REF!|#N\/A|#ERROR!|Загрузка|Loading)/i.test(String(grid[0]?.[0] ?? "").trim());
const pendingText = (name: string) => `Лист «${name}» ещё не получил цифры: откройте хаб, нажмите «Открыть доступ» у ячейки A1 и подождите минуту`;

const dd = (day: string) => day.split("-").reverse().join(".");
const ml = (month: string) => monthLabel(month);

/** Часть загрузки: что мешает (блокирует только эту часть) и о чём предупредить */
export type HubPart = { problems: string[]; warnings: string[]; ready: boolean };

export type HubPreview = {
  /** День снимка по Москве (день загрузки) */
  day: string;
  /** Последний день с фактом в снимке: вчера по Москве */
  factDay: string;
  /** Снимок «Все СК» */
  fact: HubPart & {
    /** Месяцы листа, месяцы, которые войдут в снимок, число СК и полисы с начала месяца на день факта */
    info: { months: string[]; stored: string[]; companies: number; policiesMtd: number | null; replaces: boolean } | null;
  };
  /** План по СК */
  plan: HubPart & { info: { periods: string[]; companies: number; planUnits: number | null } | null };
  /** Общие предупреждения: названия СК в двух листах не совпали */
  warnings: string[];
  /** Загрузится хотя бы одна часть */
  ready: boolean;
};

export type HubApplied = {
  day: string;
  fact: { loaded: boolean; rows: number; months: string[]; problem: string | null };
  plan: { loaded: boolean; rows: number; problem: string | null };
};

type FactPart = HubPart & { rows: SkMonthRow[]; months: string[]; stored: string[] };
type PlanPart = HubPart & { read: SkPlanRead | null };

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Последний снимок до дня day по каждому месяцу снимка: его день и строки (только СК и полисы) */
async function previousSnapshots(day: string, keep: string[]): Promise<{ month: string; day: string; rows: { sk: string; policies: number }[] }[]> {
  const last = await prisma.planSkSnapshot.groupBy({ by: ["month"], where: { day: { lt: new Date(`${day}T00:00:00Z`) }, month: { in: keep } }, _max: { day: true } });
  const pairs = last.filter((l) => l._max.day).map((l) => ({ month: l.month, day: l._max.day! }));
  if (!pairs.length) return [];
  const rows = await prisma.planSkSnapshot.findMany({ where: { OR: pairs.map((p) => ({ month: p.month, day: p.day })) }, select: { day: true, month: true, sk: true, policies: true } });
  return pairs.map((p) => ({ month: p.month, day: iso(p.day), rows: rows.filter((r) => r.month === p.month && r.day.getTime() === p.day.getTime()) }));
}

/**
 * Снимок «Все СК» на день: месяцы снимка по правилу дня факта (текущий и прошлый для закрытия), проверки листа и сверка
 * с прошлым снимком того же месяца. Итог месяца упал больше чем на HUB_LIMITS.factDrop: снимок не пишется (лист мог
 * обрезаться, а снимок перетёр бы факт и закрытие месяца). Итог не вырос, хотя день факта сдвинулся: источник, похоже, не
 * обновился. СК из прошлого снимка нет сегодня: предупреждение, в карточке её факт остаётся на прошлом значении
 */
async function factPart(day: string, sheet: SheetRead, aliases: SkAliases): Promise<FactPart> {
  const month = day.slice(0, 7);
  const prevMonth = addMonths(month, -1);
  const keep = snapshotMonths(day);
  const problems = [...sheet.problems];
  const warnings = [...sheet.warnings];
  let read: VseSkRead | null = null;
  if (pending(sheet.grid)) problems.push(pendingText(HUB_SHEETS.vseSk));
  else if (!sheet.failed) {
    read = readVseSk(sheet.grid, keep);
    problems.push(...read.problems);
    warnings.push(...read.warnings);
  }
  const rows = read?.rows ?? [];
  const current = rows.some((r) => r.month === month);
  const previous = rows.some((r) => r.month === prevMonth);
  if (read && !problems.length) {
    if (!keep.includes(month)) {
      // 1-е число: факт по вчерашний день, это итог прошлого месяца; строки текущего месяца в снимок не идут
      if (!previous) problems.push(`В «Все СК» нет строк за ${ml(prevMonth)}: снимок на ${dd(day)} закрывает прошлый месяц, а закрывать нечем`);
      else warnings.push(`Факт в «Все СК» по вчерашний день: снимок на ${dd(day)} закрывает ${ml(prevMonth)}, факт за ${ml(month)} появится завтра`);
    } else if (!current && !previous) problems.push(`В «Все СК» нет строк ни за ${ml(month)}, ни за ${ml(prevMonth)}: снимок не из чего делать`);
    else if (!current) warnings.push(`В «Все СК» нет строк за ${ml(month)}: источник ещё не обновлён. Снимок на ${dd(day)} обновит только ${ml(prevMonth)}, факт текущего месяца не появится`);
  }
  // Сверка с прошлым снимком каждого месяца: итог и СК, которых сегодня нет
  if (rows.length && !problems.length) {
    for (const before of await previousSnapshots(day, keep)) {
      const now = rows.filter((r) => r.month === before.month);
      if (!now.length) continue;
      const was = before.rows.reduce((s, r) => s + r.policies, 0);
      const is = now.reduce((s, r) => s + r.policies, 0);
      const grows = (snapshotDayIn(day, before.month) ?? "") > (snapshotDayIn(before.day, before.month) ?? "");
      if (was > 0 && is < was * (1 - HUB_LIMITS.factDrop)) {
        problems.push(
          `Итог «Все СК» за ${ml(before.month)} упал против снимка на ${dd(before.day)} больше чем на ${HUB_LIMITS.factDrop * 100}%: было ${fmt(was)} полисов, сейчас ${fmt(is)}. Лист мог обрезаться: снимок не пишется, чтобы не перетереть факт${before.month < month ? " и закрытие месяца" : ""}. Проверьте лист и загрузите снова`,
        );
      } else if (grows && is <= was) {
        warnings.push(`Итог «Все СК» за ${ml(before.month)} не вырос с прошлой загрузки (снимок на ${dd(before.day)}: ${fmt(was)} полисов, сейчас ${fmt(is)}): источник, похоже, не обновился с прошлой загрузки`);
      }
      // СК сравниваются так же, как в карточке: по skKey и справочнику соответствий (переименование со строкой справочника не пропажа)
      const key = aliasKeys(aliases);
      const today = new Set(now.map((r) => key(r.sk)));
      const lost = before.rows.filter((r) => !today.has(key(r.sk))).map((r) => r.sk);
      if (lost.length) warnings.push(`В «Все СК» за ${ml(before.month)} нет СК, которые были в снимке на ${dd(before.day)}: ${nameList(lost)}. В карточке их факт останется на значении того снимка. Проверьте, не обрезан ли лист и не переименованы ли СК`);
    }
  }
  const stored = [...new Set(rows.map((r) => r.month))].sort();
  return { problems: [...new Set(problems)], warnings: [...new Set(warnings)], ready: problems.length === 0, rows, months: read?.months ?? [], stored };
}

/** План по СК: проверки листа и сверка суммы СК с итогом за текущий месяц */
function planPart(day: string, sheet: SheetRead): PlanPart {
  const month = day.slice(0, 7);
  const problems = [...sheet.problems];
  const warnings = [...sheet.warnings];
  let read: SkPlanRead | null = null;
  if (pending(sheet.grid)) problems.push(pendingText(HUB_SHEETS.skPlan));
  else if (!sheet.failed) {
    read = readSkPlan(sheet.grid, month);
    problems.push(...read.problems);
    warnings.push(...read.warnings);
  }
  if (read && !problems.length) {
    const total = read.rows.find((r) => r.period === month && r.sk === SK_TOTAL && r.metric === "pol")?.value ?? null;
    const skSum = read.rows.filter((r) => r.period === month && r.sk !== SK_TOTAL && r.metric === "pol").reduce((s, r) => s + (r.value ?? 0), 0);
    // Числа только в итоге, у СК нули: такой план затёр бы план по СК нулями
    if (total !== null && total > 0 && skSum === 0) problems.push(`План по СК за ${ml(month)}: у СК полисов 0, а в итоге ${fmt(total)}. План по СК затёрся бы нулями`);
    else if (total && skSum && Math.abs(skSum - total) > 0.005 * total) warnings.push(`План по СК за ${ml(month)}: сумма СК ${fmt(skSum)} не сходится с итогом ${fmt(total)}`);
  }
  return { problems: [...new Set(problems)], warnings, ready: problems.length === 0, read };
}

/** Названия СК, которые не свелись между листами (skKey и справочник соответствий) за месяц факта */
function nameMismatch(day: string, fact: FactPart, plan: PlanPart, aliases: SkAliases): string[] {
  if (!fact.rows.length || !plan.read?.rows.length) return [];
  const key = aliasKeys(aliases);
  const factMonth = factDay(day).slice(0, 7);
  const month = plan.read.periods.includes(factMonth) ? factMonth : day.slice(0, 7);
  const inPlan = new Map(plan.read.rows.filter((r) => r.period === month && r.metric === "pol" && r.value && !isTotal(r.sk)).map((r) => [key(r.sk), r.sk]));
  const inFact = new Map(fact.rows.filter((r) => r.month === month && r.policies > 0).map((r) => [key(r.sk), r.sk]));
  if (!inPlan.size || !inFact.size) return [];
  const onlyPlan = [...inPlan].filter(([k]) => !inFact.has(k)).map(([, name]) => name);
  const onlyFact = [...inFact].filter(([k]) => !inPlan.has(k)).map(([, name]) => name);
  if (!onlyPlan.length && !onlyFact.length) return [];
  const parts = [onlyPlan.length ? `есть в плане, нет в «Все СК»: ${nameList(onlyPlan)}` : null, onlyFact.length ? `есть в «Все СК», нет в плане: ${nameList(onlyFact)}` : null].filter(Boolean);
  return [
    `Названия СК в двух листах за ${ml(month)} не совпали (регистр, пробелы, кавычки, ё, дефисы и форма собственности не в счёт), такие СК будут отдельными строками: ${parts.join("; ")}. Если это одна СК, задайте соответствие ниже: «название в «Все СК» = название в плане»`,
  ];
}

async function readAll(now: Date) {
  const day = moscowToday(now);
  const conn = await hubConnection(now);
  if (!conn) fail(serviceEmail() ? "Хаб данных не задан: вставьте ссылку на таблицу «Единая воронка: данные»" : "Ключ служебного аккаунта Google не задан на сервере");
  let sheets: { vseSk: SheetRead; skPlan: SheetRead };
  try {
    sheets = await readHub(conn!);
  } catch (error) {
    return fail(errorText(error));
  }
  const aliases = aliasesOf(await getSetting<unknown>("plan.skAliases", {}));
  const fact = await factPart(day, sheets.vseSk, aliases);
  const plan = planPart(day, sheets.skPlan);
  return { day, fact, plan, warnings: nameMismatch(day, fact, plan, aliases) };
}

/** Что загрузится из хаба: ничего не пишет. Части проверяются отдельно, каждая со своими проблемами */
export async function previewHub(actor: Actor, now = new Date()): Promise<HubPreview> {
  requirePull(actor);
  const { day, fact, plan, warnings } = await readAll(now);
  const month = day.slice(0, 7);
  const fd = factDay(day);
  const factRows = fact.rows.filter((r) => r.month === fd.slice(0, 7));
  const replaces = (await prisma.planSkSnapshot.count({ where: { day: new Date(`${day}T00:00:00Z`) } })) > 0;
  const total = plan.read?.rows.find((r) => r.period === month && r.sk === SK_TOTAL && r.metric === "pol");
  return {
    day,
    factDay: fd,
    fact: {
      problems: fact.problems,
      warnings: fact.warnings,
      ready: fact.ready,
      info: fact.rows.length ? { months: fact.months, stored: fact.stored, companies: new Set(factRows.map((r) => skKey(r.sk))).size, policiesMtd: factRows.length ? factRows.reduce((s, r) => s + r.policies, 0) : null, replaces } : null,
    },
    plan: {
      problems: plan.problems,
      warnings: plan.warnings,
      ready: plan.ready,
      info: plan.read?.rows.length ? { periods: plan.read.periods, companies: new Set(plan.read.rows.filter((r) => r.sk !== SK_TOTAL).map((r) => skKey(r.sk))).size, planUnits: total?.value ?? null } : null,
    },
    warnings,
    ready: fact.ready || plan.ready,
  };
}

/** Когда и кто загрузил каждую часть хаба: факт и план отдельно, частичная загрузка не выдаёт себя за полную */
export type HubPulled = { fact: { at: string; by: string; day: string } | null; plan: { at: string; by: string } | null };

const stamp = (v: unknown): { at: string; by: string; day?: string } | null => {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  return o && typeof o.at === "string" ? { at: o.at, by: typeof o.by === "string" ? o.by : "", ...(typeof o.day === "string" ? { day: o.day } : {}) } : null;
};

/** Настройка plan.hubPulled. Прежний вид { at, by, day, fact: true, plan: false } читается как отметка обеих частей */
export function hubPulledOf(value: unknown): HubPulled {
  const o = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const legacy = stamp(o);
  const part = (v: unknown) => (v === true ? legacy : stamp(v));
  const fact = part(o.fact);
  const plan = part(o.plan);
  return { fact: fact ? { at: fact.at, by: fact.by, day: fact.day ?? fact.at.slice(0, 10) } : null, plan: plan ? { at: plan.at, by: plan.by } : null };
}

/**
 * Загрузить что прошло проверку: снимок «Все СК» на сегодня (текущий и прошлый месяц, снимок дня заменяется) и строки
 * плана по СК (заменяются целиком). Время загрузки каждой части пишется отдельно. Не прошла ни одна часть: отказ с
 * причинами обеих
 */
export async function applyHub(actor: Actor, now = new Date()): Promise<HubApplied> {
  requirePull(actor);
  const { day, fact, plan } = await readAll(now);
  if (!fact.ready && !plan.ready) fail(`Не загружено: ${fact.problems[0]}; ${plan.problems[0]}`);
  const dayDate = new Date(`${day}T00:00:00Z`);
  const snapshotRows = fact.ready ? fact.rows.map((r) => ({ day: dayDate, month: r.month, sk: r.sk, pool: r.pool, upsale: r.upsale, policies: r.policies, premium: r.premium, revenue: r.revenue })) : [];
  const lineRows = plan.ready && plan.read ? plan.read.rows.map((r) => ({ period: r.period, sk: r.sk, metric: r.metric, value: r.value })) : [];
  const journal = [
    fact.ready ? `снимок ${day}: ${snapshotRows.length} строк за ${fact.stored.join(", ")}` : `снимок ${day} не загружен: ${fact.problems[0]}`,
    plan.ready ? `план по СК: ${lineRows.length} строк` : `план по СК не загружен: ${plan.problems[0]}`,
  ].join("; ");
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('plan.hub'))`;
      if (fact.ready) {
        await tx.planSkSnapshot.deleteMany({ where: { day: dayDate } });
        if (snapshotRows.length) await tx.planSkSnapshot.createMany({ data: snapshotRows });
      }
      if (plan.ready) {
        await tx.planSkLine.deleteMany();
        if (lineRows.length) await tx.planSkLine.createMany({ data: lineRows });
      }
      // Отметка загрузки под той же блокировкой: часть, которая не загрузилась, сохраняет прежнее время
      const before = hubPulledOf((await tx.setting.findUnique({ where: { key: "plan.hubPulled" } }))?.value);
      const at = now.toISOString();
      const pulled: HubPulled = { fact: fact.ready ? { at, by: actor.fullName, day } : before.fact, plan: plan.ready ? { at, by: actor.fullName } : before.plan };
      const value = pulled as unknown as Prisma.InputJsonValue;
      await tx.setting.upsert({ where: { key: "plan.hubPulled" }, update: { value }, create: { key: "plan.hubPulled", value } });
      await tx.auditLog.create({
        data: { action: "plan.hub", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "plan", entityId: day, field: "Загрузка из хаба", before: Prisma.JsonNull, after: journal, ip: actor.ip ?? null, via: actor.via ?? null },
      });
    },
    { timeout: 30_000 },
  );
  return {
    day,
    fact: { loaded: fact.ready, rows: snapshotRows.length, months: fact.ready ? fact.stored : [], problem: fact.problems[0] ?? null },
    plan: { loaded: plan.ready, rows: lineRows.length, problem: plan.problems[0] ?? null },
  };
}

/** Хаб задаёт владелец ссылкой: id таблицы «Единая воронка: данные». Боевые таблицы ресурса хабом быть не могут */
export async function setHubSource(actor: Actor, input: string): Promise<string> {
  if (!canManagePeople(actor)) fail("Хаб данных задаёт владелец в режиме управления");
  const id = parseHubSource(input) ?? fail("Не похоже на ссылку на Google-таблицу. Скопируйте адрес хаба из браузера целиком");
  if (id === PROD_SHEET_ID) fail("Это рабочий Bord, а не хаб данных");
  if (id === LRF_SHEET_ID) fail("Это боевой LRF, а не хаб данных");
  const [bord, mirror, lrf, numbers] = await Promise.all([
    getSetting<string | null>("bord.sourceId", null),
    getSetting<string | null>("sheet.spreadsheetId", null),
    getSetting<string | null>("plan.sourceId", LRF_MIRROR_ID),
    getSetting<string | null>("numbers.sourceId", null),
  ]);
  if (id === bord) fail("Из этой таблицы ресурс забирает задачи Bord: это не хаб данных");
  if (id === mirror) fail("Это таблица для просмотра задач, в неё ресурс пишет: это не хаб данных");
  if (id === lrf) fail("Это источник LRF для прогноза месяца: это не хаб данных");
  if (id === numbers) fail("Это источник цифр недели: это не хаб данных");
  const before = await getSetting<string | null>("plan.hubId", null);
  if (before === id) return id;
  await setSetting("plan.hubId", id);
  await prisma.auditLog.create({
    data: { action: "plan.hubSource", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "plan", entityId: "hub", field: "Хаб данных для прогноза", before: before ?? "не задан", after: id, ip: actor.ip ?? null, via: actor.via ?? null },
  });
  return id;
}

/**
 * Справочник соответствий названий СК (настройка plan.skAliases): «название в «Все СК» = название в плане» по строке.
 * Правит владелец в панели хаба, каждая правка в журнале plan.skAliases. Возвращает сохранённый текст
 */
export async function setSkAliases(actor: Actor, input: string): Promise<string> {
  if (!canManagePeople(actor)) fail("Соответствие названий СК задаёт владелец в режиме управления");
  const { aliases, problems } = parseAliases(String(input ?? ""));
  if (problems.length) fail(problems.slice(0, 3).join(". "));
  const after = aliasText(aliases);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('plan.skAliases'))`;
    const before = aliasText(aliasesOf((await tx.setting.findUnique({ where: { key: "plan.skAliases" } }))?.value));
    if (before === after) return;
    await tx.setting.upsert({ where: { key: "plan.skAliases" }, update: { value: aliases }, create: { key: "plan.skAliases", value: aliases } });
    await tx.auditLog.create({
      data: { action: "plan.skAliases", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "plan", entityId: "skAliases", field: "Соответствие названий СК", before: (before || "пусто").slice(0, 4000), after: (after || "пусто").slice(0, 4000), ip: actor.ip ?? null, via: actor.via ?? null },
    });
  });
  return after;
}

export type SkRow = {
  sk: string;
  /** План месяца из модели: полисы */
  plan: number | null;
  /** Факт с начала месяца по последнему снимку, где есть эта СК */
  mtd: number | null;
  /** Доля пула в факте с начала месяца */
  poolShare: number | null;
  /** Ранрейт: null, пока дней факта меньше HUB_LIMITS.minRunRateDays */
  forecast: number | null;
  linear: number | null;
  profile: number | null;
  unstable: boolean;
  /** Прогноз к плану: доля */
  vsPlan: number | null;
  /** Выручка с апсейлом с начала месяца, млн; только для тех, кому видны чувствительные показатели. null: колонок выручки нет */
  revenueMtd: number | null;
  /** КВ плана месяца, доля; только для тех, кому видны чувствительные показатели */
  kvPlan: number | null;
  /** СК нет в последнем снимке: её факт на этот день (в итоге она идёт с этим значением) */
  carriedFrom: string | null;
};

/** Откуда читается хаб и когда загружены части: для карточки и панели загрузки */
export type HubSourceView = {
  sourceId: string;
  mode: "google" | "imitation" | "off";
  /** Факт «Все СК» и план по СК загружаются независимо: у каждой части своё время и кто загрузил */
  fact: { at: string; by: string } | null;
  plan: { at: string; by: string } | null;
  serviceEmail: string | null;
  /** Справочник соответствий названий СК текстом для поля: только тому, кто его правит (владелец в режиме управления) */
  aliases: string | null;
};

export type SkView = {
  month: string;
  /** Последний день с фактом в месяце (день загрузки минус один, после конца месяца последний день): null, если факта нет */
  day: string | null;
  /** День загрузки снимка, из которого этот факт */
  loadDay: string | null;
  elapsed: number;
  days: number;
  rows: SkRow[];
  total: SkRow;
  /** LBE полисов ОСАГО на месяц из версий месяца: сверка итога ранрейта */
  lbeUnits: number | null;
  /** Чувствительные показатели (выручка, КВ) показаны этому человеку */
  sensitive: boolean;
  /** Снимок загружен раньше вчерашнего дня по Москве */
  stale: boolean;
  /** Текущий месяц, но факта за него ещё нет (1-е число): ранрейт не считается, факт появится завтра */
  factTomorrow: boolean;
  /** Факт есть, но дней факта меньше HUB_LIMITS.minRunRateDays: ранрейт и «К плану» появятся с этого числа месяца */
  runRateFrom: number | null;
  /** Дней с дневным фактом (снимок за день и за предыдущий день): профилю дней недели нужно HUB_LIMITS.minProfileDays */
  profileDays: number;
  source: HubSourceView;
  canPull: boolean;
  canSource: boolean;
};

/**
 * Кому видны выручка и КВ по СК (решение 21.10): управление, команда ОСАГО и команда партнёрского канала, и только при
 * личном входе или в режиме владельца. Под общим логином можно выбрать чужой профиль, поэтому комиссии СК там не видны
 */
export async function seesSensitive(actor: Actor): Promise<boolean> {
  if (!personalLogin(actor)) return false;
  if (canEditDictionaries(actor)) return true;
  const owners = await getSetting<Record<string, string[]>>("plan.owners", {});
  const of = (code: string, fallback: string[]) => (Array.isArray(owners?.[code]) ? owners[code]! : fallback);
  const osago = of("osago", PRODUCTS.find((p) => p.code === "osago")?.owners ?? []);
  const partners = of(PARTNER_OWNER_CODE, PARTNER_DEFAULT_OWNERS);
  return osago.includes(actor.slug) || partners.includes(actor.slug);
}

/** Настройки хаба, которые нужны и панели, и карточке: читаются один раз на представление месяца */
export type HubState = { hubId: string | null; pulled: HubPulled; aliases: SkAliases };

export async function hubState(): Promise<HubState> {
  const [hubId, pulled, aliases] = await Promise.all([getSetting<string | null>("plan.hubId", null), getSetting<unknown>("plan.hubPulled", null), getSetting<unknown>("plan.skAliases", {})]);
  return { hubId, pulled: hubPulledOf(pulled), aliases: aliasesOf(aliases) };
}

/** Откуда читается хаб: для панели загрузки, даже пока загрузок не было. state: уже прочитанные настройки хаба */
export async function hubSource(actor: Actor, state?: HubState | Promise<HubState>): Promise<HubSourceView> {
  const { hubId, pulled, aliases } = await (state ?? hubState());
  const manager = canEditDictionaries(actor);
  const mode: HubSourceView["mode"] = imitationOn() ? "imitation" : hubId && serviceAccountFromEnv() ? "google" : "off";
  return {
    sourceId: manager ? (hubId ?? "") : "",
    mode,
    fact: pulled.fact ? { at: pulled.fact.at, by: pulled.fact.by } : null,
    plan: pulled.plan,
    serviceEmail: manager ? serviceEmail() : null,
    aliases: canManagePeople(actor) ? aliasText(aliases) : null,
  };
}

type Acc = { policies: number; pool: number; revenue: number | null };
const addAcc = (t: Acc, a: Acc): Acc => ({ policies: t.policies + a.policies, pool: t.pool + a.pool, revenue: t.revenue === null && a.revenue === null ? null : (t.revenue ?? 0) + (a.revenue ?? 0) });

/**
 * Ранрейт ОСАГО по СК для карточки продукта. null: загрузок из хаба ещё не было или человеку открыты не все цифры
 * (этап 57). Представление месяца собирается и для сводки уровня «основные цифры», поэтому разрез по СК режется здесь.
 * opts.state: уже прочитанные настройки хаба (monthPlan читает их один раз); opts.level: уровень доступа, если вызывающий
 * его уже знает (тогда он не считается заново)
 *
 * Названия СК сводятся по skKey и справочнику соответствий. СК, которой нет в последнем снимке, но которая была в
 * прошлом снимке того же месяца, идёт в итог по дням со своим прошлым значением: нарастающий итог не убывает от того,
 * что СК пропала из листа. Её собственный ранрейт считается по её последнему снимку
 */
export async function skView(actor: Actor, month: string, now = new Date(), opts: { state?: HubState | Promise<HubState>; level?: NumbersLevel } = {}): Promise<SkView | null> {
  if ((opts.level ?? (await numbersLevel(actor))) !== "full") return null;
  const statePromise = Promise.resolve(opts.state ?? hubState());
  const [snapshots, lines, state, lbe] = await Promise.all([
    prisma.planSkSnapshot.findMany({ where: { month }, select: { day: true, sk: true, pool: true, policies: true, revenue: true } }),
    prisma.planSkLine.findMany({ where: { period: month, metric: { in: ["pol", "kv_tot", "prem_tot"] } }, select: { sk: true, metric: true, value: true } }),
    statePromise,
    prisma.planLine.findFirst({ where: { month, version: "LBE", product: "osago", metric: "units" }, select: { value: true } }),
  ]);
  const anyLoad = state.pulled.fact !== null || state.pulled.plan !== null || snapshots.length > 0 || lines.length > 0;
  if (!anyLoad) return null;
  const sensitive = await seesSensitive(actor);
  const keyOf = aliasKeys(state.aliases);
  const totalKey = skKey(SK_TOTAL);
  // План по СК: «Итого» и «Всего» это итог, названия сводятся по skKey и справочнику
  const plans = new Map<string, { name: string; values: Map<string, number | null> }>();
  for (const l of lines) {
    const key = isTotal(l.sk) ? totalKey : keyOf(l.sk);
    const p = plans.get(key) ?? { name: isTotal(l.sk) ? SK_TOTAL : l.sk, values: new Map<string, number | null>() };
    p.values.set(l.metric, l.value);
    plans.set(key, p);
  }
  const planOf = (key: string, metric: SkMetric) => plans.get(key)?.values.get(metric) ?? null;
  // Снимки к дням факта месяца: день загрузки минус один, после конца месяца последний день. На один день факта берётся
  // самый поздний снимок: после закрытия месяца в нём поздние поправки
  const latest = new Map<string, string>();
  for (const s of snapshots) {
    const load = iso(s.day);
    const d = snapshotDayIn(load, month);
    if (d && (latest.get(d) ?? "") < load) latest.set(d, load);
  }
  const bySk = new Map<string, { name: string; days: Map<string, Acc> }>();
  for (const s of snapshots) {
    const load = iso(s.day);
    const d = snapshotDayIn(load, month);
    if (!d || latest.get(d) !== load || isTotal(s.sk)) continue;
    const key = keyOf(s.sk);
    const m = bySk.get(key) ?? { name: s.sk, days: new Map<string, Acc>() };
    m.days.set(d, addAcc(m.days.get(d) ?? { policies: 0, pool: 0, revenue: null }, { policies: s.policies, pool: s.pool ? s.policies : 0, revenue: s.revenue }));
    bySk.set(key, m);
  }
  const allDays = [...new Set([...bySk.values()].flatMap((m) => [...m.days.keys()]))].sort();
  const day = allDays[allDays.length - 1] ?? null;
  const elapsed = day ? Number(day.slice(8, 10)) : 0;
  const ready = runRateReady(elapsed);
  const keys = [...new Set([...bySk.keys(), ...plans.keys()])].filter((k) => k !== totalKey);
  const row = (sk: string, acc: Map<string, Acc> | undefined, plan: number | null, kvPlan: number | null): SkRow => {
    const series = acc ? [...acc.entries()].map(([d, a]) => ({ day: d, mtd: a.policies })) : [];
    const rr = series.length ? runRate(month, series) : null;
    const last = rr ? acc!.get(rr.day)! : null;
    const forecast = ready ? (rr?.forecast ?? null) : null;
    return {
      sk,
      plan,
      mtd: rr?.mtd ?? null,
      poolShare: last && last.policies > 0 ? last.pool / last.policies : null,
      forecast,
      linear: ready ? (rr?.linear ?? null) : null,
      profile: ready ? (rr?.profile ?? null) : null,
      unstable: ready && (rr?.unstable ?? false),
      vsPlan: forecast !== null && plan ? forecast / plan : null,
      revenueMtd: sensitive && last && last.revenue !== null ? last.revenue / 1e6 : null,
      kvPlan: sensitive ? kvPlan : null,
      carriedFrom: rr && day && rr.day < day ? rr.day : null,
    };
  };
  const rows = keys
    .map((k) => row(plans.get(k)?.name ?? bySk.get(k)!.name, bySk.get(k)?.days, planOf(k, "pol"), planOf(k, "kv_tot")))
    .sort((a, b) => (b.forecast ?? b.mtd ?? b.plan ?? 0) - (a.forecast ?? a.mtd ?? a.plan ?? 0));
  // Итог: снимки всех СК по дням складываются, чтобы ранрейт итога считался по тем же дням. СК, которой нет в снимке
  // дня, но которая была раньше в месяце, идёт со своим последним значением
  const totalAcc = new Map<string, Acc>();
  for (const m of bySk.values()) {
    let carried: Acc | null = null;
    for (const d of allDays) {
      carried = m.days.get(d) ?? carried;
      if (carried) totalAcc.set(d, addAcc(totalAcc.get(d) ?? { policies: 0, pool: 0, revenue: null }, carried));
    }
  }
  const totalPlan = planOf(totalKey, "pol") ?? (rows.some((r) => r.plan !== null) ? rows.reduce((s, r) => s + (r.plan ?? 0), 0) : null);
  // КВ итога: из модели, а если там нет, средневзвешенно по премии плана СК
  let totalKv = planOf(totalKey, "kv_tot");
  if (totalKv === null) {
    const pairs = keys.map((k) => [planOf(k, "kv_tot"), planOf(k, "prem_tot")] as const).filter((x): x is readonly [number, number] => x[0] !== null && x[1] !== null && x[1] > 0);
    const prem = pairs.reduce((s, [, p]) => s + p, 0);
    totalKv = prem > 0 ? pairs.reduce((s, [kv, p]) => s + kv * p, 0) / prem : null;
  }
  const total = row(SK_TOTAL, totalAcc.size ? totalAcc : undefined, totalPlan, totalKv);
  const loadDay = day ? latest.get(day)! : null;
  const today = moscowToday(now);
  const yesterday = iso(new Date(new Date(`${today}T00:00:00Z`).getTime() - 86_400_000));
  const current = month === today.slice(0, 7);
  const known = allDays.filter((d, i) => i > 0 && Number(d.slice(8, 10)) - Number(allDays[i - 1]!.slice(8, 10)) === 1).length;
  const manager = canEditDictionaries(actor);
  return {
    month,
    day,
    loadDay,
    elapsed,
    days: daysIn(month),
    rows,
    total,
    lbeUnits: lbe?.value ?? null,
    sensitive,
    stale: current && !!loadDay && loadDay < yesterday,
    factTomorrow: current && snapshotDayIn(today, month) === null,
    runRateFrom: day && !ready ? RUN_RATE_FROM_DAY : null,
    profileDays: known,
    source: await hubSource(actor, state),
    canPull: manager,
    canSource: canManagePeople(actor),
  };
}

export { SK_METRICS, SK_SENSITIVE };
