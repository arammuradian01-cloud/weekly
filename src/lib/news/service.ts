// Новости по продуктам и дайджесты (этап 60). Решение Арама 21.10.
//
// Как устроено:
// - источники: публичные ленты RSS и Atom, список ведёт владелец в «Настройках». Забор раз в час в своём минутном
//   цикле со своей арендой (src/lib/news/loop.ts), а не в цикле писем: долгий забор не задерживает напоминания.
//   Общий срок забора 90 секунд на проход, остальные источники в следующий час. Каждая лента со своим таймаутом
//   и одним повтором, ошибка одной ленты не трогает остальные и видна владельцу; источник с ошибками опрашивается
//   реже (2, 4, 8 часов, не реже раза в сутки);
// - новость хранится как заголовок, дата, источник, ссылка, продукты и короткое описание. Статьи целиком не храним.
//   Дубли отсеиваются по адресу статьи (один на все ленты) и по идентификатору записи в ленте;
// - привязка к продуктам по ключевым словам из настроек. Если в окружении есть ANTHROPIC_API_KEY, привязка и описание
//   уточняются через Claude API отдельным проходом; без ключа всё работает по правилам;
// - дайджест: ежедневный по будням утром и еженедельный в понедельник, окно 8:00-12:00 по Москве. Ежедневный
//   собирает всё с прошлого непустого дайджеста человека (не дальше 7 дней): в понедельник приходят и новости
//   пятницы и выходных. Еженедельный, пропущенный в понедельник (сервер лежал), уходит первым проходом позже
//   на неделе, по будням с 8:00 до 20:00, если цикл работал до конца понедельничного окна и у человека был
//   еженедельный за прошлую неделю. Один на человека и период, в «Мне» тихим событием (без счётчика)
//   и письмом, если почта настроена. Пустой дайджест не отправляется. Продукты и частоту человек выбирает в профиле;
//   по умолчанию дайджест выключен (решение Арама 22.10), продукты своего направления;
// - очистка раз в сутки: новости старше 180 дней, дайджесты старше 90, пустые еженедельные старше 15.

import { prisma } from "@/lib/db";
import type { NewsDigestKind, Prisma } from "@/generated/prisma/client";
import { mailConfigured, sendMail } from "@/lib/mail";
import { isTransportDown } from "@/lib/letters/service";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { isoWeekOf, isoWeekday, moscowDate, moscowDateTime, type CalendarDate } from "@/lib/week";
import { plural } from "@/domain/dates";
import { parseFeed, urlKeyOf } from "./feed";
import { FeedError, checkFeedUrl, fetchFeed, type FeedResponse } from "./transport";
import { KEYWORDS_KEY, keywordsOf, normalizeKeywords, parseKeywordLine } from "./keywords";
import { matchDirections, ruleSummary, withoutOwnName } from "./match";
import { NEWS_FREQUENCY_LABELS, directionsFor, newsPrefsOf, type NewsFrequency, type NewsPrefs } from "./prefs";
import { BATCH, TIMEOUT_MS as CLAUDE_TIMEOUT_MS, claudeConfigured, claudeModel, enrichWithClaude, narrowDirections, safeErrorMessage } from "./claude";
import { DEFAULT_SOURCES } from "./sources";

type Db = Prisma.TransactionClient | typeof prisma;

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

const requireOwner = (actor: Actor, what: string) => {
  if (actor.management !== "OWNER" || actor.role === "OBSERVER") fail(`${what} настраивает владелец в режиме управления`);
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Раз в час: следующий забор не раньше чем через 55 минут после прошлого */
export const FETCH_EVERY_MS = 55 * 60_000;
/** Общий срок забора лент за проход: что не успели, заберём в следующий час */
export const FETCH_BUDGET_MS = 90_000;
/** Общий срок уточнения через Claude за проход и сколько пачек берём */
export const ENRICH_BUDGET_MS = 120_000;
const ENRICH_BATCHES = 4;
const LAST_FETCH_KEY = "news.lastFetchAt";
const SEEDED_KEY = "news.sources.seeded";
const CLAUDE_STATUS_KEY = "news.claude.status";
const CLEANUP_KEY = "news.cleanupAt";
/** Первый проход цикла новостей на этом стенде: догоняющий еженедельный только за недели, когда цикл уже работал */
export const LOOP_STARTED_KEY = "news.loop.startedAt";
/** Забор вручную из настроек: идёт ли и чем кончился последний */
const MANUAL_FETCH_KEY = "news.manualFetch";
/** Источник не начинаем, если до конца общего срока прохода меньше 20 секунд */
export const MIN_SOURCE_LEFT_MS = 20_000;
/** Сколько лент скачиваем одновременно: разные сайты, по одному запросу на каждый. 13 лент в худшем случае
 * (таймаут и повтор у каждой) укладываются в общий срок прохода */
export const FETCH_PARALLEL = 4;
/** Записи старше этого при заборе не берутся: первый забор архивной ленты не тянет прошлогоднее */
const MAX_ITEM_AGE_MS = 30 * DAY_MS;
/** Дата из будущего больше чем на 5 минут: часы ленты врут, ставим время забора */
const FUTURE_SLACK_MS = 5 * 60_000;
/** Окно дайджеста по Москве: с 8:00 до 12:00, позже не шлём, утро прошло */
export const DIGEST_WINDOW = { start: 8, end: 12 };
/** Пропущенный в понедельник еженедельный дайджест догоняет по будням с 8:00 до 20:00 */
export const WEEKLY_CATCH_UP = { start: 8, end: 20 };
const DIGEST_MAX_ITEMS = 40;
/** Ежедневный: с прошлого непустого дайджеста, но не дальше 7 дней; без дайджестов последние 36 часов */
const DAILY_CAP_MS = 7 * DAY_MS;
/**
 * Нижняя граница выборки с запасом: новость, сохранённая в том же проходе, что и прошлый дайджест (или «Забрать
 * сейчас» параллельно), не теряется. Повторов нет: новости из дайджестов человека за 8 дней исключаются
 */
const SINCE_OVERLAP_MS = 15 * 60_000;
const SENT_LOOKBACK_MS = 8 * DAY_MS;
const DAILY_FIRST_MS = 36 * HOUR_MS;
const WEEKLY_SPAN_MS = 7 * DAY_MS + 12 * HOUR_MS;
/** Письмо дайджеста, которое не ушло, повторяется шесть часов */
const MAIL_RETRY_MS = 6 * HOUR_MS;
/** Сроки хранения */
export const KEEP = { itemsDays: 180, digestsDays: 90, emptyDigestsDays: 15 };

function appUrl(): string {
  return (process.env.APP_URL ?? "").replace(/\/+$/, "");
}

// ---------- Направления ----------

export type NewsDirection = { code: string; label: string; active: boolean };

/** Продукты для новостей: справочник направлений без «Департамента» (к нему новости не привязываются) */
export async function newsDirections(db: Db = prisma): Promise<NewsDirection[]> {
  const rows = await db.dictionaryItem.findMany({ where: { kind: "DIRECTION", code: { not: "department" } }, orderBy: { sortOrder: "asc" }, select: { code: true, label: true, active: true } });
  return rows;
}

// ---------- Ключевые слова ----------

export async function loadKeywords(db: Db = prisma): Promise<Record<string, string[]>> {
  const [row, directions] = await Promise.all([db.setting.findUnique({ where: { key: KEYWORDS_KEY } }), newsDirections(db)]);
  return keywordsOf(row?.value, directions.map((d) => d.code));
}

/** Сохранить ключевые слова по продуктам: владелец, каждая правка в журнале строкой на продукт */
export async function saveKeywords(actor: Actor, input: Record<string, string | string[]>): Promise<Record<string, string[]>> {
  requireOwner(actor, "Ключевые слова новостей");
  const directions = await newsDirections();
  const before = await loadKeywords();
  const next: Record<string, string[]> = { ...before };
  for (const d of directions) {
    const v = input?.[d.code];
    if (v === undefined) continue;
    next[d.code] = Array.isArray(v) ? normalizeKeywords(v) : parseKeywordLine(String(v));
  }
  await prisma.$transaction(async (tx) => {
    await tx.setting.upsert({ where: { key: KEYWORDS_KEY }, update: { value: next }, create: { key: KEYWORDS_KEY, value: next } });
    for (const d of directions) {
      const a = (before[d.code] ?? []).join(", ");
      const b = (next[d.code] ?? []).join(", ");
      if (a === b) continue;
      await tx.auditLog.create({
        data: { action: "settings.news.keywords", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "settings", entityId: KEYWORDS_KEY, field: `Ключевые слова: ${d.label}`, before: a, after: b, ip: actor.ip ?? null, via: actor.via ?? null },
      });
    }
  });
  return next;
}

// ---------- Источники ----------

export type SourceStatus = "ok" | "error" | "off" | "new";
export type SourceView = {
  id: string;
  name: string;
  url: string;
  active: boolean;
  /** Строгая привязка: два признака продукта (общие деловые ленты) */
  strict: boolean;
  status: SourceStatus;
  lastFetchAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastCount: number;
  failCount: number;
  items: number;
};

function statusOf(s: { active: boolean; lastFetchAt: Date | null; lastError: string | null }): SourceStatus {
  if (!s.active) return "off";
  if (!s.lastFetchAt) return "new";
  return s.lastError ? "error" : "ok";
}

export async function listSources(): Promise<SourceView[]> {
  const rows = await prisma.newsSource.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { _count: { select: { items: true } } } });
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    url: s.url,
    active: s.active,
    strict: s.strict,
    status: statusOf(s),
    lastFetchAt: s.lastFetchAt?.toISOString() ?? null,
    lastOkAt: s.lastOkAt?.toISOString() ?? null,
    lastError: s.lastError,
    lastCount: s.lastCount,
    failCount: s.failCount,
    items: s._count.items,
  }));
}

export type SourceInput = { name: string; url: string; strict?: boolean };

/**
 * Название и адрес. Адрес проверяется без сети: схема, порты 80 и 443, внутренние имена и адреса. Разрешение
 * имени и та же проверка его адресов идут при каждом заборе (transport.ts)
 */
function checkSourceInput(input: { name?: unknown; url?: unknown; strict?: unknown }): { name: string; url: string; strict: boolean } {
  const name = String(input?.name ?? "").replace(/\s+/g, " ").trim();
  const url = String(input?.url ?? "").trim();
  if (!name) fail("Дайте источнику название");
  if (name.length > 120) fail("Название источника не длиннее 120 знаков");
  if (url.length > 1000) fail("Адрес ленты слишком длинный");
  const problem = checkFeedUrl(url);
  if (problem) fail(problem);
  return { name, url, strict: input?.strict === true };
}

const strictLabel = (v: boolean) => (v ? "два признака" : "один признак");

async function sourceAudit(tx: Db, actor: Actor, id: string, field: string, before: string, after: string) {
  await tx.auditLog.create({
    data: { action: "settings.news.source", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "news_source", entityId: id, field, before, after, ip: actor.ip ?? null, via: actor.via ?? null },
  });
}

export async function addSource(actor: Actor, input: SourceInput): Promise<SourceView> {
  requireOwner(actor, "Источники новостей");
  const { name, url, strict } = checkSourceInput(input);
  if (await prisma.newsSource.findUnique({ where: { url } })) fail("Такая лента уже есть в списке");
  const max = await prisma.newsSource.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.$transaction(async (tx) => {
    const s = await tx.newsSource.create({ data: { name, url, strict, sortOrder: (max._max.sortOrder ?? 0) + 10 } });
    await sourceAudit(tx, actor, s.id, "Источник", "", `${name}: ${url}${strict ? ", привязка по двум признакам" : ""}`);
    return s;
  });
  return { ...created, status: "new", lastFetchAt: null, lastOkAt: null, items: 0 };
}

export async function updateSource(actor: Actor, id: string, input: SourceInput): Promise<void> {
  requireOwner(actor, "Источники новостей");
  const { name, url, strict } = checkSourceInput(input);
  const s = await prisma.newsSource.findUnique({ where: { id } });
  if (!s) return fail("Источника уже нет");
  const other = await prisma.newsSource.findUnique({ where: { url } });
  if (other && other.id !== id) fail("Такая лента уже есть в списке");
  await prisma.$transaction(async (tx) => {
    // Новый адрес: условные заголовки прошлой ленты не годятся
    const sameUrl = s.url === url;
    await tx.newsSource.update({ where: { id }, data: { name, url, strict, ...(sameUrl ? {} : { etag: null, lastModified: null, lastError: null, failCount: 0 }) } });
    if (s.name !== name) await sourceAudit(tx, actor, id, "Название источника", s.name, name);
    if (!sameUrl) await sourceAudit(tx, actor, id, "Адрес ленты", s.url, url);
    if (s.strict !== strict) await sourceAudit(tx, actor, id, `Привязка к продукту: ${name}`, strictLabel(s.strict), strictLabel(strict));
  });
}

export async function setSourceActive(actor: Actor, id: string, active: boolean): Promise<void> {
  requireOwner(actor, "Источники новостей");
  const s = await prisma.newsSource.findUnique({ where: { id } });
  if (!s) return fail("Источника уже нет");
  if (s.active === active) return;
  await prisma.$transaction(async (tx) => {
    await tx.newsSource.update({ where: { id }, data: { active } });
    await sourceAudit(tx, actor, id, `Источник ${s.name}`, s.active ? "включён" : "выключен", active ? "включён" : "выключен");
  });
}

/** Удалить источник вместе с его новостями: для ошибочно добавленной ленты. Обычно достаточно выключить */
export async function removeSource(actor: Actor, id: string): Promise<void> {
  requireOwner(actor, "Источники новостей");
  const s = await prisma.newsSource.findUnique({ where: { id }, include: { _count: { select: { items: true } } } });
  if (!s) return;
  await prisma.$transaction(async (tx) => {
    await tx.newsSource.delete({ where: { id } });
    await sourceAudit(tx, actor, id, "Источник удалён", `${s.name}: ${s.url}, новостей ${s._count.items}`, "");
  });
}

/** Стартовый список источников один раз в пустую таблицу: сид зовёт это при каждом запуске, повтор ничего не делает */
export async function seedSources(db: Db = prisma): Promise<number> {
  if (await db.setting.findUnique({ where: { key: SEEDED_KEY } })) return 0;
  if ((await db.newsSource.count()) > 0) {
    await db.setting.upsert({ where: { key: SEEDED_KEY }, update: {}, create: { key: SEEDED_KEY, value: true } });
    return 0;
  }
  await db.newsSource.createMany({ data: DEFAULT_SOURCES.map((s, i) => ({ name: s.name, url: s.url, strict: s.strict ?? false, sortOrder: (i + 1) * 10 })), skipDuplicates: true });
  await db.setting.upsert({ where: { key: SEEDED_KEY }, update: {}, create: { key: SEEDED_KEY, value: true } });
  return DEFAULT_SOURCES.length;
}

// ---------- Забор ----------

export type FetchResult = { sourceId: string; name: string; ok: boolean; added: number; total: number; error: string | null; postponed?: boolean };
/** Итог прохода забора: забранные ленты и сколько отложено до следующего часа (кончился общий срок) */
export type FetchPass = { results: FetchResult[]; postponed: number };

type SourceRow = { id: string; name: string; url: string; strict: boolean; etag: string | null; lastModified: string | null; lastCount: number };

/** Новости одной ленты к продуктам: без названия самой ленты в признаках, строгая привязка для общих лент */
function directionsOf(source: SourceRow, item: { title: string; description: string }, keywords: Record<string, string[]>, order: string[]): string[] {
  return matchDirections(item, withoutOwnName(keywords, source), order, { strict: source.strict });
}

/** Через сколько опрашивать источник с ошибками: после второй подряд 2 часа, дальше вдвое дольше, не реже раза в сутки */
export function retryIntervalMs(failCount: number): number {
  return failCount <= 1 ? 0 : Math.min(2 ** (failCount - 1), 24) * HOUR_MS;
}

/** Пора ли забирать источник: исправный каждый час, с ошибками реже. Пять минут запаса на дрожание цикла */
export function sourceDue(s: { lastFetchAt: Date | null; failCount: number }, now: Date): boolean {
  if (!s.lastFetchAt || s.failCount <= 1) return true;
  return now.getTime() - s.lastFetchAt.getTime() >= retryIntervalMs(s.failCount) - 5 * 60_000;
}

/** Сайт ленты для очереди забора: www. не считается, адрес с ошибкой сам по себе */
export function hostKey(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Скачанная лента или ошибка сети: скачивание идёт параллельно, сохранение по порядку списка источников */
type Download = { ok: true; response: FeedResponse } | { ok: false; error: unknown };

async function download(source: SourceRow, deadline?: number): Promise<Download> {
  try {
    return { ok: true, response: await fetchFeed({ url: source.url, etag: source.etag, lastModified: source.lastModified }, { deadline }) };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Забрать одну ленту: скачать и сохранить */
export async function fetchSource(source: SourceRow, keywords: Record<string, string[]>, order: string[], now = new Date(), deadline?: number): Promise<FetchResult> {
  return storeSource(source, await download(source, deadline), keywords, order, now);
}

/** Сохранить скачанную ленту. Любая ошибка остаётся в источнике и не поднимается наверх: остальные ленты идут своим чередом */
async function storeSource(source: SourceRow, got: Download, keywords: Record<string, string[]>, order: string[], now: Date): Promise<FetchResult> {
  try {
    if (!got.ok) throw got.error;
    const response = got.response;
    if (response.status === 304) {
      await prisma.newsSource.update({ where: { id: source.id }, data: { lastFetchAt: now, lastOkAt: now, lastError: null, failCount: 0 } });
      return { sourceId: source.id, name: source.name, ok: true, added: 0, total: source.lastCount, error: null };
    }
    const feed = parseFeed(response.body);
    if (!feed.items.length && !/<(rss|feed|rdf)[\s>]/i.test(response.body.slice(0, 4096))) throw new FeedError("По адресу не лента RSS или Atom", false);
    const minPublished = now.getTime() - MAX_ITEM_AGE_MS;
    const seen = new Set<string>();
    const rows = feed.items
      .map((i) => {
        const published = i.publishedAt ?? now;
        // Будущие даты в кривых лентах: дальше пяти минут вперёд берём время забора
        return { guid: i.guid.slice(0, 500), urlKey: urlKeyOf(i.url).slice(0, 1000), url: i.url.slice(0, 2000), title: i.title, description: i.description, publishedAt: published.getTime() > now.getTime() + FUTURE_SLACK_MS ? now : published };
      })
      .filter((r) => {
        if (r.publishedAt.getTime() < minPublished) return false;
        const key = `${r.urlKey}|${r.guid}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((r) => ({ ...r, directions: directionsOf(source, r, keywords, order) }))
      .filter((r) => r.directions.length > 0);
    let added = 0;
    if (rows.length) {
      const existing = await prisma.newsItem.findMany({
        where: { OR: [{ urlKey: { in: rows.map((r) => r.urlKey) } }, { sourceId: source.id, guid: { in: rows.map((r) => r.guid) } }] },
        select: { urlKey: true, guid: true, sourceId: true },
      });
      const knownUrl = new Set(existing.map((e) => e.urlKey));
      const knownGuid = new Set(existing.filter((e) => e.sourceId === source.id).map((e) => e.guid));
      const fresh = rows.filter((r) => !knownUrl.has(r.urlKey) && !knownGuid.has(r.guid));
      if (fresh.length) {
        // skipDuplicates закрывает гонку двух процессов: уникальные индексы по адресу и по ленте с guid.
        // createdAt: фактическое время вставки, а не начало прохода. Дайджест того же прохода уже записан со своим
        // временем, и новость должна попасть в следующий
        const insertedAt = new Date();
        const created = await prisma.newsItem.createMany({
          data: fresh.map((r) => ({ sourceId: source.id, guid: r.guid, urlKey: r.urlKey, url: r.url, title: r.title, summary: ruleSummary(r), publishedAt: r.publishedAt, directions: r.directions, createdAt: insertedAt })),
          skipDuplicates: true,
        });
        added = created.count;
      }
    }
    await prisma.newsSource.update({
      where: { id: source.id },
      data: { lastFetchAt: now, lastOkAt: now, lastError: null, failCount: 0, lastCount: feed.items.length, etag: response.etag ?? null, lastModified: response.lastModified ?? null },
    });
    return { sourceId: source.id, name: source.name, ok: true, added, total: feed.items.length, error: null };
  } catch (error) {
    // Оборвал общий срок прохода: не сбой источника, счётчик не растёт, ошибка не показывается, заберём в следующий час
    if (error instanceof FeedError && error.budget) return { sourceId: source.id, name: source.name, ok: false, added: 0, total: 0, error: null, postponed: true };
    // Владельцу только наши тексты ошибок: подробности сети остаются в журнале сервера
    const message = error instanceof FeedError ? error.message : "Источник недоступен";
    if (!(error instanceof FeedError)) console.error("Забор ленты не прошёл:", source.name, error instanceof Error ? error.message : error);
    await prisma.newsSource.update({ where: { id: source.id }, data: { lastFetchAt: now, lastError: message.slice(0, 500), failCount: { increment: 1 } } }).catch(() => undefined);
    return { sourceId: source.id, name: source.name, ok: false, added: 0, total: 0, error: message };
  }
}

/**
 * Проход забора: включённые ленты, дольше всех не забиравшиеся первыми, скачиваются до FETCH_PARALLEL сайтов
 * одновременно; ленты одного сайта идут друг за другом. Сохраняются строго по порядку списка источников: перепечатку
 * (тот же адрес статьи) в пределах прохода получает источник выше в списке, обычно первоисточник, кто бы ни ответил
 * быстрее. Статья, сохранённая в прошлых проходах, остаётся у своего источника.
 * Общий срок budgetMs: что не успели, заберём в следующий час. force (вручную из настроек): и источники с ошибками,
 * не дожидаясь их интервала. parallel только для тестов
 */
export async function fetchPass(now = new Date(), options: { budgetMs?: number; force?: boolean; minLeftMs?: number; parallel?: number } = {}): Promise<FetchPass> {
  const deadline = Date.now() + (options.budgetMs ?? FETCH_BUDGET_MS);
  const minLeft = options.minLeftMs ?? MIN_SOURCE_LEFT_MS;
  const [sources, keywords, directions] = await Promise.all([
    prisma.newsSource.findMany({
      where: { active: true },
      orderBy: [{ lastFetchAt: { sort: "asc", nulls: "first" } }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, url: true, strict: true, etag: true, lastModified: true, lastCount: true, lastFetchAt: true, failCount: true, sortOrder: true, createdAt: true },
    }),
    loadKeywords(),
    newsDirections(),
  ]);
  const order = directions.filter((d) => d.active).map((d) => d.code);
  const due = options.force ? sources : sources.filter((s) => sourceDue(s, now));
  // Ленты одного сайта в одной очереди: к одному сайту не больше одного запроса за раз
  const queues = new Map<string, number[]>();
  due.forEach((s, i) => {
    const host = hostKey(s.url);
    const queue = queues.get(host);
    if (queue) queue.push(i);
    else queues.set(host, [i]);
  });
  const groups = [...queues.values()];
  const downloads: (Download | undefined)[] = new Array(due.length);
  let next = 0;
  const parallel = Math.max(1, options.parallel ?? FETCH_PARALLEL);
  await Promise.all(
    Array.from({ length: Math.min(parallel, groups.length) }, async () => {
      while (next < groups.length) {
        const group = groups[next++]!;
        for (const i of group) {
          // Меньше 20 секунд до конца срока: лента не успеет, начинать не стоит
          if (deadline - Date.now() < minLeft) continue;
          downloads[i] = await download(due[i]!, deadline);
        }
      }
    }),
  );
  const listed = due
    .map((source, i) => ({ source, got: downloads[i] }))
    .sort((a, b) => a.source.sortOrder - b.source.sortOrder || a.source.createdAt.getTime() - b.source.createdAt.getTime());
  const results: FetchResult[] = [];
  let postponed = 0;
  for (const { source, got } of listed) {
    if (!got) {
      postponed += 1;
      continue;
    }
    const r = await storeSource(source, got, keywords, order, now);
    if (r.postponed) postponed += 1;
    else results.push(r);
  }
  await prisma.setting.upsert({ where: { key: LAST_FETCH_KEY }, update: { value: now.toISOString() }, create: { key: LAST_FETCH_KEY, value: now.toISOString() } });
  return { results, postponed };
}

/** Забрать все ленты, которым пора. Результат по каждой забранной */
export async function fetchAll(now = new Date(), options: { budgetMs?: number; force?: boolean; minLeftMs?: number; parallel?: number } = {}): Promise<FetchResult[]> {
  return (await fetchPass(now, options)).results;
}

export async function lastFetchAt(): Promise<Date | null> {
  const row = await prisma.setting.findUnique({ where: { key: LAST_FETCH_KEY } });
  return typeof row?.value === "string" ? new Date(row.value) : null;
}

/** Раз в час из цикла новостей. true: забор был */
export async function fetchIfDue(now = new Date(), options: { budgetMs?: number } = {}): Promise<boolean> {
  const last = await lastFetchAt();
  if (last && now.getTime() - last.getTime() < FETCH_EVERY_MS) return false;
  await fetchPass(now, options);
  return true;
}

export type ManualFetchState = { running: boolean; startedAt: string | null; finishedAt: string | null; by: string | null; results: number; added: number; failed: number; postponed: number };

/** Состояние «Забрать сейчас» для настроек: идёт ли забор и итог последнего */
export async function manualFetchState(): Promise<ManualFetchState | null> {
  const row = await prisma.setting.findUnique({ where: { key: MANUAL_FETCH_KEY } });
  const v = row?.value && typeof row.value === "object" ? (row.value as Partial<ManualFetchState>) : null;
  if (!v) return null;
  // Забор, начатый больше 10 минут назад и не закончившийся (процесс перезапустили), уже не идёт
  const stale = v.running && v.startedAt && Date.now() - new Date(v.startedAt).getTime() > 10 * 60_000;
  return { running: !!v.running && !stale, startedAt: v.startedAt ?? null, finishedAt: v.finishedAt ?? null, by: v.by ?? null, results: v.results ?? 0, added: v.added ?? 0, failed: v.failed ?? 0, postponed: v.postponed ?? 0 };
}

/**
 * «Забрать сейчас» из настроек: владелец. Только отмечает начало и сразу отвечает экрану, сам забор идёт после
 * ответа (runFetchNow через after). Второй запуск, пока идёт первый, не начинается
 */
export async function startFetchNow(actor: Actor): Promise<{ started: true }> {
  requireOwner(actor, "Источники новостей");
  const state = await manualFetchState();
  if (state?.running) fail("Забор уже идёт: итог появится здесь и в журнале");
  const value = { running: true, startedAt: new Date().toISOString(), finishedAt: state?.finishedAt ?? null, by: actor.fullName, results: state?.results ?? 0, added: state?.added ?? 0, failed: state?.failed ?? 0, postponed: state?.postponed ?? 0 };
  await prisma.setting.upsert({ where: { key: MANUAL_FETCH_KEY }, update: { value }, create: { key: MANUAL_FETCH_KEY, value } });
  return { started: true };
}

/** Сам забор вручную: все включённые ленты с тем же общим сроком, уточнение, итог в настройках и журнале */
export async function runFetchNow(actor: Actor): Promise<FetchPass> {
  let pass: FetchPass = { results: [], postponed: 0 };
  try {
    pass = await fetchPass(new Date(), { force: true });
    await enrichPass(new Date(), { budgetMs: 45_000 });
  } finally {
    const { results } = pass;
    const added = results.reduce((n, r) => n + r.added, 0);
    const failed = results.filter((r) => !r.ok).length;
    const value = { running: false, startedAt: null, finishedAt: new Date().toISOString(), by: actor.fullName, results: results.length, added, failed, postponed: pass.postponed };
    await prisma.setting.upsert({ where: { key: MANUAL_FETCH_KEY }, update: { value }, create: { key: MANUAL_FETCH_KEY, value } });
    await prisma.auditLog.create({
      data: {
        action: "settings.news.fetch",
        actorId: actor.personId,
        actorName: actor.fullName,
        source: "APP",
        entity: "settings",
        entityId: LAST_FETCH_KEY,
        field: "Забор новостей вручную",
        before: "",
        after: `лент ${results.length}, с ошибкой ${failed}, новых новостей ${added}${pass.postponed ? `, отложено до следующего часа ${pass.postponed}` : ""}`,
        ip: actor.ip ?? null,
        via: actor.via ?? null,
      },
    });
  }
  return pass;
}

/** Забор вручную целиком, в одном вызове: для тестов и скриптов */
export async function fetchNow(actor: Actor): Promise<FetchPass> {
  await startFetchNow(actor);
  return runFetchNow(actor);
}

// ---------- Уточнение через Claude ----------

type ClaudeStatusRow = { lastOkAt?: string; lastErrorAt?: string; lastError?: string };

async function saveClaudeStatus(patch: ClaudeStatusRow): Promise<void> {
  const row = await prisma.setting.findUnique({ where: { key: CLAUDE_STATUS_KEY } });
  const before = row?.value && typeof row.value === "object" ? (row.value as ClaudeStatusRow) : {};
  const value = { ...before, ...patch };
  await prisma.setting.upsert({ where: { key: CLAUDE_STATUS_KEY }, update: { value }, create: { key: CLAUDE_STATUS_KEY, value } });
}

/**
 * Свежие новости, которые ещё не уточнялись: через Claude, если ключ задан, иначе помечаются «по правилам».
 * Пачки по 5 новостей, не больше четырёх за проход и в пределах общего срока. Модель только сужает продукты правил.
 * Ошибка API: новости остаются как есть и попробуются в следующий час, текст ошибки виден владельцу
 */
export async function enrichPass(now = new Date(), options: { budgetMs?: number } = {}): Promise<number> {
  const recent = new Date(now.getTime() - 3 * DAY_MS);
  if (!claudeConfigured()) {
    const r = await prisma.newsItem.updateMany({ where: { enrichedBy: null }, data: { enrichedBy: "rules", enrichedAt: now } });
    return r.count;
  }
  const deadline = Date.now() + (options.budgetMs ?? ENRICH_BUDGET_MS);
  // Старое не уточняем: пометка «по правилам», чтобы очередь не копилась
  await prisma.newsItem.updateMany({ where: { enrichedBy: null, createdAt: { lt: recent } }, data: { enrichedBy: "rules", enrichedAt: now } });
  const [pending, keywords, directions] = await Promise.all([
    prisma.newsItem.findMany({ where: { enrichedBy: null }, orderBy: { createdAt: "desc" }, take: BATCH * ENRICH_BATCHES, include: { source: { select: { name: true } } } }),
    loadKeywords(),
    newsDirections(),
  ]);
  if (!pending.length) return 0;
  const products = directions.filter((d) => d.active).map((d) => ({ code: d.code, label: d.label, keywords: keywords[d.code] ?? [] }));
  let done = 0;
  for (let i = 0; i < pending.length; i += BATCH) {
    const left = deadline - Date.now();
    if (left < 5_000) break;
    const batch = pending.slice(i, i + BATCH);
    let answers;
    try {
      answers = await enrichWithClaude(
        batch.map((p) => ({ id: p.id, title: p.title, description: p.summary, source: p.source.name, directions: p.directions })),
        products,
        Math.min(CLAUDE_TIMEOUT_MS, left),
      );
      await saveClaudeStatus({ lastOkAt: new Date().toISOString() });
    } catch (error) {
      const message = safeErrorMessage(error);
      console.error("Уточнение новостей через Claude не прошло, оставляем по правилам до следующего часа:", message);
      await saveClaudeStatus({ lastErrorAt: new Date().toISOString(), lastError: message });
      break;
    }
    const byId = new Map(answers.map((a) => [a.id, a]));
    for (const p of batch) {
      const a = byId.get(p.id);
      // Модель не ответила по новости: остаётся по правилам, повторно не спрашиваем
      if (!a) {
        await prisma.newsItem.update({ where: { id: p.id }, data: { enrichedBy: "rules", enrichedAt: now } });
        continue;
      }
      await prisma.newsItem.update({ where: { id: p.id }, data: { directions: narrowDirections(p.directions, a.directions), summary: a.summary || p.summary, enrichedBy: "claude", enrichedAt: now } });
      done += 1;
    }
  }
  return done;
}

export type ClaudeStatus = {
  /** off: ключа нет; pending: ключ задан, удачного вызова ещё не было; on: последний вызов удачный; error: последний с ошибкой */
  state: "off" | "pending" | "on" | "error";
  model: string;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
};

/** Состояние уточнения для настроек: «подключено» только после удачного вызова, последняя ошибка видна */
export async function claudeStatus(): Promise<ClaudeStatus> {
  const row = await prisma.setting.findUnique({ where: { key: CLAUDE_STATUS_KEY } });
  const v = row?.value && typeof row.value === "object" ? (row.value as ClaudeStatusRow) : {};
  const lastOkAt = v.lastOkAt ?? null;
  const lastErrorAt = v.lastErrorAt ?? null;
  const base = { model: claudeModel(), lastOkAt, lastErrorAt, lastError: v.lastError ?? null };
  if (!claudeConfigured()) return { ...base, state: "off" };
  if (lastErrorAt && (!lastOkAt || lastErrorAt > lastOkAt)) return { ...base, state: "error" };
  return { ...base, state: lastOkAt ? "on" : "pending" };
}

// ---------- Чтение ----------

export type NewsItemView = {
  id: string;
  title: string;
  url: string;
  summary: string;
  publishedAt: string;
  source: string;
  directions: string[];
  /** Чьё описание: claude (пересказ модели) или source (начало анонса источника дословно) */
  summaryBy: "claude" | "source";
};

const itemSelect = { id: true, title: true, url: true, summary: true, publishedAt: true, directions: true, enrichedBy: true, source: { select: { name: true } } } satisfies Prisma.NewsItemSelect;

function viewOf(r: { id: string; title: string; url: string; summary: string; publishedAt: Date; directions: string[]; enrichedBy: string | null; source: { name: string } }): NewsItemView {
  return { id: r.id, title: r.title, url: r.url, summary: r.summary, publishedAt: r.publishedAt.toISOString(), source: r.source.name, directions: r.directions, summaryBy: r.enrichedBy === "claude" ? "claude" : "source" };
}

export const NEWS_PAGE = 30;

/** Лента новостей с фильтром по продуктам. Без фильтра: всё, что привязано хотя бы к одному продукту */
export async function listNews(filter: { directions?: string[]; page?: number; perPage?: number } = {}): Promise<{ items: NewsItemView[]; total: number; page: number; pages: number }> {
  const perPage = filter.perPage ?? NEWS_PAGE;
  const where: Prisma.NewsItemWhereInput = filter.directions?.length ? { directions: { hasSome: filter.directions } } : { directions: { isEmpty: false } };
  const total = await prisma.newsItem.count({ where });
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, filter.page ?? 1), pages);
  const rows = await prisma.newsItem.findMany({ where, orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], skip: (page - 1) * perPage, take: perPage, select: itemSelect });
  return { items: rows.map(viewOf), total, page, pages };
}

/** Продукты человека для новостей: его выбор в профиле или направление из карточки. Без того и другого пусто */
export async function personDirections(personId: string, db: Db = prisma): Promise<string[]> {
  const [p, directions] = await Promise.all([db.person.findUnique({ where: { id: personId }, select: { newsPrefs: true, defaultDirection: { select: { code: true } } } }), newsDirections(db)]);
  const own = p?.defaultDirection?.code ?? null;
  return directionsFor(newsPrefsOf(p?.newsPrefs), own, directions.filter((d) => d.active).map((d) => d.code));
}

/** Блок на главной: свежие новости по продуктам человека */
export async function newsForPerson(personId: string, limit = 5): Promise<{ items: NewsItemView[]; directions: string[] }> {
  const directions = await personDirections(personId);
  if (!directions.length) return { items: [], directions };
  const rows = await prisma.newsItem.findMany({ where: { directions: { hasSome: directions } }, orderBy: [{ publishedAt: "desc" }], take: limit, select: itemSelect });
  return { items: rows.map(viewOf), directions };
}

export type DigestView = { id: string; kind: NewsDigestKind; periodKey: string; sentAt: string; directions: string[]; title: string; items: NewsItemView[] };

export function digestTitle(d: { kind: NewsDigestKind; periodKey: string }): string {
  if (d.kind === "WEEKLY") return `Новости за неделю ${d.periodKey.split("-W")[1] ?? d.periodKey}`;
  const [y, m, day] = d.periodKey.split("-");
  return `Новости за ${day}.${m}.${y}`;
}

/** Страница дайджеста: только своего, чужой не открывается */
export async function digestView(id: string, personId: string): Promise<DigestView | null> {
  const d = await prisma.newsDigest.findUnique({ where: { id } });
  if (!d || d.personId !== personId) return null;
  const rows = await prisma.newsItem.findMany({ where: { id: { in: d.itemIds } }, select: itemSelect });
  const order = new Map(d.itemIds.map((x, i) => [x, i]));
  const items = rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map(viewOf);
  return { id: d.id, kind: d.kind, periodKey: d.periodKey, sentAt: d.sentAt.toISOString(), directions: d.directions, title: digestTitle(d), items };
}

// ---------- Настройки человека ----------

/** Настройки дайджеста человека с учётом умолчания: не присылать, продукты своего направления */
export async function newsPrefsFor(personId: string): Promise<NewsPrefs> {
  const p = await prisma.person.findUnique({ where: { id: personId }, select: { newsPrefs: true } });
  return newsPrefsOf(p?.newsPrefs);
}

/** Частота и продукты дайджеста. Только при личном входе: по общему логину можно выбрать чужой профиль */
export async function saveNewsPrefs(actor: Actor, input: unknown): Promise<NewsPrefs> {
  if (actor.via === "TEAM") fail("Дайджест настраивается при личном входе");
  const before = await newsPrefsFor(actor.personId);
  // Частоту не прислали: остаётся прежняя (в том числе умолчание)
  const raw = newsPrefsOf(input);
  const frequency = input && typeof input === "object" && "frequency" in input ? raw.frequency : before.frequency;
  const known = new Set((await newsDirections()).map((d) => d.code));
  const prefs: NewsPrefs = { frequency, directions: raw.directions ? raw.directions.filter((d) => known.has(d)) : null };
  await prisma.$transaction(async (tx) => {
    await tx.person.update({ where: { id: actor.personId }, data: { newsPrefs: prefs } });
    const show = (p: NewsPrefs) => `${NEWS_FREQUENCY_LABELS[p.frequency]}; продукты: ${p.directions ? p.directions.join(", ") || "ни одного" : "по направлению"}`;
    if (show(before) !== show(prefs)) {
      await tx.auditLog.create({
        data: { action: "settings.news.prefs", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "person", entityId: actor.slug, field: "Дайджест новостей", before: show(before), after: show(prefs), ip: actor.ip ?? null, via: actor.via ?? null },
      });
    }
  });
  return prefs;
}

// ---------- Дайджесты ----------

export type PassResult = { sent: number; skipped: number; failed: number };

/** Период дайджеста, если сейчас ему время. catchUp: еженедельный, пропущенный в понедельник, догоняет позже */
export type DigestSlot = { key: string; catchUp: boolean };

const dateKey = (d: CalendarDate) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/**
 * Время ли дайджеста этого вида. Ежедневный: по будням с 8:00 до 12:00 по Москве. Еженедельный: в понедельник
 * с 8:00 до 12:00, а если в окно он не собрался (сервер лежал), по будням этой недели с 8:00 до 20:00
 */
export function digestSlot(kind: NewsDigestKind, now: Date): DigestSlot | null {
  const day = moscowDate(now);
  const weekday = isoWeekday(day);
  const t = now.getTime();
  const at = (h: number) => moscowDateTime(day, h).getTime();
  if (weekday > 5) return null;
  if (kind === "DAILY") return t >= at(DIGEST_WINDOW.start) && t < at(DIGEST_WINDOW.end) ? { key: dateKey(day), catchUp: false } : null;
  const w = isoWeekOf(day);
  const key = `${w.year}-W${String(w.week).padStart(2, "0")}`;
  if (weekday === 1 && t >= at(DIGEST_WINDOW.start) && t < at(DIGEST_WINDOW.end)) return { key, catchUp: false };
  if ((weekday > 1 || t >= at(DIGEST_WINDOW.end)) && t >= at(WEEKLY_CATCH_UP.start) && t < at(WEEKLY_CATCH_UP.end)) return { key, catchUp: true };
  return null;
}

/** Ключ периода, если сейчас время дайджеста этого вида (вместе с догоняющим еженедельным) */
export function digestPeriod(kind: NewsDigestKind, now: Date): string | null {
  return digestSlot(kind, now)?.key ?? null;
}

/** Продукт, под которым новость стоит в дайджесте: первый из подписки человека в порядке справочника */
function groupOf(item: { directions: string[] }, subscribed: string[]): string {
  return item.directions.find((d) => subscribed.includes(d)) ?? item.directions[0] ?? "";
}

/** Текст письма дайджеста: по продуктам из подписки, у каждой новости источник, дата и ссылка */
export function digestMail(person: { shortName: string }, digest: { id: string; kind: NewsDigestKind; periodKey: string; directions: string[] }, items: NewsItemView[], labels: Map<string, string>): { subject: string; text: string } {
  const title = digestTitle(digest);
  const groups = new Map<string, NewsItemView[]>();
  for (const i of items) {
    const code = groupOf(i, digest.directions);
    groups.set(code, [...(groups.get(code) ?? []), i]);
  }
  const date = (iso: string) => {
    const d = moscowDate(new Date(iso));
    return `${String(d.day).padStart(2, "0")}.${String(d.month).padStart(2, "0")}`;
  };
  const blocks = [...groups.entries()].map(([code, list]) => {
    const lines = list.map((i) => `${i.title} (${i.source}, ${date(i.publishedAt)})${i.summary ? `\n${i.summary}` : ""}\n${i.url}`);
    return `${labels.get(code) ?? code}\n\n${lines.join("\n\n")}`;
  });
  const count = `${items.length} ${plural(items.length, "новость", "новости", "новостей")}`;
  const note = items.some((i) => i.summaryBy === "source") ? "\n\nПод заголовком начало анонса источника или короткий пересказ, статья целиком по ссылке." : "";
  const text = `Здравствуйте, ${person.shortName}.\n\n${title}: ${count} по вашим продуктам.\n\n${blocks.join("\n\n")}${note}\n\nВсе новости: ${appUrl()}/news?digest=${digest.id}\nНастроить дайджест, продукты и частоту: ${appUrl()}/profile?tab=mail`;
  return { subject: `Weekly: ${title.toLowerCase()}, ${count}`, text };
}

/**
 * Событие в «Мне»: предмет news:<id дайджеста>. Тихое: не попадает в счётчик меню и в «ждут вашего внимания»,
 * письмо и уведомление по нему отдельно не уходят
 */
async function digestEvent(tx: Prisma.TransactionClient, personId: string, digest: { id: string; kind: NewsDigestKind; periodKey: string; directions: string[] }, items: NewsItemView[], labels: Map<string, string>, now: Date) {
  const codes = [...new Set(items.map((i) => groupOf(i, digest.directions)))].map((c) => labels.get(c) ?? c);
  await tx.inboxEvent.create({
    data: {
      recipientId: personId,
      kind: "NEWS",
      actorId: null,
      actorName: null,
      subject: `news:${digest.id}`,
      text: `${digestTitle(digest)}: ${items.length} ${plural(items.length, "новость", "новости", "новостей")}${codes.length ? ` (${codes.join(", ")})` : ""}`,
      createdAt: now,
      mailedAt: now,
      pushedAt: now,
    },
  });
}

type DigestPerson = { id: string; email: string | null; shortName: string };
type DigestTodo = { person: DigestPerson; kind: NewsDigestKind; periodKey: string; directions: string[]; since: Date; sent: Set<string> };
/** Итог сборки одного дайджеста. mail: что с письмом (ушло, отложено, потому что почта лежит, или не нужно) */
type DigestOutcome = { result: "sent" | "empty" | "exists"; mail: "sent" | "down" | "rejected" | "none" };
type PoolItem = Parameters<typeof viewOf>[0] & { createdAt: Date };

const isUniqueViolation = (error: unknown) => !!error && typeof error === "object" && (error as { code?: string }).code === "P2002";

/**
 * Один дайджест человеку за период. Пустой еженедельный записывается: он защищает от повтора и от догоняющей
 * отправки позже на неделе. Пустой ежедневный не записывается: новости, пришедшие позже утром, уйдут в этот же день.
 * Новости берутся с нижней границы с запасом, кроме уже попавших в дайджесты человека за 8 дней.
 * Строка с письмом создаётся уже захваченной (mailedAt), чтобы повтор другого процесса не отправил то же письмо;
 * если почта лежит, отметка снимается и письмо повторит следующий проход. mailDown: почта уже лежит в этом проходе,
 * дайджест и событие записываются без попытки письма (mailedAt пустой, письмо подберёт повтор)
 */
async function digestFor(t: DigestTodo, pool: PoolItem[], all: string[], labels: Map<string, string>, now: Date, mailDown: boolean): Promise<DigestOutcome> {
  const subscribed = new Set(t.directions);
  const rank = (code: string) => {
    const i = all.indexOf(code);
    return i < 0 ? all.length : i;
  };
  const from = t.since.getTime() - SINCE_OVERLAP_MS;
  const items = pool
    .filter((i) => i.createdAt.getTime() >= from && !t.sent.has(i.id) && i.directions.some((d) => subscribed.has(d)))
    .slice(0, DIGEST_MAX_ITEMS)
    .map(viewOf)
    .map((i) => ({ ...i, directions: [...i.directions].sort((a, b) => rank(a) - rank(b)) }))
    // Внутри дайджеста новости по продуктам подписки в порядке справочника, внутри продукта свежие сверху
    .sort((a, b) => rank(groupOf(a, t.directions)) - rank(groupOf(b, t.directions)) || b.publishedAt.localeCompare(a.publishedAt));
  if (!items.length && t.kind === "DAILY") return { result: "empty", mail: "none" };
  const wantsMail = items.length > 0 && mailConfigured() && !!t.person.email;
  const sendNow = wantsMail && !mailDown;
  let digest;
  try {
    digest = await prisma.$transaction(async (tx) => {
      const d = await tx.newsDigest.create({ data: { personId: t.person.id, kind: t.kind, periodKey: t.periodKey, directions: t.directions, itemIds: items.map((i) => i.id), sentAt: now, mailedAt: sendNow ? now : null } });
      if (items.length) await digestEvent(tx, t.person.id, d, items, labels, now);
      return d;
    });
  } catch (error) {
    // Другой процесс успел раньше: дайджест за период уже есть
    if (isUniqueViolation(error)) return { result: "exists", mail: "none" };
    throw error;
  }
  if (!items.length) return { result: "empty", mail: "none" };
  if (!wantsMail) return { result: "sent", mail: "none" };
  if (!sendNow) return { result: "sent", mail: "down" };
  try {
    await sendMail({ to: t.person.email!, ...digestMail(t.person, digest, items, labels) });
    return { result: "sent", mail: "sent" };
  } catch (error) {
    console.error("Письмо с дайджестом новостей не ушло:", error instanceof Error ? error.message : error);
    // Сервер недоступен: снимаем отметку, повторит следующий проход. Адрес отклонён: больше не пробуем
    if (isTransportDown(error)) {
      await prisma.newsDigest.update({ where: { id: digest.id }, data: { mailedAt: null } });
      return { result: "sent", mail: "down" };
    }
    return { result: "sent", mail: "rejected" };
  }
}

/**
 * Письма дайджестов, которые не ушли (почта лежала или не была настроена): не старше шести часов. Строки сначала
 * захватываются одним UPDATE ... RETURNING (как письма о событиях), поэтому два процесса не отправят одно письмо
 */
async function retryDigestMail(now: Date, labels: Map<string, string>): Promise<number> {
  if (!mailConfigured()) return 0;
  const since = new Date(now.getTime() - MAIL_RETRY_MS);
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "news_digests" SET "mailedAt" = ${now}
    WHERE "id" IN (
      SELECT d."id" FROM "news_digests" d JOIN "people" p ON p."id" = d."personId"
      WHERE d."mailedAt" IS NULL AND cardinality(d."itemIds") > 0 AND d."sentAt" > ${since} AND p."active" AND p."email" IS NOT NULL
      ORDER BY d."sentAt" LIMIT 50
      FOR UPDATE OF d SKIP LOCKED
    )
    RETURNING "id"`;
  if (!claimed.length) return 0;
  const digests = await prisma.newsDigest.findMany({ where: { id: { in: claimed.map((c) => c.id) } }, include: { person: { select: { email: true, shortName: true } } }, orderBy: { sentAt: "asc" } });
  const rows = await prisma.newsItem.findMany({ where: { id: { in: [...new Set(digests.flatMap((d) => d.itemIds))] } }, select: itemSelect });
  const byId = new Map(rows.map((r) => [r.id, viewOf(r)]));
  let sent = 0;
  for (let i = 0; i < digests.length; i++) {
    const d = digests[i]!;
    const items = d.itemIds.map((id) => byId.get(id)).filter((x): x is NewsItemView => !!x);
    // Новости уже удалены: писать не о чем, отметка остаётся
    if (!items.length || !d.person.email) continue;
    try {
      await sendMail({ to: d.person.email, ...digestMail(d.person, d, items, labels) });
      sent += 1;
    } catch (error) {
      console.error("Повтор письма с дайджестом не прошёл:", error instanceof Error ? error.message : error);
      if (isTransportDown(error)) {
        // Возвращаем в очередь всё, что ещё не ушло
        await prisma.newsDigest.updateMany({ where: { id: { in: digests.slice(i).map((x) => x.id) } }, data: { mailedAt: null } });
        break;
      }
      // Адрес отклонён: больше не пробуем, отметка остаётся
    }
  }
  return sent;
}

/** С какого момента собирать новости человеку: от прошлого непустого дайджеста, с потолком по виду */
export function digestSince(kind: NewsDigestKind, lastNonEmpty: Date | null, now: Date): Date {
  const t = now.getTime();
  if (kind === "DAILY") return new Date(lastNonEmpty ? Math.max(lastNonEmpty.getTime(), t - DAILY_CAP_MS) : t - DAILY_FIRST_MS);
  return new Date(Math.max(lastNonEmpty?.getTime() ?? 0, t - WEEKLY_SPAN_MS));
}

/** Ключ недели (2026-W43) для даты по Москве */
function weekKeyOf(day: CalendarDate): string {
  const w = isoWeekOf(day);
  return `${w.year}-W${String(w.week).padStart(2, "0")}`;
}

/**
 * Кому догонять еженедельный дайджест этой недели. Догоняют только недели, когда цикл новостей уже работал до конца
 * понедельничного окна (сервер лежал в понедельник), а не свежий выкат во вторник вечером. И только те, у кого был
 * еженедельный за прошлую неделю: новый сотрудник и тот, кто только включил рассылку, ждут ближайшего понедельника
 */
async function catchUpPeople(now: Date, personIds: string[]): Promise<Set<string>> {
  const day = moscowDate(now);
  const monday = isoWeekOf(day).start;
  const windowEnd = moscowDateTime(monday, DIGEST_WINDOW.end);
  const row = await prisma.setting.findUnique({ where: { key: LOOP_STARTED_KEY } });
  const started = typeof row?.value === "string" ? new Date(row.value) : null;
  if (!started || started.getTime() >= windowEnd.getTime()) return new Set();
  const prevMonday = moscowDate(new Date(moscowDateTime(monday, 12).getTime() - 7 * DAY_MS));
  const prev = await prisma.newsDigest.findMany({ where: { kind: "WEEKLY", periodKey: weekKeyOf(prevMonday), personId: { in: personIds } }, select: { personId: true } });
  return new Set(prev.map((p) => p.personId));
}

/**
 * Дайджесты всем, у кого сейчас время и подходящая частота. sent: дайджесты с новостями (в «Мне», и письмом, если
 * оно ушло или не нужно), skipped: пустые или уже были, failed: письмо не ушло или отложено, потому что почта лежит.
 * Почта лежит: дайджесты и события остальным всё равно записываются сразу, письма подберёт повтор.
 * Уже собранные дайджесты периода, прошлые дайджесты и новости берутся несколькими запросами на всех,
 * а не запросом на человека. renew: продление аренды цикла, false значит аренду забрал другой процесс
 */
export async function newsDigestPass(now = new Date(), options: { renew?: () => Promise<boolean> } = {}): Promise<PassResult> {
  const result: PassResult = { sent: 0, skipped: 0, failed: 0 };
  const daily = digestSlot("DAILY", now);
  const weekly = digestSlot("WEEKLY", now);
  const directions = await newsDirections();
  const labels = new Map(directions.map((d) => [d.code, d.label]));
  let mailDown = false;
  if (daily || weekly) {
    const all = directions.filter((d) => d.active).map((d) => d.code);
    const people = await prisma.person.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, email: true, shortName: true, newsPrefs: true, defaultDirection: { select: { code: true } } } });
    let wanted = people.flatMap((p) => {
      const own = p.defaultDirection?.code ?? null;
      const prefs = newsPrefsOf(p.newsPrefs);
      const frequency: NewsFrequency = prefs.frequency;
      const slot = frequency === "daily" ? daily : frequency === "weekly" ? weekly : null;
      if (!slot) return [];
      return [{ person: { id: p.id, email: p.email, shortName: p.shortName }, kind: (frequency === "daily" ? "DAILY" : "WEEKLY") as NewsDigestKind, periodKey: slot.key, directions: directionsFor(prefs, own, all) }];
    });
    if (weekly?.catchUp) {
      const allowed = await catchUpPeople(
        now,
        wanted.filter((w) => w.kind === "WEEKLY").map((w) => w.person.id),
      );
      wanted = wanted.filter((w) => w.kind !== "WEEKLY" || allowed.has(w.person.id));
    }
    if (wanted.length) {
      const periods = [...(daily ? [{ kind: "DAILY" as const, periodKey: daily.key }] : []), ...(weekly ? [{ kind: "WEEKLY" as const, periodKey: weekly.key }] : [])];
      const existing = await prisma.newsDigest.findMany({ where: { OR: periods, personId: { in: wanted.map((w) => w.person.id) } }, select: { personId: true, kind: true } });
      const done = new Set(existing.map((e) => `${e.personId}|${e.kind}`));
      const open = wanted.filter((w) => !done.has(`${w.person.id}|${w.kind}`));
      result.skipped += wanted.length - open.length;
      if (open.length) {
        const ids = open.map((w) => w.person.id);
        const [last, recent] = await Promise.all([
          prisma.newsDigest.groupBy({ by: ["personId"], where: { personId: { in: ids }, itemIds: { isEmpty: false } }, _max: { sentAt: true } }),
          // Что человеку уже ушло за 8 дней: не повторяем
          prisma.newsDigest.findMany({ where: { personId: { in: ids }, itemIds: { isEmpty: false }, sentAt: { gte: new Date(now.getTime() - SENT_LOOKBACK_MS) } }, select: { personId: true, itemIds: true } }),
        ]);
        const lastOf = new Map(last.map((l) => [l.personId, l._max.sentAt]));
        const sentOf = new Map<string, Set<string>>();
        for (const r of recent) {
          const set = sentOf.get(r.personId) ?? new Set<string>();
          for (const id of r.itemIds) set.add(id);
          sentOf.set(r.personId, set);
        }
        const todo: DigestTodo[] = open.map((w) => ({ ...w, since: digestSince(w.kind, lastOf.get(w.person.id) ?? null, now), sent: sentOf.get(w.person.id) ?? new Set() }));
        const minSince = new Date(Math.min(...todo.map((t) => t.since.getTime())) - SINCE_OVERLAP_MS);
        const pool = await prisma.newsItem.findMany({
          where: { createdAt: { gte: minSince }, publishedAt: { gte: new Date(now.getTime() - 14 * DAY_MS) }, directions: { isEmpty: false } },
          orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
          take: 5000,
          select: { ...itemSelect, createdAt: true },
        });
        for (let i = 0; i < todo.length; i++) {
          if (options.renew && i > 0 && i % 25 === 0 && !(await options.renew())) break;
          try {
            const r = await digestFor(todo[i]!, pool, all, labels, now, mailDown);
            if (r.mail === "down") {
              mailDown = true;
              result.failed += 1;
            } else if (r.result === "sent") result.sent += 1;
            else result.skipped += 1;
          } catch (error) {
            result.failed += 1;
            console.error("Дайджест новостей не собрался:", error instanceof Error ? error.message : error);
          }
        }
      }
    }
  }
  // Почта лежит в этом проходе: повтор писем бессмыслен, попробуем через минуту
  if (!mailDown) result.sent += await retryDigestMail(now, labels);
  return result;
}

// ---------- Очистка ----------

/**
 * Очистка: новости старше 180 дней, дайджесты старше 90, пустые дайджесты старше 15 (пустой еженедельный прошлой
 * недели нужен догоняющему), события «Мне» о дайджестах старше 90
 */
export async function cleanupNews(now = new Date()): Promise<{ items: number; digests: number; events: number }> {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const digests = await prisma.newsDigest.deleteMany({ where: { OR: [{ sentAt: { lt: ago(KEEP.digestsDays) } }, { itemIds: { isEmpty: true }, sentAt: { lt: ago(KEEP.emptyDigestsDays) } }] } });
  const events = await prisma.inboxEvent.deleteMany({ where: { kind: "NEWS", createdAt: { lt: ago(KEEP.digestsDays) } } });
  const items = await prisma.newsItem.deleteMany({ where: { publishedAt: { lt: ago(KEEP.itemsDays) } } });
  await prisma.setting.upsert({ where: { key: CLEANUP_KEY }, update: { value: now.toISOString() }, create: { key: CLEANUP_KEY, value: now.toISOString() } });
  return { items: items.count, digests: digests.count, events: events.count };
}

/** Раз в сутки из цикла новостей. true: очистка была */
export async function cleanupIfDue(now = new Date()): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: CLEANUP_KEY } });
  const last = typeof row?.value === "string" ? new Date(row.value).getTime() : 0;
  if (now.getTime() - last < 23 * HOUR_MS) return false;
  await cleanupNews(now);
  return true;
}

export { NEWS_FREQUENCY_LABELS, newsPrefsOf, type NewsPrefs };
