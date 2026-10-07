// Цифры недели (этап 24, модуль М9): ресурс читает недельный отчёт Weekly Sravni только на чтение служебным аккаунтом,
// хранит снимок строк по неделям и показывает выбранные владельцем метрики в отчёте CEO, на встрече и на странице прогноза.
// Руками факт никто не вводит: нет цифры в отчёте, нет цифры и здесь

import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { getSetting, setSetting } from "@/lib/settings";
import { canManagePeople } from "@/lib/admin/service";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { GoogleSheets, GoogleSheetsError, serviceAccountFromEnv } from "@/lib/sheet/google";
import { FakeSheets } from "@/lib/sheet/fake";
import { PROD_SHEET_ID, type Grid, type SheetsClient } from "@/lib/sheet/client";
import { FAKE_SERVICE_EMAIL, serviceEmail } from "@/lib/sheet/runner";
import type { IsoDate } from "@/domain/dates";
import type { WeekKey } from "@/domain/types";
import { shiftWeek } from "@/lib/weekly/weeks";
import { ReportFormatError, formatDelta, formatValue, guessUnit, parseReport, rowLabel, type Unit } from "./parse";
import type { WeekFigure, WeekNumbers } from "./text";

export type { WeekFigure, WeekNumbers } from "./text";
export { numbersText } from "./text";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

function requireOwner(actor: Actor) {
  if (!canManagePeople(actor)) fail("Недельным отчётом управляет только владелец в режиме управления");
}

export const NUMBERS_TAB_DEFAULT = "TOTAL";
/** Забор раз в час: цифры аналитик ставит к понедельнику 18:00, чаще смотреть незачем. После ошибки через 15 минут */
export const NUMBERS_EVERY_MS = 60 * 60_000;
export const NUMBERS_RETRY_MS = 15 * 60_000;
/** Сколько строк и колонок читаем из вкладки: отчёт на 1200 строк и год недель влезает с запасом */
const READ_RANGE = "A1:CZ1500";
export const METRICS_MAX = 24;

export type Metric = { key: string; label: string; unit: Unit };

export type NumbersState = {
  lastAttemptAt: string | null;
  lastOkAt: string | null;
  ok: boolean | null;
  error: string | null;
  rows: number;
  weeks: number;
  /** Понедельник последней недели в отчёте */
  latestWeek: IsoDate | null;
};

const EMPTY_STATE: NumbersState = { lastAttemptAt: null, lastOkAt: null, ok: null, error: null, rows: 0, weeks: 0, latestWeek: null };

type Reader = Pick<SheetsClient, "getValues">;
type Conn = { reader: Reader; mode: "google" | "imitation"; sourceId: string; tab: string };

const g = globalThis as unknown as { __numbersGoogle?: { id: string; email: string; client: GoogleSheets }; __numbersFake?: FakeSheets };
const imitationOn = () => process.env.SHEET_FAKE === "1";

/** Имитация недельного отчёта для тестов: шапка как у Weekly Sravni, несколько строк с выдуманными цифрами */
export function imitationNumbers(): FakeSheets {
  if (!g.__numbersFake) {
    const fake = new FakeSheets();
    const weeks = [41, 40, 39, 38];
    const from = ["2026-10-05", "2026-09-28", "2026-09-21", "2026-09-14"];
    const to = ["2026-10-11", "2026-10-04", "2026-09-27", "2026-09-20"];
    const row = (key: (string | number)[], values: (number | string)[]) => ["", ...key, "", ...values];
    const grid: Grid = [
      ["2.0"],
      ["", "", "", "", "", "Week", "", ...weeks],
      ["", "", "", "", "", "Date from", "", ...from],
      ["", "", "", "", "", "Date to", "", ...to],
      [],
      row(["TRAFFIC", "TOTAL", "", "OSAGO", "OSAGO"], [512000, 504337, 476536, 465286]),
      row(["TRAFFIC", "TOTAL", "", "CASCO", "CASCO"], [16800, 16231, 16075, 15900]),
      [],
      row(["", "", "", "", "OSAGO"], [97100, 95667, 91543, 90210]),
      row(["TARGET ACTIONS", "Web", "", "OSAGO", "WEB"], [48200, 47639, 45970, 45100]),
      row(["TARGET ACTIONS", "App", "", "OSAGO", "APP"], [24100, 23878, 22619, 22000]),
      [],
      row(["", "", "", "", "OSAGO"], [110.2, 108.5, 102.3, 101.1]),
      row(["REVENUE", "Web", "OSAGO", "OSAGO", "WEB"], [36.9, 36.1, 34.8, 34.0]),
      row(["REVENUE", "App", "OSAGO", "OSAGO", "APP"], [17.5, 17.2, 16.5, 16.1]),
      row(["REVENUE", "TOTAL", "Deposits", "Deposits / Media", "MEDIA"], ["", 1.35, 1.27, 1.2]),
      [],
      row(["", "", "", "", "CR, %: WAU ---> TA"], [0.19, 0.1897, 0.1921, 0.194]),
    ];
    fake.addTab(NUMBERS_TAB_DEFAULT, grid, { rows: 1500, cols: 104 });
    g.__numbersFake = fake;
  }
  return g.__numbersFake;
}

/** Откуда читать отчёт: только чтение. null: источник не задан или нет ключа */
export async function numbersConnection(): Promise<Conn | null> {
  const id = await getSetting<string | null>("numbers.sourceId", null);
  if (!id) return null;
  const tab = await getSetting<string>("numbers.tab", NUMBERS_TAB_DEFAULT);
  if (imitationOn()) {
    imitationNumbers().down = await getSetting<boolean>("numbers.imitationDown", false);
    return { reader: imitationNumbers(), mode: "imitation", sourceId: id, tab };
  }
  const account = serviceAccountFromEnv();
  if (!account) return null;
  if (!g.__numbersGoogle || g.__numbersGoogle.id !== id || g.__numbersGoogle.email !== account.client_email) {
    g.__numbersGoogle = { id, email: account.client_email, client: new GoogleSheets(id, account, fetch, "read") };
  }
  const client = g.__numbersGoogle.client;
  return { reader: { getValues: (range) => client.getValues(range) }, mode: "google", sourceId: id, tab };
}

export async function numbersState(): Promise<NumbersState> {
  return { ...EMPTY_STATE, ...(await getSetting<Partial<NumbersState>>("numbers.pull", {})) };
}

export async function metrics(): Promise<Metric[]> {
  const list = await getSetting<Metric[]>("numbers.metrics", []);
  return Array.isArray(list) ? list.filter((m) => m && typeof m.key === "string") : [];
}

/** ID таблицы из ссылки или как есть. Пустая строка: выключить */
export function parseNumbersSource(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const id = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(raw)?.[1] ?? raw;
  if (!/^[a-zA-Z0-9_-]{25,100}$/.test(id)) fail("Не похоже на ссылку на Google-таблицу. Скопируйте адрес недельного отчёта из браузера целиком");
  return id;
}

function errorText(error: unknown): string {
  if (error instanceof ReportFormatError) return error.message;
  if (error instanceof GoogleSheetsError) return error.message.split(". ")[0]!;
  if (error instanceof Error && /нет нужной вкладки|not found|Unable to parse range/i.test(error.message)) return "В таблице нет такой вкладки: проверьте название";
  return error instanceof Error ? error.message : "Google не ответил. Попробуйте ещё раз через минуту";
}

/** Подключить недельный отчёт или выключить чтение. Доступ и формат проверяются сразу */
export async function setNumbersSource(actor: Actor, input: string, tabInput?: string): Promise<{ id: string | null; tab: string; access: "ok" | "no-key" | string }> {
  requireOwner(actor);
  const id = parseNumbersSource(String(input ?? ""));
  const tab = String(tabInput ?? "").trim().slice(0, 100) || NUMBERS_TAB_DEFAULT;
  if (id && id === PROD_SHEET_ID) fail("Это рабочий Bord, а не недельный отчёт");
  const before = await getSetting<string | null>("numbers.sourceId", null);
  const beforeTab = await getSetting<string>("numbers.tab", NUMBERS_TAB_DEFAULT);
  if (before !== id || beforeTab !== tab) {
    await prisma.$transaction(async (tx) => {
      await tx.setting.upsert({ where: { key: "numbers.sourceId" }, update: { value: id ?? Prisma.JsonNull }, create: { key: "numbers.sourceId", value: id ?? Prisma.JsonNull } });
      await tx.setting.upsert({ where: { key: "numbers.tab" }, update: { value: tab }, create: { key: "numbers.tab", value: tab } });
      if (before !== id) {
        // Другой отчёт: старый снимок к нему не относится
        await tx.numbersRow.deleteMany();
        await tx.setting.deleteMany({ where: { key: "numbers.pull" } });
      }
      await tx.auditLog.create({
        data: {
          action: "sync.numbers",
          actorId: actor.personId,
          actorName: actor.fullName,
          source: "APP",
          entity: "sheet",
          entityId: "numbers",
          field: "Недельный отчёт для цифр недели",
          before: before ? `${before}, вкладка ${beforeTab}` : "чтение выключено",
          after: id ? `${id}, вкладка ${tab}` : "чтение выключено",
          ip: actor.ip,
          via: actor.via ?? null,
        },
      });
    });
  }
  if (!id) return { id, tab, access: "ok" };
  const conn = await numbersConnection();
  if (!conn) return { id, tab, access: "no-key" };
  try {
    const result = await pullNumbers(conn, "manual");
    return { id, tab, access: result.ok ? "ok" : (result.error ?? "Ошибка") };
  } catch (error) {
    return { id, tab, access: errorText(error) };
  }
}

/** Прочитать отчёт целиком и заменить снимок строк. Ошибка пишется в состояние, не бросается */
export async function pullNumbers(conn: Conn, how: "auto" | "manual", now = new Date()): Promise<NumbersState> {
  const prev = await numbersState();
  try {
    const grid = await conn.reader.getValues(`'${conn.tab.replace(/'/g, "''")}'!${READ_RANGE}`);
    const parsed = parseReport(grid);
    await prisma.$transaction(async (tx) => {
      await tx.numbersRow.deleteMany();
      await tx.numbersRow.createMany({
        data: parsed.rows.map((r) => ({ key: r.key, article: r.article, iface: r.iface, product: r.product, mapping: r.mapping, comment: r.comment, ord: r.ord, values: r.values as unknown as Prisma.InputJsonValue })),
      });
    });
    const latest = parsed.weeks.map((w) => w.from).sort().at(-1) ?? null;
    const state: NumbersState = { lastAttemptAt: now.toISOString(), lastOkAt: now.toISOString(), ok: true, error: null, rows: parsed.rows.length, weeks: parsed.weeks.length, latestWeek: latest };
    await setSetting("numbers.pull", state);
    return state;
  } catch (error) {
    const state: NumbersState = { ...prev, lastAttemptAt: now.toISOString(), ok: false, error: errorText(error) };
    await setSetting("numbers.pull", state);
    if (how === "auto") console.error("Чтение недельного отчёта не прошло:", state.error);
    return state;
  }
}

export async function numbersDue(now: Date): Promise<boolean> {
  const state = await numbersState();
  if (!state.lastAttemptAt) return true;
  const wait = state.ok === false ? NUMBERS_RETRY_MS : NUMBERS_EVERY_MS;
  return now.getTime() - new Date(state.lastAttemptAt).getTime() >= wait;
}

/** Чтение по расписанию из минутного цикла: раз в час, если источник задан */
export async function pullNumbersIfDue(now = new Date()): Promise<void> {
  try {
    const conn = await numbersConnection();
    if (!conn || !(await numbersDue(now))) return;
    await pullNumbers(conn, "auto", now);
  } catch (error) {
    console.error("Чтение недельного отчёта не прошло:", error instanceof Error ? error.message : error);
  }
}

export async function pullNumbersNow(actor: Actor): Promise<NumbersState> {
  requireOwner(actor);
  const conn = await numbersConnection();
  if (!conn) fail(serviceEmail() ? "Сначала вставьте ссылку на недельный отчёт" : "Ключ служебного аккаунта Google не задан на сервере");
  const state = await pullNumbers(conn!, "manual");
  if (!state.ok) fail(state.error ?? "Не получилось прочитать отчёт");
  return state;
}

export type NumbersStatus = {
  sourceId: string | null;
  tab: string;
  connected: boolean;
  hasKey: boolean;
  serviceEmail: string | null;
  state: NumbersState;
  nextAt: string | null;
  metrics: Metric[];
};

export async function numbersStatus(now = new Date()): Promise<NumbersStatus> {
  const [sourceId, tab, state, conn, list] = await Promise.all([
    getSetting<string | null>("numbers.sourceId", null),
    getSetting<string>("numbers.tab", NUMBERS_TAB_DEFAULT),
    numbersState(),
    numbersConnection(),
    metrics(),
  ]);
  const wait = state.ok === false ? NUMBERS_RETRY_MS : NUMBERS_EVERY_MS;
  const nextAt = !conn ? null : state.lastAttemptAt ? new Date(Math.max(now.getTime(), new Date(state.lastAttemptAt).getTime() + wait)).toISOString() : now.toISOString();
  return { sourceId, tab, connected: conn !== null, hasKey: imitationOn() || serviceAccountFromEnv() !== null, serviceEmail: imitationOn() ? FAKE_SERVICE_EMAIL : serviceEmail(), state, nextAt, metrics: list };
}

export type ReportRowView = { key: string; label: string; unit: Unit; latest: number | null; latestWeek: IsoDate | null; selected: boolean };

type Values = { week: IsoDate; value: number | null }[];
const valuesOf = (v: Prisma.JsonValue): Values => (Array.isArray(v) ? (v as unknown as Values) : []);

/** Строки отчёта для выбора метрик: поиск по подписи, первые 50 */
export async function searchReportRows(actor: Actor, query: string): Promise<ReportRowView[]> {
  requireOwner(actor);
  const q = String(query ?? "").trim().toLowerCase().slice(0, 100);
  const chosen = new Map((await metrics()).map((m) => [m.key, m]));
  const rows = await prisma.numbersRow.findMany({ orderBy: { ord: "asc" } });
  const out: ReportRowView[] = [];
  for (const r of rows) {
    const label = rowLabel(r);
    if (q && !label.toLowerCase().includes(q) && !r.key.toLowerCase().includes(q)) continue;
    const values = valuesOf(r.values);
    const latest = [...values].sort((a, b) => b.week.localeCompare(a.week)).find((v) => v.value !== null) ?? null;
    out.push({ key: r.key, label: chosen.get(r.key)?.label ?? label, unit: chosen.get(r.key)?.unit ?? guessUnit({ ...r, values }), latest: latest?.value ?? null, latestWeek: latest?.week ?? null, selected: chosen.has(r.key) });
    if (out.length >= 50) break;
  }
  return out;
}

const UNITS: Unit[] = ["count", "mln", "pct"];

/** Какие строки отчёта показывать как «Цифры недели», с подписями и единицами. Порядок как в списке */
export async function setMetrics(actor: Actor, list: Metric[]): Promise<Metric[]> {
  requireOwner(actor);
  if (!Array.isArray(list)) fail("Список метрик не разобран");
  if (list.length > METRICS_MAX) fail(`Не больше ${METRICS_MAX} цифр недели: отчёт CEO должен читаться`);
  const keys = new Set<string>();
  const clean: Metric[] = [];
  for (const m of list) {
    const key = String(m?.key ?? "").trim();
    if (!key || keys.has(key)) continue;
    keys.add(key);
    const label = String(m?.label ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!label) fail("У каждой цифры должна быть подпись");
    const unit = UNITS.includes(m?.unit) ? m.unit : "count";
    clean.push({ key, label, unit });
  }
  const known = new Set((await prisma.numbersRow.findMany({ where: { key: { in: [...keys] } }, select: { key: true } })).map((r) => r.key));
  const unknown = clean.filter((m) => !known.has(m.key));
  if (unknown.length) fail(`В отчёте нет строки: ${unknown.map((m) => m.label).join(", ")}`);
  const before = await metrics();
  await setSetting("numbers.metrics", clean);
  await prisma.auditLog.create({
    data: {
      action: "sync.numbers",
      actorId: actor.personId,
      actorName: actor.fullName,
      source: "APP",
      entity: "sheet",
      entityId: "numbers",
      field: "Цифры недели: состав",
      before: before.map((m) => m.label).join(", ") || "пусто",
      after: clean.map((m) => m.label).join(", ") || "пусто",
      ip: actor.ip,
      via: actor.via ?? null,
    },
  });
  return clean;
}

/**
 * Цифры за неделю для отчёта CEO, встречи и прогноза: выбранные метрики, значение за неделю ключа и за прошлую,
 * изменение. Если за неделю в отчёте ещё пусто, так и говорим: прикидок нет
 */
export async function weekNumbers(key: WeekKey): Promise<WeekNumbers> {
  const [list, sourceId, state] = await Promise.all([metrics(), getSetting<string | null>("numbers.sourceId", null), numbersState()]);
  if (!list.length) return { week: key, ready: false, figures: [], connected: !!sourceId, latestWeek: state.latestWeek };
  const rows = await prisma.numbersRow.findMany({ where: { key: { in: list.map((m) => m.key) } } });
  const byKey = new Map(rows.map((r) => [r.key, valuesOf(r.values)]));
  const prevKey = shiftWeek(key, -1);
  const figures: WeekFigure[] = list.map((m) => {
    const values = byKey.get(m.key) ?? [];
    const at = (w: IsoDate) => values.find((v) => v.week === w)?.value ?? null;
    const value = at(key);
    const prev = at(prevKey);
    const history = [...values].sort((a, b) => a.week.localeCompare(b.week)).filter((v) => v.week <= key).slice(-8);
    return { key: m.key, label: m.label, unit: m.unit, value, prev, text: formatValue(value, m.unit), delta: formatDelta(value, prev, m.unit), history };
  });
  const ready = figures.some((f) => f.value !== null);
  return { week: key, ready, figures, connected: !!sourceId, latestWeek: state.latestWeek };
}
