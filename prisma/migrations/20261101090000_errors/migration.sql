-- повторяемая: этап 86, сбор сбоев приложения в одном месте. Сбои с сервера, из браузера и жалобы политики CSP
-- складываются по отпечатку: у одинакового сбоя растёт счётчик, а не число строк. Содержимого задач и weekly здесь
-- нет. Повторный запуск безопасен: тип создаётся блоком DO, таблица и индексы через IF NOT EXISTS
DO $$
BEGIN
  IF to_regtype('"ErrorSource"') IS NULL THEN
    CREATE TYPE "ErrorSource" AS ENUM ('SERVER', 'BROWSER', 'CSP');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "error_events" (
  "id" BIGSERIAL NOT NULL,
  "source" "ErrorSource" NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "place" TEXT,
  "stack" TEXT,
  "times" INTEGER NOT NULL DEFAULT 1,
  "firstAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notifiedAt" TIMESTAMPTZ(3),
  CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "error_events_source_fingerprint_key" ON "error_events" ("source", "fingerprint");
CREATE INDEX IF NOT EXISTS "error_events_lastAt_idx" ON "error_events" ("lastAt");
