-- повторяемая: этап 81, факт к плану по неделям. Справочник строк и план по неделям из таблицы недель (единая воронка,
-- этап 4), факт по неделям и фиксации недель. Каждый оператор проверяет, что уже сделан

CREATE TABLE IF NOT EXISTS "week_plan_lines" (
    "id" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,
    "product" TEXT NOT NULL,
    "cut" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "saleType" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "monthOnly" BOOLEAN NOT NULL,
    "label" TEXT NOT NULL,
    CONSTRAINT "week_plan_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "week_plan_values" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "week" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "part" INTEGER NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "week_plan_values_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "week_plan_values_lineId_version_week_month_part_key" ON "week_plan_values"("lineId", "version", "week", "month", "part");
CREATE INDEX IF NOT EXISTS "week_plan_values_version_week_idx" ON "week_plan_values"("version", "week");

CREATE TABLE IF NOT EXISTS "week_facts" (
    "lineId" TEXT NOT NULL,
    "week" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "updatedAt" TEXT,
    "source" TEXT,
    "pulledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "week_facts_pkey" PRIMARY KEY ("lineId", "week")
);
CREATE INDEX IF NOT EXISTS "week_facts_week_idx" ON "week_facts"("week");

CREATE TABLE IF NOT EXISTS "week_fact_fixes" (
    "id" TEXT NOT NULL,
    "week" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "delta" DOUBLE PRECISION,
    "fixedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "week_fact_fixes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "week_fact_fixes_week_lineId_version_key" ON "week_fact_fixes"("week", "lineId", "version");
CREATE INDEX IF NOT EXISTS "week_fact_fixes_week_idx" ON "week_fact_fixes"("week");
