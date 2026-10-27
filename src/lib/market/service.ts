// Рынок КАСКО и ОСАГО на сервере (этап 62): загрузка пакета рынка и выдача его странице. Пакет целиком заменяет
// прежний одной транзакцией: код страницы и все наборы данных. Права проверяются здесь и в обработчиках, экран
// только прячет кнопки. Цифры в журнал и лог не пишутся: только число наборов и строк.

import { gzipSync } from "node:zlib";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { canUploadMarket } from "./access";
import type { MarketBundleInput, MarketRow } from "./bundle";
import { marketEtag } from "./http";

const BUNDLE_ID = "current";

export const MARKET_UPLOAD_ONLY = "Пакет рынка загружает владелец при личном входе";

export type MarketMeta = {
  version: number;
  uploadedAt: string;
  uploadedBy: string;
  datasetsCount: number;
  rowsTotal: number;
  /** Отпечаток пакета: номер версии и время загрузки, меняется с каждой загрузкой. По нему окно пересоздаётся */
  stamp: string;
};

/**
 * Номер версии растёт с каждой загрузкой, время загрузки отличает пакет, загруженный заново после очистки базы
 * (номер тогда снова 1)
 */
const stampOf = (version: number, uploadedAt: Date) => `${version}-${uploadedAt.getTime()}`;

/** Сведения о загруженном пакете без кода и цифр. null: пакета ещё нет */
export async function marketMeta(db: Prisma.TransactionClient | typeof prisma = prisma): Promise<MarketMeta | null> {
  const row = await db.marketBundle.findUnique({ where: { id: BUNDLE_ID }, select: { version: true, uploadedAt: true, uploadedByName: true, datasetsCount: true, rowsTotal: true } });
  if (!row) return null;
  return { version: row.version, uploadedAt: row.uploadedAt.toISOString(), uploadedBy: row.uploadedByName, datasetsCount: row.datasetsCount, rowsTotal: row.rowsTotal, stamp: stampOf(row.version, row.uploadedAt) };
}

export type MarketPayload = { version: number; stamp: string; files: Record<string, string>; datasets: Record<string, MarketRow[]> };

/** Код страницы и все наборы для окна дашборда, одним снимком базы. Доступ проверяет вызывающий */
export async function marketPayload(): Promise<MarketPayload | null> {
  const [bundle, sets] = await prisma.$transaction(
    [
      prisma.marketBundle.findUnique({ where: { id: BUNDLE_ID }, select: { version: true, uploadedAt: true, files: true } }),
      prisma.marketDataset.findMany({ select: { name: true, rows: true }, orderBy: { name: "asc" } }),
    ],
    { isolationLevel: "RepeatableRead" },
  );
  if (!bundle) return null;
  const datasets: Record<string, MarketRow[]> = {};
  for (const s of sets) datasets[s.name] = s.rows as MarketRow[];
  return { version: bundle.version, stamp: stampOf(bundle.version, bundle.uploadedAt), files: bundle.files as Record<string, string>, datasets };
}

// ---------- Готовый ответ с данными в памяти процесса ----------
// Ответ с кодом и наборами весит мегабайты: каждый раз собирать его заново (JSONB из базы, объекты, JSON.stringify)
// дорого. Готовый текст ответа держится в памяти по отпечатку пакета. На каждый запрос из базы читаются только
// номер версии и время загрузки: совпали с памятью, отдаётся готовый текст. В бою процесс один, но проверка по базе
// не даст отдать старые цифры, если пакет сменился мимо этого процесса. Загрузка пакета сбрасывает память сразу.

export type MarketBody = {
  stamp: string;
  version: number;
  body: string;
  /** Отпечаток пакета для заголовка ETag */
  etag: string;
  /** Тот же ответ, сжатый gzip: считается один раз на пакет при первом запросе */
  gzip: Buffer | null;
};

let bodyCache: { stamp: string; body: Promise<MarketBody | null> } | null = null;

/** Сбросить готовый ответ: новый пакет загружен */
export function resetMarketBodyCache(): void {
  bodyCache = null;
}

async function buildBody(): Promise<MarketBody | null> {
  const payload = await marketPayload();
  if (!payload) return null;
  return {
    stamp: payload.stamp,
    version: payload.version,
    body: JSON.stringify({ ok: true, version: payload.version, files: payload.files, datasets: payload.datasets }),
    etag: marketEtag(payload.stamp),
    gzip: null,
  };
}

/**
 * Текст ответа для окна дашборда: {ok, version, files, datasets}. null: пакета нет. Доступ проверяет вызывающий.
 * Одновременные запросы при пустой памяти ждут одну сборку
 */
export async function marketDataBody(): Promise<MarketBody | null> {
  const head = await prisma.marketBundle.findUnique({ where: { id: BUNDLE_ID }, select: { version: true, uploadedAt: true } });
  if (!head) {
    bodyCache = null;
    return null;
  }
  const stamp = stampOf(head.version, head.uploadedAt);
  let entry = bodyCache;
  if (!entry || entry.stamp !== stamp) {
    const fresh = { stamp, body: buildBody() };
    entry = bodyCache = fresh;
    fresh.body.then(
      (b) => {
        if (bodyCache !== fresh) return;
        // Пока собирали, пакет сменился: в памяти остаётся то, что реально собрано, со своим отпечатком
        if (!b) bodyCache = null;
        else if (b.stamp !== stamp) bodyCache = { stamp: b.stamp, body: Promise.resolve(b) };
      },
      () => {
        if (bodyCache === fresh) bodyCache = null;
      },
    );
  }
  return entry.body;
}

/**
 * Тот же ответ, сжатый gzip. Пакет весит мегабайты, а сжимается в разы: сжатие считается один раз на версию пакета
 * и лежит рядом с готовым текстом, поэтому повторные запросы его не пересчитывают
 */
export function marketGzipBody(entry: MarketBody): Buffer {
  if (!entry.gzip) entry.gzip = gzipSync(Buffer.from(entry.body, "utf8"), { level: 6 });
  return entry.gzip;
}

/** Наборы для подписи «О данных»: имя, название, строки, без самих строк */
export async function marketDatasets(): Promise<{ name: string; title: string; rowCount: number }[]> {
  return prisma.marketDataset.findMany({ select: { name: true, title: true, rowCount: true }, orderBy: { name: "asc" } });
}

/** Загрузить пакет: прежний код и все прежние наборы уходят, новые встают одной транзакцией */
export async function uploadMarketBundle(actor: Actor, bundle: MarketBundleInput, bytes: number, now = new Date()): Promise<MarketMeta> {
  if (!canUploadMarket(actor)) throw new TaskRuleError(MARKET_UPLOAD_ONLY);
  await prisma.$transaction(
    async (tx) => {
      // Две загрузки сразу не перемешают наборы: вторая ждёт первую
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('market.upload'))::text`;
      const before = await tx.marketBundle.findUnique({ where: { id: BUNDLE_ID }, select: { version: true, datasetsCount: true, rowsTotal: true } });
      const version = (before?.version ?? 0) + 1;
      await tx.marketDataset.deleteMany();
      for (const [name, set] of Object.entries(bundle.datasets)) {
        await tx.marketDataset.create({ data: { name, title: set.title, description: set.description, rows: set.rows as Prisma.InputJsonValue, rowCount: set.rows.length, updatedAt: now } });
      }
      const data = { version, files: bundle.files, datasetsCount: bundle.datasetsCount, rowsTotal: bundle.rowsTotal, bytes, uploadedAt: now, uploadedById: actor.personId, uploadedByName: actor.fullName };
      await tx.marketBundle.upsert({ where: { id: BUNDLE_ID }, update: data, create: { id: BUNDLE_ID, ...data } });
      await tx.auditLog.create({
        data: {
          action: "market.upload",
          actorId: actor.personId,
          actorName: actor.fullName,
          source: "APP",
          entity: "market",
          entityId: BUNDLE_ID,
          field: "Пакет рынка КАСКО и ОСАГО",
          before: before ? `Наборов ${before.datasetsCount}, строк ${before.rowsTotal}` : undefined,
          after: `Наборов ${bundle.datasetsCount}, строк ${bundle.rowsTotal}, файлов кода ${Object.keys(bundle.files).length}`,
          ip: actor.ip ?? null,
          via: actor.via ?? null,
        },
      });
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
  // Готовый ответ прежнего пакета больше не нужен: следующий запрос соберёт новый
  resetMarketBodyCache();
  return (await marketMeta())!;
}
