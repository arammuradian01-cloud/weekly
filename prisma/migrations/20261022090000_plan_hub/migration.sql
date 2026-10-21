-- повторяемая: этап 58 (единая воронка, шаг 1). Хаб данных «Единая воронка: данные»: снимки «Все СК» по дням и строки
-- модели ОСАГО по СК. Каждый оператор проверяет, что уже сделан

CREATE TABLE IF NOT EXISTS "plan_sk_snapshots" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "month" TEXT NOT NULL,
    "sk" TEXT NOT NULL,
    "pool" BOOLEAN NOT NULL,
    "upsale" BOOLEAN NOT NULL,
    "policies" DOUBLE PRECISION NOT NULL,
    "premium" DOUBLE PRECISION,
    "revenue" DOUBLE PRECISION,
    "loadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plan_sk_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "plan_sk_snapshots_day_month_sk_pool_upsale_key" ON "plan_sk_snapshots"("day", "month", "sk", "pool", "upsale");
CREATE INDEX IF NOT EXISTS "plan_sk_snapshots_month_day_idx" ON "plan_sk_snapshots"("month", "day");

CREATE TABLE IF NOT EXISTS "plan_sk_lines" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "sk" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "pulledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plan_sk_lines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "plan_sk_lines_period_sk_metric_key" ON "plan_sk_lines"("period", "sk", "metric");
CREATE INDEX IF NOT EXISTS "plan_sk_lines_period_idx" ON "plan_sk_lines"("period");
