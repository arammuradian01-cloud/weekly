// Сбор сбоев приложения в одном месте (этап 86).
//
// До этого этапа сбоев никто не видел: ошибка сервера оставалась в логах контейнера, ошибка в браузере — в консоли
// у человека. Теперь и то и другое складывается в таблицу error_events и показывается на странице «Состояние».
//
// Откуда приходят сбои:
// - сервер: Next вызывает onRequestError (src/instrumentation.ts) на каждую необработанную ошибку страницы,
//   серверного действия и обработчика API;
// - браузер: window.onerror и необработанные обещания отправляются в /api/errors
//   (src/components/errors/reporter.tsx), туда же сообщают экраны сбоя;
// - политика CSP (этап 86): браузер сам присылает жалобу на тот же адрес.
//
// Одинаковые сбои складываются по отпечатку: у записи растёт счётчик и время последнего раза, число строк не растёт.
// Содержимого задач, weekly и писем здесь нет: только текст сбоя, путь страницы и первые строки стека. Записи
// старше KEEP_DAYS дней удаляются сами, когда появляется новый сбой.

import { createHash } from "node:crypto";
import { prisma } from "./db";
import { notifyError } from "./alerts";

export type ErrorSourceKind = "SERVER" | "BROWSER" | "CSP";

export type ErrorInput = {
  source: ErrorSourceKind;
  message: string;
  /** Где случилось: путь страницы или обработчика */
  place?: string | null;
  stack?: string | null;
};

/** Пределы длины: в базу идут короткие строки, большой стек не нужен и не хранится */
export const MESSAGE_MAX = 300;
export const PLACE_MAX = 200;
export const STACK_MAX = 1200;
/** Сколько дней держим записи: старые удаляются при появлении нового сбоя */
export const KEEP_DAYS = 90;
/** Об одном и том же сбое оповещение в Telegram уходит не чаще раза в час */
export const NOTIFY_REPEAT_MS = 60 * 60 * 1000;
/** Сколько сообщений о сбоях с одного адреса принимает /api/errors за минуту: от потока жалоб база не страдает */
export const REPORTS_PER_IP = 60;
export const REPORTS_WINDOW_MS = 60_000;
/** Предел тела одного сообщения о сбое */
export const REPORT_BODY_MAX = 8 * 1024;

export const ERROR_SOURCE_LABELS: Record<ErrorSourceKind, string> = {
  SERVER: "Сервер",
  BROWSER: "Браузер",
  CSP: "Политика CSP",
};

/** Строка в одну строчку, без лишних пробелов, не длиннее max */
export function shortText(value: unknown, max: number): string {
  const text = (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value)).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Путь из адреса: в записи остаётся /tasks, а не полный адрес с параметрами */
export function pathOf(url: unknown): string | null {
  const raw = shortText(url, 400);
  if (!raw) return null;
  try {
    return new URL(raw).pathname || "/";
  } catch {
    return shortText(raw.split("?")[0], PLACE_MAX) || null;
  }
}

/**
 * Отпечаток сбоя: источник, текст без чисел и место. Числа убираются, чтобы «Задача 412 не найдена» и
 * «Задача 907 не найдена» легли в одну запись, а не в две тысячи
 */
export function fingerprintOf(input: ErrorInput): string {
  const text = shortText(input.message, MESSAGE_MAX).toLowerCase().replace(/\d+/g, "#");
  const place = shortText(input.place ?? "", PLACE_MAX).toLowerCase().replace(/\d+/g, "#");
  return createHash("sha1").update(`${input.source}\n${text}\n${place}`).digest("hex").slice(0, 32);
}

/** Запись к сохранению или null, если сообщать не о чем */
export function normalizeError(input: ErrorInput): ErrorInput | null {
  const message = shortText(input.message, MESSAGE_MAX);
  if (!message) return null;
  return {
    source: input.source,
    message,
    place: shortText(input.place ?? "", PLACE_MAX) || null,
    stack: shortText(input.stack ?? "", STACK_MAX) || null,
  };
}

/** Жалобы расширений браузера не наши: политику ресурса они не нарушают и чинить их нечем */
function fromExtension(value: string): boolean {
  return /^(chrome|moz|safari|webkit|ms-browser)-extension:/i.test(value.trim());
}

type CspBody = {
  "document-uri"?: unknown;
  documentURL?: unknown;
  "effective-directive"?: unknown;
  effectiveDirective?: unknown;
  "violated-directive"?: unknown;
  "blocked-uri"?: unknown;
  blockedURL?: unknown;
  "source-file"?: unknown;
  sourceFile?: unknown;
  "line-number"?: unknown;
  lineNumber?: unknown;
};

/** Жалоба политики в запись: что заблокировано и на какой странице */
function fromCsp(body: CspBody, url?: unknown): ErrorInput | null {
  const directive = shortText(body["effective-directive"] ?? body.effectiveDirective ?? body["violated-directive"] ?? "", 60) || "default-src";
  const blocked = shortText(body["blocked-uri"] ?? body.blockedURL ?? "", 160);
  if (blocked && fromExtension(blocked)) return null;
  const source = shortText(body["source-file"] ?? body.sourceFile ?? "", 200);
  if (source && fromExtension(source)) return null;
  const line = shortText(body["line-number"] ?? body.lineNumber ?? "", 10);
  return {
    source: "CSP",
    message: `${directive} заблокировал ${blocked || "встроенный код"}`,
    place: pathOf(body["document-uri"] ?? body.documentURL ?? url),
    stack: source ? `${source}${line ? `:${line}` : ""}` : null,
  };
}

/**
 * Разбор тела сообщения о сбое. Три вида: жалоба политики по-старому (application/csp-report), жалоба по
 * Reporting API (application/reports+json, список) и своё сообщение из браузера (обычный JSON).
 * Чужое и битое тело даёт пустой список: обработчик всё равно отвечает «принято»
 */
export function parseErrorReport(contentType: string, body: string): ErrorInput[] {
  if (body.length > REPORT_BODY_MAX) return [];
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  const type = (contentType ?? "").toLowerCase();
  if (Array.isArray(data)) {
    // Reporting API: список сообщений, нас интересуют только жалобы политики
    return data
      .filter((r): r is { type?: unknown; url?: unknown; body?: CspBody } => !!r && typeof r === "object")
      .filter((r) => r.type === "csp-violation" || r.type === "csp")
      .map((r) => fromCsp((r.body ?? {}) as CspBody, r.url))
      .map((x) => (x ? normalizeError(x) : null))
      .filter((x): x is ErrorInput => x !== null);
  }
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  if (record["csp-report"] && typeof record["csp-report"] === "object") {
    const one = fromCsp(record["csp-report"] as CspBody);
    const ready = one ? normalizeError(one) : null;
    return ready ? [ready] : [];
  }
  // Тело с типом жалобы, но без жалобы внутри: сообщать не о чем
  if (type.includes("csp-report")) return [];
  const one = normalizeError({
    source: "BROWSER",
    message: shortText(record.message, MESSAGE_MAX),
    place: pathOf(record.place ?? record.url),
    stack: shortText(record.stack, STACK_MAX),
  });
  return one ? [one] : [];
}

/**
 * Запись сбоя. Никогда не бросает исключение: сбор ошибок не должен сам ронять страницу или обработчик.
 * Новая запись заодно убирает записи старше KEEP_DAYS дней и уводит оповещение в Telegram
 */
export async function recordError(input: ErrorInput, now = new Date()): Promise<void> {
  const ready = normalizeError(input);
  if (!ready) return;
  try {
    const fingerprint = fingerprintOf(ready);
    const row = await prisma.errorEvent.upsert({
      where: { source_fingerprint: { source: ready.source, fingerprint } },
      create: { source: ready.source, fingerprint, message: ready.message, place: ready.place, stack: ready.stack, times: 1, firstAt: now, lastAt: now },
      update: { message: ready.message, place: ready.place, stack: ready.stack, times: { increment: 1 }, lastAt: now },
    });
    if (row.times === 1) {
      await prisma.errorEvent.deleteMany({ where: { lastAt: { lt: new Date(now.getTime() - KEEP_DAYS * 86_400_000) } } });
    }
    // Жалобы политики в Telegram не уходят: неверная политика дала бы поток сообщений, их смотрят на «Состоянии»
    if (ready.source === "CSP") return;
    if (row.notifiedAt && now.getTime() - row.notifiedAt.getTime() < NOTIFY_REPEAT_MS) return;
    const sent = await notifyError({ ...ready, times: row.times });
    if (sent) await prisma.errorEvent.update({ where: { id: row.id }, data: { notifiedAt: now } });
  } catch (error) {
    console.error("Сбой не записан", error);
  }
}

export type ErrorRow = {
  id: string;
  source: ErrorSourceKind;
  sourceLabel: string;
  message: string;
  place: string | null;
  stack: string | null;
  times: number;
  firstAt: string;
  lastAt: string;
};

/** Последние сбои, свежие сверху */
export async function recentErrors(limit = 20): Promise<ErrorRow[]> {
  const rows = await prisma.errorEvent.findMany({ orderBy: { lastAt: "desc" }, take: Math.min(Math.max(limit, 1), 200) });
  return rows.map((r) => ({
    id: String(r.id),
    source: r.source as ErrorSourceKind,
    sourceLabel: ERROR_SOURCE_LABELS[r.source as ErrorSourceKind] ?? r.source,
    message: r.message,
    place: r.place,
    stack: r.stack,
    times: r.times,
    firstAt: r.firstAt.toISOString(),
    lastAt: r.lastAt.toISOString(),
  }));
}

export type ErrorTotals = { day: number; week: number; kinds: number };

/** Сколько случаев сбоев за сутки и за неделю и сколько разных сбоев всего */
export async function errorTotals(now = new Date()): Promise<ErrorTotals> {
  const since = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const [day, week, kinds] = await Promise.all([
    prisma.errorEvent.aggregate({ _sum: { times: true }, where: { lastAt: { gte: since(1) } } }),
    prisma.errorEvent.aggregate({ _sum: { times: true }, where: { lastAt: { gte: since(7) } } }),
    prisma.errorEvent.count(),
  ]);
  return { day: day._sum.times ?? 0, week: week._sum.times ?? 0, kinds };
}
