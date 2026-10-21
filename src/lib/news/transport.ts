// Забор ленты по сети (этап 60): таймаут, один повтор, предел размера, условные запросы.
// Тесты подменяют транспорт целиком (setNewsTransport) или включают режим фикстур NEWS_FAKE=1:
// тогда вместо сети лента читается из tests/fixtures/news по имени хоста, и сквозные тесты идут без интернета.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type FeedRequest = { url: string; etag?: string | null; lastModified?: string | null };
/** 304: лента не менялась, тела нет */
export type FeedResponse = { status: number; body: string; etag?: string | null; lastModified?: string | null };
export type FeedTransport = (request: FeedRequest) => Promise<FeedResponse>;

/** Сколько ждём ответа одной ленты и сколько байт готовы прочитать */
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_FEED_BYTES = 5 * 1024 * 1024;
const RETRY_DELAY_MS = 1500;
const USER_AGENT = "Weekly Sravni news reader (RSS)";

let override: FeedTransport | null = null;

/** Подмена сети в тестах базы. null возвращает настоящий транспорт */
export function setNewsTransport(transport: FeedTransport | null): void {
  override = transport;
}

export class FeedError extends Error {
  constructor(
    message: string,
    /** Временная ошибка (сеть, таймаут, 5xx): стоит повторить */
    readonly transient: boolean,
  ) {
    super(message);
  }
}

/** Адрес ленты: только http и https, без внутренних адресов (ленты задаёт владелец, но проверка дешёвая) */
export function checkFeedUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return "Адрес ленты должен начинаться с http:// или https://";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "Адрес ленты должен начинаться с http:// или https://";
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "::1" || host.startsWith("[")) {
    return "Внутренние адреса в источники не добавляются";
  }
  if (u.username || u.password) return "Адрес ленты без логина и пароля";
  return null;
}

async function readLimited(response: Response): Promise<string> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_FEED_BYTES) throw new FeedError(`Лента слишком большая: ${Math.round(length / 1024 / 1024)} МБ`, false);
  const reader = response.body?.getReader();
  if (!reader) return await response.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FEED_BYTES) {
      await reader.cancel();
      throw new FeedError("Лента слишком большая: больше 5 МБ", false);
    }
    chunks.push(value);
  }
  return decode(Buffer.concat(chunks), response.headers.get("content-type"));
}

/** Кодировка из заголовка или из объявления XML; старые ленты бывают в windows-1251 */
function decode(bytes: Buffer, contentType: string | null): string {
  const head = bytes.subarray(0, 200).toString("latin1");
  const declared = /encoding=["']([\w-]+)["']/i.exec(head)?.[1] ?? /charset=([\w-]+)/i.exec(contentType ?? "")?.[1] ?? "utf-8";
  try {
    return new TextDecoder(declared.toLowerCase()).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

async function fetchOnce(request: FeedRequest): Promise<FeedResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" };
    if (request.etag) headers["if-none-match"] = request.etag;
    if (request.lastModified) headers["if-modified-since"] = request.lastModified;
    const response = await fetch(request.url, { headers, signal: controller.signal, redirect: "follow" });
    if (response.status === 304) return { status: 304, body: "", etag: request.etag, lastModified: request.lastModified };
    if (!response.ok) throw new FeedError(`Сервер ответил ${response.status}`, response.status >= 500 || response.status === 429);
    const body = await readLimited(response);
    return { status: response.status, body, etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") };
  } catch (error) {
    if (error instanceof FeedError) throw error;
    const e = error as { name?: string; message?: string; cause?: { code?: string } };
    if (e?.name === "AbortError") throw new FeedError(`Нет ответа за ${FETCH_TIMEOUT_MS / 1000} секунд`, true);
    throw new FeedError(`Нет связи${e?.cause?.code ? ` (${e.cause.code})` : ""}`, true);
  } finally {
    clearTimeout(timer);
  }
}

/** Режим фикстур для сквозных тестов: лента по имени хоста из tests/fixtures/news, иначе 404 */
async function fakeTransport(request: FeedRequest): Promise<FeedResponse> {
  const host = new URL(request.url).hostname.replace(/^www\./, "");
  try {
    const body = await readFile(join(process.cwd(), "tests", "fixtures", "news", `${host}.xml`), "utf8");
    return { status: 200, body };
  } catch {
    throw new FeedError("Сервер ответил 404", false);
  }
}

/** Забрать ленту: при временной ошибке один повтор через полторы секунды */
export async function fetchFeed(request: FeedRequest): Promise<FeedResponse> {
  if (override) return override(request);
  // Имитация только в тестах: в рабочем образе (NODE_ENV=production) лишь со сквозными тестами (WEEKLY_E2E=1), как у Notion и Claude этапа 61
  if (process.env.NEWS_FAKE === "1" && (process.env.NODE_ENV !== "production" || process.env.WEEKLY_E2E === "1")) return fakeTransport(request);
  try {
    return await fetchOnce(request);
  } catch (error) {
    if (!(error instanceof FeedError) || !error.transient) throw error;
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return fetchOnce(request);
  }
}
