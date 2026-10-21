// Рынок КАСКО и ОСАГО на сервере (этап 62): загрузка пакета рынка и выдача его странице. Пакет целиком заменяет
// прежний одной транзакцией: код страницы и все наборы данных. Права проверяются здесь и в обработчиках, экран
// только прячет кнопки. Цифры в журнал и лог не пишутся: только число наборов и строк.

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { canUploadMarket } from "./access";
import type { MarketBundleInput, MarketRow } from "./bundle";

const BUNDLE_ID = "current";

export const MARKET_UPLOAD_ONLY = "Пакет рынка загружает владелец при личном входе";

export type MarketMeta = {
  version: number;
  uploadedAt: string;
  uploadedBy: string;
  datasetsCount: number;
  rowsTotal: number;
  /** Отпечаток для кэша браузера: меняется с каждой загрузкой */
  etag: string;
};

const etagOf = (version: number, uploadedAt: Date) => `"market-${version}-${uploadedAt.getTime()}"`;

/** Сведения о загруженном пакете без кода и цифр. null: пакета ещё нет */
export async function marketMeta(db: Prisma.TransactionClient | typeof prisma = prisma): Promise<MarketMeta | null> {
  const row = await db.marketBundle.findUnique({ where: { id: BUNDLE_ID }, select: { version: true, uploadedAt: true, uploadedByName: true, datasetsCount: true, rowsTotal: true } });
  if (!row) return null;
  return { version: row.version, uploadedAt: row.uploadedAt.toISOString(), uploadedBy: row.uploadedByName, datasetsCount: row.datasetsCount, rowsTotal: row.rowsTotal, etag: etagOf(row.version, row.uploadedAt) };
}

export type MarketPayload = { version: number; etag: string; files: Record<string, string>; datasets: Record<string, MarketRow[]> };

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
  return { version: bundle.version, etag: etagOf(bundle.version, bundle.uploadedAt), files: bundle.files as Record<string, string>, datasets };
}

/** Совпадает ли отпечаток из заголовка If-None-Match: браузеру хватит ответа 304 */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((t) => t.trim().replace(/^W\//, "") === etag || t.trim() === "*");
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
  return (await marketMeta())!;
}
