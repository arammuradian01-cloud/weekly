-- повторяемая: этап 35б (партнёрский канал в прогнозе месяца). Партнёры из LRF b2b, бюджет канала из P&L b2b и
-- корректировки команды канала. Каждый шаг проверяет, что уже сделано: Prisma применяет операторы без общей транзакции,
-- а платформа может перезапустить контейнер на полпути

CREATE TABLE IF NOT EXISTS "plan_partners" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "lbe" JSONB NOT NULL,
    "pulledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plan_partners_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "plan_partners_month_code_key" ON "plan_partners"("month", "code");
CREATE INDEX IF NOT EXISTS "plan_partners_month_idx" ON "plan_partners"("month");
DO $$ BEGIN ALTER TABLE "plan_partners" ADD CONSTRAINT "plan_partners_channel_check" CHECK ("channel" IN ('cpa', 'agents')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "plan_partner_totals" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "version" "PlanVersion" NOT NULL,
    "revenue" DOUBLE PRECISION,
    "costs" DOUBLE PRECISION,
    "margin" DOUBLE PRECISION,
    "pulledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plan_partner_totals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "plan_partner_totals_month_product_channel_version_key" ON "plan_partner_totals"("month", "product", "channel", "version");
CREATE INDEX IF NOT EXISTS "plan_partner_totals_month_idx" ON "plan_partner_totals"("month");

CREATE TABLE IF NOT EXISTS "plan_partner_adjustments" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "previous" DOUBLE PRECISION,
    "reason" "ForecastReason" NOT NULL,
    "comment" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plan_partner_adjustments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "plan_partner_adjustments_month_partner_createdAt_idx" ON "plan_partner_adjustments"("month", "partner", "createdAt");
CREATE INDEX IF NOT EXISTS "plan_partner_adjustments_authorId_idx" ON "plan_partner_adjustments"("authorId");
DO $$ BEGIN ALTER TABLE "plan_partner_adjustments" ADD CONSTRAINT "plan_partner_adjustments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Драйверы партнёра: ёмкость, полисы, выручка на полис, конверсия в кросс, комиссия
DO $$ BEGIN ALTER TABLE "plan_partner_adjustments" ADD CONSTRAINT "plan_partner_adjustments_metric_check" CHECK ("metric" IN ('capacity', 'policies', 'rpu', 'crUpsale', 'commission')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
