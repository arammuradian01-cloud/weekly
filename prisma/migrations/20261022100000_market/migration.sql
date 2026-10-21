-- повторяемая: этап 62, рынок КАСКО и ОСАГО. Пакет рынка (код страницы дашборда) и наборы данных загружает владелец,
-- в репозитории цифр нет. Пункт повестки «Рынок КАСКО и ОСАГО» на первой встрече месяца
ALTER TYPE "AgendaKind" ADD VALUE IF NOT EXISTS 'MARKET';

CREATE TABLE IF NOT EXISTS "market_bundles" (
  "id" TEXT NOT NULL DEFAULT 'current',
  "version" INTEGER NOT NULL,
  "files" JSONB NOT NULL,
  "datasetsCount" INTEGER NOT NULL,
  "rowsTotal" INTEGER NOT NULL,
  "bytes" INTEGER NOT NULL,
  "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uploadedById" TEXT,
  "uploadedByName" TEXT NOT NULL,
  CONSTRAINT "market_bundles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "market_datasets" (
  "name" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "rows" JSONB NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "market_datasets_pkey" PRIMARY KEY ("name")
);
