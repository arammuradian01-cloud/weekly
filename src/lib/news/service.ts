// Новости по продуктам и дайджесты (этап 60). Решение Арама 21.10.
//
// Как устроено:
// - источники: публичные ленты RSS и Atom, список ведёт владелец в «Настройках». Забор раз в час в минутном цикле
//   писем (src/lib/letters/service.ts): каждая лента со своим таймаутом и одним повтором, ошибка одной ленты не трогает
//   остальные и видна владельцу в настройках рядом с источником;
// - новость хранится как заголовок, дата, источник, ссылка, продукты и короткое описание. Статьи целиком не храним.
//   Дубли отсеиваются по адресу статьи (один на все ленты) и по идентификатору записи в ленте;
// - привязка к продуктам по ключевым словам из настроек. Если в окружении есть ANTHROPIC_API_KEY, привязка и описание
//   уточняются через Claude API отдельным проходом; без ключа всё работает по правилам;
// - дайджест: ежедневный по будням утром и еженедельный в понедельник, окно 8:00-12:00 по Москве. Один на человека
//   и период, в «Мне» событием и письмом, если почта настроена. Пустой дайджест не отправляется. Продукты и частоту
//   человек выбирает в профиле; по умолчанию продукты его направления, раз в неделю.

import { prisma } from "@/lib/db";
import type { NewsDigestKind, Prisma } from "@/generated/prisma/client";
import { mailConfigured, sendMail } from "@/lib/mail";
import { isTransportDown } from "@/lib/letters/service";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { isoWeekOf, isoWeekday, moscowDate, moscowDateTime, type CalendarDate } from "@/lib/week";
import { plural } from "@/domain/dates";
import { parseFeed, urlKeyOf } from "./feed";
import { FeedError, checkFeedUrl, fetchFeed } from "./transport";
import { KEYWORDS_KEY, keywordsOf, normalizeKeywords, parseKeywordLine } from "./keywords";
import { matchDirections, ruleSummary } from "./match";
import { DEFAULT_NEWS_PREFS, NEWS_FREQUENCY_LABELS, directionsFor, newsPrefsOf, type NewsFrequency, type NewsPrefs } from "./prefs";
import { BATCH, claudeConfigured, claudeModel, enrichWithClaude } from "./claude";
import { DEFAULT_SOURCES } from "./sources";

type Db = Prisma.TransactionClient | typeof prisma;

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

const requireOwner = (actor: Actor, what: string) => {
  if (actor.management !== "OWNER" || actor.role === "OBSERVER") fail(`${what} настраивает владелец в режиме управления`);
};

/** Раз в час: следующий забор не раньше чем через 55 минут после прошлого */
export const FETCH_EVERY_MS = 55 * 60_000;
const LAST_FETCH_KEY = "news.lastFetchAt";
const SEEDED_KEY = "news.sources.seeded";
/** Записи старше этого при заборе не берутся: первый забор архивной ленты не тянет прошлогоднее */
const MAX_ITEM_AGE_MS = 30 * 24 * 3_600_000;
/** Окно дайджеста по Москве: с 8:00 до 12:00, позже не шлём, утро прошло */
export const DIGEST_WINDOW = { start: 8, end: 12 };
const DIGEST_MAX_ITEMS = 40;
const DAY_MS = 24 * 3_600_000;

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
    status: statusOf(s),
    lastFetchAt: s.lastFetchAt?.toISOString() ?? null,
    lastOkAt: s.lastOkAt?.toISOString() ?? null,
    lastError: s.lastError,
    lastCount: s.lastCount,
    failCount: s.failCount,
    items: s._count.items,
  }));
}

function checkSourceInput(input: { name?: unknown; url?: unknown }): { name: string; url: string } {
  const name = String(input?.name ?? "").replace(/\s+/g, " ").trim();
  const url = String(input?.url ?? "").trim();
  if (!name) fail("Дайте источнику название");
  if (name.length > 120) fail("Название источника не длиннее 120 знаков");
  const problem = checkFeedUrl(url);
  if (problem) fail(problem);
  if (url.length > 1000) fail("Адрес ленты слишком длинный");
  return { name, url };
}

async function sourceAudit(tx: Db, actor: Actor, id: string, field: string, before: string, after: string) {
  await tx.auditLog.create({
    data: { action: "settings.news.source", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "news_source", entityId: id, field, before, after, ip: actor.ip ?? null, via: actor.via ?? null },
  });
}

export async function addSource(actor: Actor, input: { name: string; url: string }): Promise<SourceView> {
  requireOwner(actor, "Источники новостей");
  const { name, url } = checkSourceInput(input);
  if (await prisma.newsSource.findUnique({ where: { url } })) fail("Такая лента уже есть в списке");
  const max = await prisma.newsSource.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.$transaction(async (tx) => {
    const s = await tx.newsSource.create({ data: { name, url, sortOrder: (max._max.sortOrder ?? 0) + 10 } });
    await sourceAudit(tx, actor, s.id, "Источник", "", `${name}: ${url}`);
    return s;
  });
  return { ...created, status: "new", lastFetchAt: null, lastOkAt: null, items: 0 };
}

export async function updateSource(actor: Actor, id: string, input: { name: string; url: string }): Promise<void> {
  requireOwner(actor, "Источники новостей");
  const { name, url } = checkSourceInput(input);
  const s = await prisma.newsSource.findUnique({ where: { id } });
  if (!s) return fail("Источника уже нет");
  const other = await prisma.newsSource.findUnique({ where: { url } });
  if (other && other.id !== id) fail("Такая лента уже есть в списке");
  await prisma.$transaction(async (tx) => {
    // Новый адрес: условные заголовки прошлой ленты не годятся
    const sameUrl = s.url === url;
    await tx.newsSource.update({ where: { id }, data: { name, url, ...(sameUrl ? {} : { etag: null, lastModified: null, lastError: null, failCount: 0 }) } });
    if (s.name !== name) await sourceAudit(tx, actor, id, "Название источника", s.name, name);
    if (!sameUrl) await sourceAudit(tx, actor, id, "Адрес ленты", s.url, url);
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
  await db.newsSource.createMany({ data: DEFAULT_SOURCES.map((s, i) => ({ name: s.name, url: s.url, sortOrder: (i + 1) * 10 })), skipDuplicates: true });
  await db.setting.upsert({ where: { key: SEEDED_KEY }, update: {}, create: { key: SEEDED_KEY, value: true } });
  return DEFAULT_SOURCES.length;
}

// ---------- Забор ----------

export type FetchResult = { sourceId: string; name: string; ok: boolean; added: number; total: number; error: string | null };

type SourceRow = { id: string; name: string; url: string; etag: string | null; lastModified: string | null; lastCount: number };

/** Забрать одну ленту. Любая ошибка остаётся в источнике и не поднимается наверх: остальные ленты идут своим чередом */
export async function fetchSource(source: SourceRow, keywords: Record<string, string[]>, order: string[], now = new Date()): Promise<FetchResult> {
  try {
    const response = await fetchFeed({ url: source.url, etag: source.etag, lastModified: source.lastModified });
    if (response.status === 304) {
      await prisma.newsSource.update({ where: { id: source.id }, data: { lastFetchAt: now, lastOkAt: now, lastError: null, failCount: 0 } });
      return { sourceId: source.id, name: source.name, ok: true, added: 0, total: source.lastCount, error: null };
    }
    const feed = parseFeed(response.body);
    if (!feed.items.length && !/<(rss|feed|rdf)[\s>]/i.test(response.body)) throw new FeedError("По адресу не лента RSS или Atom", false);
    const minPublished = now.getTime() - MAX_ITEM_AGE_MS;
    const seen = new Set<string>();
    const rows = feed.items
      .map((i) => ({ guid: i.guid.slice(0, 500), urlKey: urlKeyOf(i.url).slice(0, 1000), url: i.url.slice(0, 2000), title: i.title, description: i.description, publishedAt: i.publishedAt ?? now }))
      .filter((r) => {
        if (r.publishedAt.getTime() < minPublished) return false;
        // Будущие даты в кривых лентах: берём время забора
        if (r.publishedAt.getTime() > now.getTime() + DAY_MS) r.publishedAt = now;
        const key = `${r.urlKey}|${r.guid}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((r) => ({ ...r, directions: matchDirections(r, keywords, order) }))
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
        // skipDuplicates закрывает гонку двух процессов: уникальные индексы по адресу и по ленте с guid
        const created = await prisma.newsItem.createMany({
          data: fresh.map((r) => ({ sourceId: source.id, guid: r.guid, urlKey: r.urlKey, url: r.url, title: r.title, summary: ruleSummary(r), publishedAt: r.publishedAt, directions: r.directions, createdAt: now })),
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
    const message = error instanceof Error ? error.message : String(error);
    await prisma.newsSource.update({ where: { id: source.id }, data: { lastFetchAt: now, lastError: message.slice(0, 500), failCount: { increment: 1 } } }).catch(() => undefined);
    return { sourceId: source.id, name: source.name, ok: false, added: 0, total: 0, error: message };
  }
}

/** Забрать все включённые ленты по очереди (ленты чужие, параллельно их не дёргаем) */
export async function fetchAll(now = new Date()): Promise<FetchResult[]> {
  const [sources, keywords, directions] = await Promise.all([
    prisma.newsSource.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, url: true, etag: true, lastModified: true, lastCount: true } }),
    loadKeywords(),
    newsDirections(),
  ]);
  const order = directions.filter((d) => d.active).map((d) => d.code);
  const results: FetchResult[] = [];
  for (const s of sources) results.push(await fetchSource(s, keywords, order, now));
  await prisma.setting.upsert({ where: { key: LAST_FETCH_KEY }, update: { value: now.toISOString() }, create: { key: LAST_FETCH_KEY, value: now.toISOString() } });
  return results;
}

export async function lastFetchAt(): Promise<Date | null> {
  const row = await prisma.setting.findUnique({ where: { key: LAST_FETCH_KEY } });
  return typeof row?.value === "string" ? new Date(row.value) : null;
}

/** Раз в час из минутного цикла. true: забор был */
export async function fetchIfDue(now = new Date()): Promise<boolean> {
  const last = await lastFetchAt();
  if (last && now.getTime() - last.getTime() < FETCH_EVERY_MS) return false;
  await fetchAll(now);
  return true;
}

/** «Забрать сейчас» из настроек: владелец */
export async function fetchNow(actor: Actor): Promise<FetchResult[]> {
  requireOwner(actor, "Источники новостей");
  const results = await fetchAll();
  await enrichPass();
  const added = results.reduce((n, r) => n + r.added, 0);
  await prisma.auditLog.create({
    data: { action: "settings.news.fetch", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "settings", entityId: LAST_FETCH_KEY, field: "Забор новостей вручную", before: "", after: `лент ${results.length}, с ошибкой ${results.filter((r) => !r.ok).length}, новых новостей ${added}`, ip: actor.ip ?? null, via: actor.via ?? null },
  });
  return results;
}

// ---------- Уточнение через Claude ----------

/**
 * Свежие новости, которые ещё не уточнялись: через Claude, если ключ задан, иначе помечаются «по правилам».
 * Не больше двух пачек за проход. Ошибка API: новости остаются как есть и попробуются в следующий час
 */
export async function enrichPass(now = new Date()): Promise<number> {
  const recent = new Date(now.getTime() - 3 * DAY_MS);
  if (!claudeConfigured()) {
    const r = await prisma.newsItem.updateMany({ where: { enrichedBy: null }, data: { enrichedBy: "rules", enrichedAt: now } });
    return r.count;
  }
  // Старое не уточняем: пометка «по правилам», чтобы очередь не копилась
  await prisma.newsItem.updateMany({ where: { enrichedBy: null, createdAt: { lt: recent } }, data: { enrichedBy: "rules", enrichedAt: now } });
  const [pending, keywords, directions] = await Promise.all([
    prisma.newsItem.findMany({ where: { enrichedBy: null }, orderBy: { createdAt: "desc" }, take: BATCH * 2, include: { source: { select: { name: true } } } }),
    loadKeywords(),
    newsDirections(),
  ]);
  if (!pending.length) return 0;
  const products = directions.filter((d) => d.active).map((d) => ({ code: d.code, label: d.label, keywords: keywords[d.code] ?? [] }));
  let done = 0;
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    let answers;
    try {
      answers = await enrichWithClaude(
        batch.map((p) => ({ id: p.id, title: p.title, description: p.summary, source: p.source.name, directions: p.directions })),
        products,
      );
    } catch (error) {
      console.error("Уточнение новостей через Claude не прошло, оставляем по правилам до следующего часа:", error instanceof Error ? error.message : error);
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
      await prisma.newsItem.update({ where: { id: p.id }, data: { directions: a.directions, summary: a.summary || p.summary, enrichedBy: "claude", enrichedAt: now } });
      done += 1;
    }
  }
  return done;
}

export function claudeStatus(): { on: boolean; model: string } {
  return { on: claudeConfigured(), model: claudeModel() };
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
};

const itemSelect = { id: true, title: true, url: true, summary: true, publishedAt: true, directions: true, source: { select: { name: true } } } satisfies Prisma.NewsItemSelect;

function viewOf(r: { id: string; title: string; url: string; summary: string; publishedAt: Date; directions: string[]; source: { name: string } }): NewsItemView {
  return { id: r.id, title: r.title, url: r.url, summary: r.summary, publishedAt: r.publishedAt.toISOString(), source: r.source.name, directions: r.directions };
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

/** Продукты человека для новостей: его выбор в профиле или направление из карточки */
export async function personDirections(personId: string, db: Db = prisma): Promise<string[]> {
  const [p, directions] = await Promise.all([db.person.findUnique({ where: { id: personId }, select: { newsPrefs: true, defaultDirection: { select: { code: true } } } }), newsDirections(db)]);
  return directionsFor(newsPrefsOf(p?.newsPrefs), p?.defaultDirection?.code ?? null, directions.filter((d) => d.active).map((d) => d.code));
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

export async function newsPrefsFor(personId: string): Promise<NewsPrefs> {
  const p = await prisma.person.findUnique({ where: { id: personId }, select: { newsPrefs: true } });
  return newsPrefsOf(p?.newsPrefs);
}

/** Частота и продукты дайджеста. Только при личном входе: по общему логину можно выбрать чужой профиль */
export async function saveNewsPrefs(actor: Actor, input: unknown): Promise<NewsPrefs> {
  if (actor.via === "TEAM") fail("Дайджест настраивается при личном входе");
  const raw = newsPrefsOf(input);
  const known = new Set((await newsDirections()).map((d) => d.code));
  const prefs: NewsPrefs = { frequency: raw.frequency, directions: raw.directions ? raw.directions.filter((d) => known.has(d)) : null };
  const before = await newsPrefsFor(actor.personId);
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

/** Ключ периода, если сейчас окно дайджеста этого вида. Ежедневный по будням, еженедельный в понедельник */
export function digestPeriod(kind: NewsDigestKind, now: Date): string | null {
  const day = moscowDate(now);
  const weekday = isoWeekday(day);
  const t = now.getTime();
  if (t < moscowDateTime(day, DIGEST_WINDOW.start).getTime() || t >= moscowDateTime(day, DIGEST_WINDOW.end).getTime()) return null;
  if (kind === "WEEKLY") {
    if (weekday !== 1) return null;
    const w = isoWeekOf(day);
    return `${w.year}-W${String(w.week).padStart(2, "0")}`;
  }
  if (weekday > 5) return null;
  return dateKey(day);
}

const dateKey = (d: CalendarDate) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

type DigestPerson = { id: string; email: string | null; shortName: string; newsPrefs: unknown; defaultDirection: { code: string } | null };

/** Текст письма дайджеста: по продуктам, у каждой новости источник, дата и ссылка */
export function digestMail(person: { shortName: string }, digest: { id: string; kind: NewsDigestKind; periodKey: string }, items: NewsItemView[], labels: Map<string, string>): { subject: string; text: string } {
  const title = digestTitle(digest);
  const groups = new Map<string, NewsItemView[]>();
  for (const i of items) {
    const code = i.directions[0] ?? "";
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
  const text = `Здравствуйте, ${person.shortName}.\n\n${title}: ${count} по вашим продуктам.\n\n${blocks.join("\n\n")}\n\nВсе новости: ${appUrl()}/news?digest=${digest.id}\nНастроить дайджест, продукты и частоту: ${appUrl()}/profile?tab=mail`;
  return { subject: `Weekly: ${title.toLowerCase()}, ${count}`, text };
}

/** Событие в «Мне»: предмет news:<id дайджеста>, письмо и уведомление по нему не уходят отдельно */
async function digestEvent(tx: Prisma.TransactionClient, personId: string, digest: { id: string; kind: NewsDigestKind; periodKey: string }, items: NewsItemView[], labels: Map<string, string>, now: Date) {
  const codes = [...new Set(items.flatMap((i) => i.directions.slice(0, 1)))].map((c) => labels.get(c) ?? c);
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

/**
 * Один дайджест человеку за период: записывается и при пустом наборе новостей, чтобы не проверять каждую минуту.
 * Письмо уходит после записи; если не ушло, следующий проход попробует снова (mailedAt пустой)
 */
async function digestFor(p: DigestPerson, kind: NewsDigestKind, periodKey: string, directionsAll: string[], labels: Map<string, string>, now: Date): Promise<"sent" | "empty" | "exists"> {
  const prefs = newsPrefsOf(p.newsPrefs);
  const directions = directionsFor(prefs, p.defaultDirection?.code ?? null, directionsAll);
  if (await prisma.newsDigest.findUnique({ where: { personId_kind_periodKey: { personId: p.id, kind, periodKey } } })) return "exists";
  const last = await prisma.newsDigest.findFirst({ where: { personId: p.id, itemIds: { isEmpty: false } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } });
  const span = kind === "WEEKLY" ? 7 * DAY_MS : DAY_MS;
  const since = new Date(Math.max(last?.sentAt.getTime() ?? 0, now.getTime() - span - 12 * 3_600_000));
  const rows = directions.length
    ? await prisma.newsItem.findMany({
        where: { directions: { hasSome: directions }, createdAt: { gt: since }, publishedAt: { gte: new Date(now.getTime() - 14 * DAY_MS) } },
        orderBy: [{ publishedAt: "desc" }],
        take: DIGEST_MAX_ITEMS,
        select: itemSelect,
      })
    : [];
  // Внутри дайджеста новости по продуктам в порядке справочника, внутри продукта свежие сверху
  const items = rows
    .map(viewOf)
    .map((i) => ({ ...i, directions: [...i.directions].sort((a, b) => directionsAll.indexOf(a) - directionsAll.indexOf(b)) }))
    .sort((a, b) => directionsAll.indexOf(a.directions[0] ?? "") - directionsAll.indexOf(b.directions[0] ?? "") || b.publishedAt.localeCompare(a.publishedAt));
  const digest = await prisma.$transaction(async (tx) => {
    const d = await tx.newsDigest.create({ data: { personId: p.id, kind, periodKey, directions, itemIds: items.map((i) => i.id), sentAt: now } });
    if (items.length) await digestEvent(tx, p.id, d, items, labels, now);
    return d;
  });
  if (!items.length) return "empty";
  if (mailConfigured() && p.email) {
    try {
      await sendMail({ to: p.email, ...digestMail(p, digest, items, labels) });
      await prisma.newsDigest.update({ where: { id: digest.id }, data: { mailedAt: now } });
    } catch (error) {
      console.error("Письмо с дайджестом новостей не ушло, повторим:", error instanceof Error ? error.message : error);
      if (isTransportDown(error)) throw error;
    }
  }
  return "sent";
}

/** Письма дайджестов, которые не ушли (почта лежала или не была настроена): не старше шести часов */
async function retryDigestMail(now: Date, labels: Map<string, string>): Promise<number> {
  if (!mailConfigured()) return 0;
  const pending = await prisma.newsDigest.findMany({
    where: { mailedAt: null, itemIds: { isEmpty: false }, sentAt: { gt: new Date(now.getTime() - 6 * 3_600_000) }, person: { active: true, email: { not: null } } },
    include: { person: { select: { email: true, shortName: true } } },
    take: 50,
  });
  let sent = 0;
  for (const d of pending) {
    const rows = await prisma.newsItem.findMany({ where: { id: { in: d.itemIds } }, select: itemSelect });
    const order = new Map(d.itemIds.map((x, i) => [x, i]));
    const items = rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map(viewOf);
    try {
      await sendMail({ to: d.person.email!, ...digestMail(d.person, d, items, labels) });
      await prisma.newsDigest.update({ where: { id: d.id }, data: { mailedAt: now } });
      sent += 1;
    } catch (error) {
      console.error("Повтор письма с дайджестом не прошёл:", error instanceof Error ? error.message : error);
      if (isTransportDown(error)) break;
      // Адрес отклонён: больше не пробуем
      await prisma.newsDigest.update({ where: { id: d.id }, data: { mailedAt: now } });
    }
  }
  return sent;
}

/** Дайджесты всем, у кого сейчас окно и подходящая частота. sent: с новостями, skipped: пустые или уже были */
export async function newsDigestPass(now = new Date()): Promise<PassResult> {
  const result: PassResult = { sent: 0, skipped: 0, failed: 0 };
  const daily = digestPeriod("DAILY", now);
  const weekly = digestPeriod("WEEKLY", now);
  const directions = await newsDirections();
  const labels = new Map(directions.map((d) => [d.code, d.label]));
  if (daily || weekly) {
    const all = directions.filter((d) => d.active).map((d) => d.code);
    const people = await prisma.person.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, email: true, shortName: true, newsPrefs: true, defaultDirection: { select: { code: true } } } });
    for (const p of people) {
      const frequency: NewsFrequency = newsPrefsOf(p.newsPrefs).frequency;
      const kind: NewsDigestKind | null = frequency === "daily" && daily ? "DAILY" : frequency === "weekly" && weekly ? "WEEKLY" : null;
      if (!kind) continue;
      try {
        const r = await digestFor(p, kind, kind === "DAILY" ? daily! : weekly!, all, labels, now);
        if (r === "sent") result.sent += 1;
        else result.skipped += 1;
      } catch (error) {
        result.failed += 1;
        console.error("Дайджест новостей не собрался:", error instanceof Error ? error.message : error);
        if (isTransportDown(error)) break;
      }
    }
  }
  result.sent += await retryDigestMail(now, labels);
  return result;
}

/** Проход из минутного цикла: забор раз в час, уточнение после забора, дайджесты в своё окно */
export async function newsPass(now = new Date()): Promise<{ fetched: boolean; enriched: number; digest: PassResult }> {
  const fetched = await fetchIfDue(now);
  const enriched = fetched ? await enrichPass(now) : 0;
  const digest = await newsDigestPass(now);
  return { fetched, enriched, digest };
}

export { DEFAULT_NEWS_PREFS, NEWS_FREQUENCY_LABELS, newsPrefsOf, type NewsPrefs };
