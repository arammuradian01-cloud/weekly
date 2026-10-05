// Подключение к таблице, состояние синхронизации и фоновый цикл: выгрузка раз в 30 секунд, сверка раз в сутки после 03:30 по Москве.
// Цикл живёт в процессе сервера (src/instrumentation.ts). Отдельный сервис для фоновых задач не нужен.

import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
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
  __sheetGoogle?: { id: string; email: string; client: GoogleSheets };
  __sheetLoop?: { timer: ReturnType<typeof setTimeout>; failures: number };
};

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
  // Рабочая таблица подключается только на этапе 7: до этого код к ней не пишет, даже если ID задали в базе руками
  if (!id || id === PROD_SHEET_ID) return null;
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
