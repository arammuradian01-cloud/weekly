-- Этап 60: новости по продуктам и дайджесты. Миграция повторяемая: все шаги с IF NOT EXISTS
ALTER TYPE "InboxKind" ADD VALUE IF NOT EXISTS 'NEWS';

ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "newsPrefs" JSONB NOT NULL DEFAULT '{}';

DO $$ BEGIN
  CREATE TYPE "NewsDigestKind" AS ENUM ('DAILY', 'WEEKLY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "news_sources" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "lastFetchAt" TIMESTAMPTZ(3),
  "lastOkAt" TIMESTAMPTZ(3),
  "lastError" TEXT,
  "lastCount" INTEGER NOT NULL DEFAULT 0,
  "failCount" INTEGER NOT NULL DEFAULT 0,
  "etag" TEXT,
  "lastModified" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "news_sources_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "news_sources_url_key" ON "news_sources"("url");

CREATE TABLE IF NOT EXISTS "news_items" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "guid" TEXT NOT NULL,
  "urlKey" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "publishedAt" TIMESTAMPTZ(3) NOT NULL,
  "directions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "enrichedBy" TEXT,
  "enrichedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "news_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "news_items_urlKey_key" ON "news_items"("urlKey");
CREATE UNIQUE INDEX IF NOT EXISTS "news_items_sourceId_guid_key" ON "news_items"("sourceId", "guid");
CREATE INDEX IF NOT EXISTS "news_items_publishedAt_idx" ON "news_items"("publishedAt");
CREATE INDEX IF NOT EXISTS "news_items_createdAt_idx" ON "news_items"("createdAt");
DO $$ BEGIN
  ALTER TABLE "news_items" ADD CONSTRAINT "news_items_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "news_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "news_digests" (
  "id" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "kind" "NewsDigestKind" NOT NULL,
  "periodKey" TEXT NOT NULL,
  "directions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "itemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "sentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "mailedAt" TIMESTAMPTZ(3),
  CONSTRAINT "news_digests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "news_digests_personId_kind_periodKey_key" ON "news_digests"("personId", "kind", "periodKey");
CREATE INDEX IF NOT EXISTS "news_digests_personId_sentAt_idx" ON "news_digests"("personId", "sentAt");
DO $$ BEGIN
  ALTER TABLE "news_digests" ADD CONSTRAINT "news_digests_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
