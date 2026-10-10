-- повторяемая: этап 32 (прогноз месяца по драйверам). Каждый шаг проверяет, что уже сделано, потому что Prisma
-- применяет операторы без общей транзакции, а платформа может перезапустить контейнер на полпути

DO $$ BEGIN CREATE TYPE "PlanVersion" AS ENUM ('BUDGET', 'LBE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "plan_lines" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "version" "PlanVersion" NOT NULL,
    "product" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "pulledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plan_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plan_adjustments" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "previous" DOUBLE PRECISION,
    "reason" "ForecastReason" NOT NULL,
    "comment" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plan_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "plan_lines_month_version_product_metric_key" ON "plan_lines"("month", "version", "product", "metric");
CREATE INDEX IF NOT EXISTS "plan_lines_month_idx" ON "plan_lines"("month");
CREATE INDEX IF NOT EXISTS "plan_adjustments_month_product_createdAt_idx" ON "plan_adjustments"("month", "product", "createdAt");
CREATE INDEX IF NOT EXISTS "plan_adjustments_authorId_idx" ON "plan_adjustments"("authorId");

DO $$ BEGIN ALTER TABLE "plan_adjustments" ADD CONSTRAINT "plan_adjustments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Месяц вида 2026-10, обоснование корректировки одной фразой
DO $$ BEGIN ALTER TABLE "plan_lines" ADD CONSTRAINT "plan_lines_month_format" CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_adjustments" ADD CONSTRAINT "plan_adjustments_month_format" CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_adjustments" ADD CONSTRAINT "plan_adjustments_comment_len" CHECK (char_length(btrim("comment")) BETWEEN 3 AND 300); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
