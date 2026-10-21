// Забор ленты по сети (этап 60): таймаут, один повтор, предел размера, условные запросы.
// Тесты подменяют транспорт целиком (setNewsTransport), сеть по частям (setNewsNetwork: разрешение имени и запрос)
// или включают режим фикстур NEWS_FAKE=1: тогда вместо сети лента читается из tests/fixtures/news по имени хоста,
// и сквозные тесты идут без интернета. В боевом режиме (NODE_ENV=production) фикстуры работают только вместе
// с WEEKLY_E2E=1, который ставит playwright.config.ts.
//
// Защита от запросов во внутреннюю сеть (проверка 21.10). Адрес ленты задаёт владелец, но лента может
// переадресовать куда угодно, а имя может разрешаться во внутренний адрес. Поэтому на каждом шаге:
// - только http и https, только порты 80 и 443, без логина и пароля в адресе;
// - имена без точки, localhost, *.localhost, *.internal, *.local и *.home.arpa запрещены;
// - имя разрешается через DNS (все адреса, с таймаутом в пределах срока запроса), и если хоть один адрес
//   внутренний, забора нет. IPv4: запрещены loopback, частные сети, link-local, CGNAT, 0.0.0.0/8, служебные
//   и документационные, multicast и зарезервированные. IPv6 по белому списку: только глобальный unicast 2000::/3
//   без особых диапазонов (Teredo и протокольные 2001::/23, документация, 6to4); всё остальное (::1, fc00::/7,
//   fe80::/10, fec0::/10, 100::/64, IPv4 внутри IPv6, NAT64 и SIIT) не входит в белый список;
// - подключение идёт к уже проверенным адресам, второго разрешения имени нет (подмена DNS между проверкой
//   и подключением ничего не даст); если первый адрес недоступен, пробуется следующий проверенный;
// - переадресации вручную, не больше трёх, каждая проверяется так же.
// Тексты ошибок для владельца без подробностей сети: по ним нельзя прощупывать порты и узлы.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";

export type FeedRequest = { url: string; etag?: string | null; lastModified?: string | null };
/** 304: лента не менялась, тела нет */
export type FeedResponse = { status: number; body: string; etag?: string | null; lastModified?: string | null };
export type FeedTransport = (request: FeedRequest) => Promise<FeedResponse>;

/** Сколько ждём ответа одной ленты и сколько байт готовы прочитать */
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_FEED_BYTES = 5 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
const RETRY_DELAY_MS = 1500;
const USER_AGENT = "Weekly Sravni news reader (RSS)";

export const MESSAGES = {
  scheme: "Адрес ленты должен начинаться с http:// или https://",
  credentials: "Адрес ленты без логина и пароля",
  port: "Адрес не разрешён: только порты 80 и 443",
  internal: "Адрес не разрешён: внутренняя сеть",
  unavailable: "Источник недоступен",
  redirects: "Слишком много переадресаций",
  tooBig: "Лента слишком большая: больше 5 МБ",
  broken: "Ответ источника не прочитать",
  budget: "Не успели за общий срок прохода",
} as const;

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
    /** Забор оборван общим сроком прохода: это не сбой источника, он просто идёт в следующий час */
    readonly budget = false,
  ) {
    super(message);
  }
}

const budgetError = () => new FeedError(MESSAGES.budget, false, true);

// ---------- Адреса ----------

/** IPv4, куда ресурс не ходит */
const V4_BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  V4_BLOCKED.addSubnet(net, prefix, "ipv4");
}

/** IPv6 по белому списку: только глобальный unicast */
const V6_ALLOWED = new BlockList();
V6_ALLOWED.addSubnet("2000::", 3, "ipv6");
/** Особые диапазоны внутри 2000::/3 и вне его (вторые и так не в белом списке, перечислены для ясности) */
const V6_SPECIAL = new BlockList();
for (const [net, prefix] of [
  ["2001::", 23], // протокольные назначения IETF, в том числе Teredo 2001::/32
  ["2001:db8::", 32], // документация
  ["2002::", 16], // 6to4: внутри любой IPv4
  ["3fff::", 20], // документация
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48], // локальный NAT64
  ["::ffff:0:0", 96], // IPv4 внутри IPv6
  ["::ffff:0:0:0", 96], // SIIT ::ffff:0:a.b.c.d
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["100::", 64],
  ["ff00::", 8],
] as const) {
  V6_SPECIAL.addSubnet(net, prefix, "ipv6");
}

/** Адрес внутренний или служебный: туда ресурс не ходит */
export function addressBlocked(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const v = isIP(bare);
  if (v === 4) return V4_BLOCKED.check(bare, "ipv4");
  if (v === 6) {
    try {
      return !V6_ALLOWED.check(bare, "ipv6") || V6_SPECIAL.check(bare, "ipv6");
    } catch {
      return true;
    }
  }
  return true;
}

const BLOCKED_SUFFIXES = [".localhost", ".internal", ".local", ".home.arpa"];

function hostBlocked(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare)) return addressBlocked(bare);
  if (!host.includes(".")) return true;
  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return true;
  return false;
}

/** Проверка адреса без сети: схема, порт, логин, имя и адрес из самой строки. null: можно */
export function checkFeedUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return MESSAGES.scheme;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return MESSAGES.scheme;
  if (u.username || u.password) return MESSAGES.credentials;
  if (!u.hostname || hostBlocked(u.hostname)) return MESSAGES.internal;
  if (u.port && u.port !== "80" && u.port !== "443") return MESSAGES.port;
  return null;
}

// ---------- Сеть ----------

export type Resolved = { address: string; family: 4 | 6 };
export type Resolver = (host: string) => Promise<Resolved[]>;
export type RawResponse = { status: number; headers: { location?: string; etag?: string; lastModified?: string; contentType?: string }; body: Buffer };
/** address и family: первый проверенный адрес, addresses: все проверенные (для перебора при недоступном первом) */
export type RawRequest = { url: URL; address: string; family: 4 | 6; addresses: Resolved[]; headers: Record<string, string>; timeoutMs: number };
export type RawRequester = (request: RawRequest) => Promise<RawResponse>;

const systemResolver: Resolver = async (host) => {
  const list = await dnsLookup(host, { all: true, verbatim: true });
  return list.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
};

let network: { lookup: Resolver; request: RawRequester } | null = null;

/** Подмена разрешения имён и запроса в тестах защиты. null возвращает настоящую сеть */
export function setNewsNetwork(next: { lookup?: Resolver; request?: RawRequester } | null): void {
  network = next ? { lookup: next.lookup ?? systemResolver, request: next.request ?? nodeRequest } : null;
}

/**
 * Разрешить имя и проверить все его адреса. Внутренний адрес хоть один: отказ. Разрешение не дольше timeoutMs:
 * зависший DNS не съедает срок прохода. Обрыв по общему сроку отмечается отдельно (budget)
 */
async function resolvePublic(hostname: string, lookup: Resolver, timeoutMs: number, byBudget: boolean): Promise<Resolved[]> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(bare);
  if (literal) {
    if (addressBlocked(bare)) throw new FeedError(MESSAGES.internal, false);
    return [{ address: bare, family: literal === 6 ? 6 : 4 }];
  }
  let list: Resolved[];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    list = await Promise.race([
      lookup(bare),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(byBudget ? budgetError() : new FeedError(MESSAGES.unavailable, true)), Math.max(1, timeoutMs));
      }),
    ]);
  } catch (error) {
    if (error instanceof FeedError && error.budget) throw error;
    throw new FeedError(MESSAGES.unavailable, true);
  } finally {
    clearTimeout(timer);
  }
  if (!list.length) throw new FeedError(MESSAGES.unavailable, true);
  if (list.some((a) => addressBlocked(a.address))) throw new FeedError(MESSAGES.internal, false);
  return list;
}

const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Распаковать тело по Content-Encoding (в обратном порядке кодировок) с пределом на распакованный размер */
export function decompress(body: Buffer, contentEncoding: string | undefined): Buffer {
  const encodings = String(contentEncoding ?? "")
    .toLowerCase()
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e && e !== "identity");
  let out = body;
  const limit = { maxOutputLength: MAX_FEED_BYTES };
  for (const encoding of encodings.reverse()) {
    try {
      if (encoding === "gzip" || encoding === "x-gzip") out = zlib.gunzipSync(out, limit);
      else if (encoding === "br") out = zlib.brotliDecompressSync(out, limit);
      else if (encoding === "deflate") {
        // deflate бывает и с заголовком zlib, и голым (raw): пробуем оба
        try {
          out = zlib.inflateSync(out, limit);
        } catch (error) {
          if (error instanceof RangeError) throw error;
          out = zlib.inflateRawSync(out, limit);
        }
      } else throw new FeedError(MESSAGES.broken, false);
    } catch (error) {
      if (error instanceof FeedError) throw error;
      if (error instanceof RangeError || (error as { code?: string })?.code === "ERR_BUFFER_TOO_LARGE") throw new FeedError(MESSAGES.tooBig, false);
      throw new FeedError(MESSAGES.broken, false);
    }
  }
  return out;
}

/**
 * Запрос к уже проверенным адресам. Имя остаётся в заголовке Host и в TLS (проверка сертификата по имени),
 * а подключение идёт к проверенным адресам без нового разрешения имени: при запросе всех адресов (перебор
 * при недоступном первом) отдаются все проверенные. Тело читается с пределом и распаковывается
 */
export function nodeRequest({ url, address, family, addresses, headers, timeoutMs }: RawRequest): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const secure = url.protocol === "https:";
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const all = addresses?.length ? addresses : [{ address, family }];
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const req = (secure ? https : http).request(
      {
        method: "GET",
        hostname,
        port: url.port ? Number(url.port) : secure ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        headers: { ...headers, host: url.host },
        agent: false,
        servername: isIP(hostname) ? undefined : hostname,
        lookup: ((_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
          if (options?.all) callback(null, all.map((a) => ({ address: a.address, family: a.family })));
          else callback(null, all[0]!.address, all[0]!.family);
        }) as unknown as http.RequestOptions["lookup"],
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const out: RawResponse["headers"] = { location: header(res.headers.location), etag: header(res.headers.etag), lastModified: header(res.headers["last-modified"]), contentType: header(res.headers["content-type"]) };
        if (status < 200 || status >= 300) {
          res.destroy();
          finish(() => resolve({ status, headers: out, body: Buffer.alloc(0) }));
          return;
        }
        if (Number(res.headers["content-length"] ?? 0) > MAX_FEED_BYTES) {
          res.destroy();
          finish(() => reject(new FeedError(MESSAGES.tooBig, false)));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_FEED_BYTES) {
            res.destroy();
            finish(() => reject(new FeedError(MESSAGES.tooBig, false)));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          finish(() => {
            try {
              resolve({ status, headers: out, body: decompress(Buffer.concat(chunks), header(res.headers["content-encoding"])) });
            } catch (error) {
              reject(error);
            }
          }),
        );
        res.on("error", () => finish(() => reject(new FeedError(MESSAGES.unavailable, true))));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish(() => reject(new FeedError(MESSAGES.unavailable, true)));
    }, Math.max(1, timeoutMs));
    req.on("error", () => finish(() => reject(new FeedError(MESSAGES.unavailable, true))));
    req.end();
  });
}

/**
 * Текст ленты из байтов. Кодировка: метка BOM (UTF-8, UTF-16), объявление XML, charset заголовка (в кавычках тоже),
 * иначе UTF-8. Старые ленты бывают в windows-1251
 */
export function decode(bytes: Buffer, contentType: string | null | undefined): string {
  const bom = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? "utf-8" : null;
  const head = bytes.subarray(0, 200).toString("latin1");
  const declared = bom ?? /encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1] ?? /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? "")?.[1] ?? "utf-8";
  try {
    return new TextDecoder(declared.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Один забор с переадресациями: каждый шаг проверяется и подключается к проверенному адресу */
async function fetchOnce(request: FeedRequest, deadline: number): Promise<FeedResponse> {
  const net = network ?? { lookup: systemResolver, request: nodeRequest };
  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
    "accept-encoding": "gzip, deflate, br",
  };
  if (request.etag) headers["if-none-match"] = request.etag;
  if (request.lastModified) headers["if-modified-since"] = request.lastModified;
  let url = request.url.trim();
  const started = Date.now();
  // Сколько осталось этому запросу: свой таймаут или общий срок прохода, что раньше. byBudget: режет общий срок
  const window = () => {
    const own = started + FETCH_TIMEOUT_MS - Date.now();
    const pass = deadline - Date.now();
    return { left: Math.min(own, pass), byBudget: pass <= own };
  };
  for (let hop = 0; ; hop++) {
    const problem = checkFeedUrl(url);
    if (problem) throw new FeedError(problem, false);
    const u = new URL(url);
    let w = window();
    if (w.left <= 0) throw w.byBudget ? budgetError() : new FeedError(MESSAGES.unavailable, true);
    const targets = await resolvePublic(u.hostname, net.lookup, w.left, w.byBudget);
    w = window();
    if (w.left <= 0) throw w.byBudget ? budgetError() : new FeedError(MESSAGES.unavailable, true);
    let res: RawResponse;
    try {
      res = await net.request({ url: u, address: targets[0]!.address, family: targets[0]!.family, addresses: targets, headers, timeoutMs: w.left });
    } catch (error) {
      // Запрос оборвал общий срок прохода, а не источник: это не сбой
      if (w.byBudget && Date.now() >= deadline - 50) throw budgetError();
      throw error;
    }
    if (REDIRECTS.has(res.status)) {
      if (hop >= MAX_REDIRECTS) throw new FeedError(MESSAGES.redirects, false);
      if (!res.headers.location) throw new FeedError(`Сервер ответил ${res.status}`, false);
      try {
        url = new URL(res.headers.location, u).toString();
      } catch {
        throw new FeedError(MESSAGES.scheme, false);
      }
      continue;
    }
    if (res.status === 304) return { status: 304, body: "", etag: request.etag, lastModified: request.lastModified };
    if (res.status < 200 || res.status >= 300) throw new FeedError(`Сервер ответил ${res.status}`, res.status >= 500 || res.status === 429);
    return { status: res.status, body: decode(res.body, res.headers.contentType), etag: res.headers.etag ?? null, lastModified: res.headers.lastModified ?? null };
  }
}

/** Фикстуры вместо сети: в разработке и тестах, в боевом режиме только для сквозных тестов */
export function fakeFeedsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEWS_FAKE === "1" && (env.NODE_ENV !== "production" || env.WEEKLY_E2E === "1");
}

/** Режим фикстур для сквозных тестов: лента по имени хоста из tests/fixtures/news, иначе 404 */
async function fakeTransport(request: FeedRequest): Promise<FeedResponse> {
  const host = new URL(request.url).hostname.replace(/^www\./, "");
  if (!/^[a-z0-9.-]+$/i.test(host)) throw new FeedError("Сервер ответил 404", false);
  try {
    const body = await readFile(join(process.cwd(), "tests", "fixtures", "news", `${host}.xml`), "utf8");
    return { status: 200, body };
  } catch {
    throw new FeedError("Сервер ответил 404", false);
  }
}

/**
 * Забрать ленту: при временной ошибке один повтор через полторы секунды, если осталось время.
 * deadline: момент (мс), после которого забор не начинается и не продолжается (общий срок прохода)
 */
export async function fetchFeed(request: FeedRequest, options: { deadline?: number } = {}): Promise<FeedResponse> {
  if (override) return override(request);
  if (fakeFeedsOn()) return fakeTransport(request);
  const deadline = options.deadline ?? Date.now() + 2 * FETCH_TIMEOUT_MS + RETRY_DELAY_MS;
  try {
    return await fetchOnce(request, deadline);
  } catch (error) {
    if (!(error instanceof FeedError) || !error.transient) throw error instanceof FeedError ? error : new FeedError(MESSAGES.unavailable, true);
    if (deadline - Date.now() < RETRY_DELAY_MS + 2000) throw error;
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return fetchOnce(request, deadline);
  }
}
