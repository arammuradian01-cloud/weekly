// Подключение к таблице, состояние синхронизации и фоновый цикл: выгрузка раз в 30 секунд, сверка раз в сутки после 03:30 по Москве.
// Цикл живёт в процессе сервера (src/instrumentation.ts). Отдельный сервис для фоновых задач не нужен.

import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { parseCsv } from "@/lib/tasks/bord-import";
import { BORD_TAB } from "@/lib/bord/parse";
import { pullState, runPull, type BordReader } from "@/lib/bord/pull";
import type { SheetsClient } from "./client";
import { FakeSheets } from "./fake";
import { GoogleSheets, serviceAccountFromEnv } from "./google";
import { PROD_SHEET_ID, SheetBusyError, pushChanges, reconcile } from "./sync";

export const FAKE_SERVICE_EMAIL = "weekly-sync@imitation.iam.gserviceaccount.com";
const TICK_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000;
/** Очередь старше этого: предупреждение в шапке для режима управления */
export const LAG_WARNING_MS = 30 * 60_000;
const RECONCILE_AT = { hour: 3, minute: 30 };

type Mode = "google" | "imitation";
export type Connection = { client: SheetsClient; serviceEmail: string; mode: Mode; spreadsheetId: string };

const g = globalThis as unknown as {
  __sheetFake?: FakeSheets;
  __bordFake?: FakeSheets;
  __sheetGoogle?: { id: string; email: string; client: GoogleSheets };
  __bordGoogle?: { id: string; email: string; client: GoogleSheets };
  __sheetLoop?: { timer: ReturnType<typeof setTimeout>; failures: number };
};

/** Забор из Bord: раз в 5 минут, после ошибки через 15 минут */
export const PULL_EVERY_MS = 5 * 60_000;
export const PULL_RETRY_MS = 15 * 60_000;
/** Выгрузка Bord для имитации забора: вкладка «Задачи» на 05.10.2026 */
const BORD_IMITATION_FILE = "data/bord/zadachi-2026-10-05.csv";

/** Имитация Google в памяти процесса: для e2e-тестов и показа страницы без ключа (SHEET_FAKE=1) */
export function imitation(): FakeSheets {
  g.__sheetFake ??= new FakeSheets();
  return g.__sheetFake;
}

const imitationOn = () => process.env.SHEET_FAKE === "1";

/** Служебный аккаунт: адрес для доступа к копии. Ключ наружу не отдаётся */
export function serviceEmail(): string | null {
  if (imitationOn()) return FAKE_SERVICE_EMAIL;
  return serviceAccountFromEnv()?.client_email ?? null;
}

/** Подключение к таблице или null: нет ключа служебного аккаунта или не задан ID копии */
export async function connection(): Promise<Connection | null> {
  const account = imitationOn() ? null : serviceAccountFromEnv();
  if (!imitationOn() && !account) return null;
  const id = await getSetting<string | null>("sheet.spreadsheetId", null);
  // В рабочий Bord зеркало не пишет, даже если его ID задали в базе руками: Bord ресурс только читает
  if (!id || id === PROD_SHEET_ID) return null;
  // Таблица, из которой забираем задачи, только читается: зеркало в неё не пишет, даже если её ID другой
  if (id === (await getSetting<string | null>("bord.sourceId", null))) return null;
  if (imitationOn()) {
    // Сбой Google в имитации включается настройкой: так e2e-тест проверяет ошибки и предупреждение об отставании
    imitation().down = await getSetting<boolean>("sheet.imitationDown", false);
    return { client: imitation(), serviceEmail: FAKE_SERVICE_EMAIL, mode: "imitation", spreadsheetId: id };
  }
  if (!g.__sheetGoogle || g.__sheetGoogle.id !== id || g.__sheetGoogle.email !== account!.client_email) {
    g.__sheetGoogle = { id, email: account!.client_email, client: new GoogleSheets(id, account!) };
  }
  return { client: g.__sheetGoogle.client, serviceEmail: account!.client_email, mode: "google", spreadsheetId: id };
}

/** Имитация рабочего Bord для забора в e2e-тестах (SHEET_FAKE=1): вкладка «Задачи» из выгрузки в репозитории */
export function imitationBord(): FakeSheets {
  if (!g.__bordFake) {
    const fake = new FakeSheets();
    fake.addTab(BORD_TAB, parseCsv(readFileSync(BORD_IMITATION_FILE, "utf8")), { rows: 400, cols: 10 });
    // Вкладка целей в формате бордов лидеров (этап 17): образец без настоящих цифр
    fake.addTab(
      "Цели образец",
      [
        ["Цели образец"],
        ["№", "Направление", "Сквозная цель", "Запланировано", "Целевые", "Start", "Как проверяем", "Закрытие"],
        ["Запланировано на Q4 2026"],
        ["1", "ОСАГО", "", "Запустить новую форму расчёта", "100% трафика", "0%", "Отчёт по трафику", ""],
        ["2", "ОСАГО", "", "Поднять конверсию расчёта в покупку", "24%", "22%", "Дашборд продаж", ""],
        ["Договорённости"],
      ],
      { rows: 50, cols: 10 },
    );
    g.__bordFake = fake;
  }
  return g.__bordFake;
}

export type BordConnection = { reader: BordReader; mode: Mode; sourceId: string };

/** Откуда забирать задачи: рабочий Bord только на чтение. null: забор не включён или нет ключа служебного аккаунта */
export async function bordConnection(): Promise<BordConnection | null> {
  const id = await getSetting<string | null>("bord.sourceId", null);
  if (!id) return null;
  if (imitationOn()) {
    imitationBord().down = await getSetting<boolean>("bord.imitationDown", false);
    return { reader: imitationBord(), mode: "imitation", sourceId: id };
  }
  const account = serviceAccountFromEnv();
  if (!account) return null;
  if (!g.__bordGoogle || g.__bordGoogle.id !== id || g.__bordGoogle.email !== account.client_email) {
    g.__bordGoogle = { id, email: account.client_email, client: new GoogleSheets(id, account, fetch, "read") };
  }
  // Наружу отдаём только чтение: записи в Bord нет даже в типе
  const client = g.__bordGoogle.client;
  return { reader: { getValues: (range) => client.getValues(range) }, mode: "google", sourceId: id };
}

/** Пора ли забирать: раз в 5 минут, после ошибки через 15 */
export async function pullDue(now: Date): Promise<boolean> {
  const state = await pullState();
  if (!state.lastAttemptAt) return true;
  const wait = state.ok === false ? PULL_RETRY_MS : PULL_EVERY_MS;
  return now.getTime() - new Date(state.lastAttemptAt).getTime() >= wait;
}

/** Забор, если включён и пора. Ошибки не бросает: они видны на странице «Синхронизация», зеркало от них не страдает */
export async function pullIfDue(now = new Date()): Promise<void> {
  try {
    const conn = await bordConnection();
    if (!conn || !(await pullDue(now))) return;
    const result = await runPull(conn.reader, "auto", { now, sourceId: conn.sourceId });
    if (result?.error) console.error("Забор задач из Bord не прошёл, повторим через 15 минут:", result.error);
  } catch (error) {
    console.error("Забор задач из Bord не прошёл:", error instanceof Error ? error.message : error);
  }
}

/** Начало сегодняшнего окна сверки по Москве: 03:30 */
export function reconcileWindowStart(now: Date): Date {
  const msk = new Date(now.getTime() + 3 * 3_600_000);
  const start = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate(), RECONCILE_AT.hour, RECONCILE_AT.minute) - 3 * 3_600_000;
  return new Date(start);
}

/** После неудачной сверки следующая попытка не раньше чем через 15 минут, чтобы не долбить Google */
const RECONCILE_RETRY_MS = 15 * 60_000;

/** Пора ли сверять: после 03:30 по Москве, успешной сверки с 03:30 сегодня ещё не было и последняя попытка была не только что */
export async function reconcileDue(now: Date): Promise<boolean> {
  const start = reconcileWindowStart(now);
  if (now < start) return false;
  const done = await prisma.sheetRun.findFirst({ where: { kind: "reconcile", ok: true, startedAt: { gte: start } }, select: { id: true } });
  if (done) return false;
  const tried = await prisma.sheetRun.findFirst({ where: { kind: "reconcile", ok: false, startedAt: { gte: new Date(now.getTime() - RECONCILE_RETRY_MS) } }, select: { id: true } });
  return !tried;
}

/**
 * Один проход цикла: выгрузка очереди и, если пора, сверка. Ошибку выгрузки бросает наружу: цикл отложит повтор.
 * Ошибка сверки выгрузку не тормозит: сверка повторится сама через 15 минут
 */
export async function tick(now = new Date()): Promise<void> {
  // Сначала забор из Bord: новые задачи из Bord уйдут в таблицу для просмотра тем же проходом
  await pullIfDue(now);
  const conn = await connection();
  if (!conn) return;
  const opts = { serviceEmail: conn.serviceEmail, spreadsheetId: conn.spreadsheetId, now };
  await pushChanges(conn.client, opts);
  if (!(await reconcileDue(now))) return;
  try {
    await reconcile(conn.client, opts);
  } catch (error) {
    if (error instanceof SheetBusyError) return;
    console.error("Сверка с Google-таблицей не прошла, повторим через 15 минут:", error instanceof Error ? error.message : error);
  }
}

/** Пауза перед следующим проходом: 30 с, после ошибок 1 мин, 2 мин, 4 мин, дальше раз в 5 минут */
export function nextDelay(failures: number): number {
  return failures === 0 ? TICK_MS : Math.min(TICK_MS * 2 ** failures, MAX_BACKOFF_MS);
}

/** Запустить фоновый цикл один раз на процесс */
export function startSheetLoop(): void {
  if (g.__sheetLoop) return;
  const state = { timer: undefined as unknown as ReturnType<typeof setTimeout>, failures: 0 };
  const step = async () => {
    try {
      await tick();
      state.failures = 0;
    } catch (error) {
      // Выгрузку делает другой процесс сервера (идёт выкладка): это не ошибка, просто ждём следующего прохода
      if (!(error instanceof SheetBusyError)) {
        state.failures += 1;
        console.error("Выгрузка в Google-таблицу не прошла, повторим позже:", error instanceof Error ? error.message : error);
      }
    } finally {
      state.timer = setTimeout(() => void step(), nextDelay(state.failures));
      state.timer.unref?.();
    }
  };
  state.timer = setTimeout(() => void step(), TICK_MS);
  state.timer.unref?.();
  g.__sheetLoop = state;
}

export type SyncRun = { id: string; kind: "push" | "reconcile" | "rebuild"; startedAt: string; ok: boolean; finished: boolean; items: number; error: string | null; fixed: number | null };

export type SyncStatus = {
  mode: Mode | null;
  /** Включена имитация Google (SHEET_FAKE=1), даже если копия ещё не подключена */
  imitation: boolean;
  spreadsheetId: string | null;
  serviceEmail: string | null;
  hasKey: boolean;
  queue: { size: number; oldestAt: string | null };
  lastOkPushAt: string | null;
  lastReconcile: SyncRun | null;
  lastError: SyncRun | null;
  runs: SyncRun[];
  nextReconcileAt: string;
};

function toRun(r: { id: bigint; kind: string; startedAt: Date; finishedAt: Date | null; ok: boolean; items: number; error: string | null; details: unknown }): SyncRun {
  const d = r.details as { diffs?: unknown[]; removed?: unknown[]; restored?: unknown[] } | null;
  const fixed = r.kind === "reconcile" && d ? (d.diffs?.length ?? 0) + (d.removed?.length ?? 0) + (d.restored?.length ?? 0) : null;
  return { id: String(r.id), kind: r.kind as SyncRun["kind"], startedAt: r.startedAt.toISOString(), ok: r.ok, finished: r.finishedAt !== null, items: r.items, error: r.error, fixed };
}

/** Всё для страницы «Синхронизация» */
export async function syncStatus(now = new Date()): Promise<SyncStatus> {
  const [id, size, oldest, lastOk, lastReconcile, runs] = await Promise.all([
    getSetting<string | null>("sheet.spreadsheetId", null),
    prisma.sheetOutbox.count(),
    prisma.sheetOutbox.findFirst({ orderBy: { id: "asc" }, select: { at: true } }),
    prisma.sheetRun.findFirst({ where: { kind: "push", ok: true }, orderBy: { id: "desc" }, select: { startedAt: true } }),
    prisma.sheetRun.findFirst({ where: { kind: "reconcile", finishedAt: { not: null } }, orderBy: { id: "desc" } }),
    prisma.sheetRun.findMany({ orderBy: { id: "desc" }, take: 30 }),
  ]);
  const list = runs.map(toRun);
  // Ошибка показывается, пока после неё не было успешного запуска того же вида
  const failed = list.find((r) => r.finished && !r.ok);
  const lastError = failed && !list.some((r) => r.ok && r.kind === failed.kind && Number(r.id) > Number(failed.id)) ? failed : null;
  const conn = await connection();
  const start = reconcileWindowStart(now);
  const doneToday = !!lastReconcile && lastReconcile.ok && lastReconcile.startedAt >= start;
  const nextReconcileAt = now < start || doneToday ? (now < start ? start : new Date(start.getTime() + 86_400_000)) : now;
  return {
    mode: conn?.mode ?? null,
    imitation: imitationOn(),
    spreadsheetId: id,
    serviceEmail: serviceEmail(),
    hasKey: imitationOn() || serviceAccountFromEnv() !== null,
    queue: { size, oldestAt: oldest?.at.toISOString() ?? null },
    lastOkPushAt: lastOk?.startedAt.toISOString() ?? null,
    lastReconcile: lastReconcile ? toRun(lastReconcile) : null,
    lastError,
    runs: list,
    nextReconcileAt: nextReconcileAt.toISOString(),
  };
}

/** Отстаёт ли таблица: подключена, а самая старая запись очереди старше 30 минут. Для предупреждения в шапке */
export async function syncLagging(now = new Date()): Promise<boolean> {
  if (!imitationOn() && !serviceAccountFromEnv()) return false;
  const oldest = await prisma.sheetOutbox.findFirst({ orderBy: { id: "asc" }, select: { at: true } });
  if (!oldest || now.getTime() - oldest.at.getTime() < LAG_WARNING_MS) return false;
  return (await connection()) !== null;
}
