-- повторяемая: этап 35 (прогноз месяца в процессах). Снимки загрузок LRF, отметка «прогноз проверен», факт по дням и
-- событие в «Мне». Каждый шаг проверяет, что уже сделано: Prisma применяет операторы без общей транзакции, а платформа
-- может перезапустить контейнер на полпути

ALTER TYPE "InboxKind" ADD VALUE IF NOT EXISTS 'PLAN';

CREATE TABLE IF NOT EXISTS "plan_pulls" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byName" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    CONSTRAINT "plan_pulls_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "plan_pulls_month_at_idx" ON "plan_pulls"("month", "at");

CREATE TABLE IF NOT EXISTS "plan_checks" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plan_checks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "plan_checks_month_product_at_idx" ON "plan_checks"("month", "product", "at");
CREATE INDEX IF NOT EXISTS "plan_checks_authorId_idx" ON "plan_checks"("authorId");
DO $$ BEGIN ALTER TABLE "plan_checks" ADD CONSTRAINT "plan_checks_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "plan_facts" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "loadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loadedBy" TEXT NOT NULL,
    CONSTRAINT "plan_facts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "plan_facts_product_metric_day_key" ON "plan_facts"("product", "metric", "day");
CREATE INDEX IF NOT EXISTS "plan_facts_month_idx" ON "plan_facts"("month");
-- Показатели факта: продажи, выручка и промо-маржа; месяц совпадает с днём
DO $$ BEGIN ALTER TABLE "plan_facts" ADD CONSTRAINT "plan_facts_metric_check" CHECK ("metric" IN ('units', 'revenue', 'promoMargin')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_facts" ADD CONSTRAINT "plan_facts_month_day" CHECK ("month" = to_char("day", 'YYYY-MM')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
