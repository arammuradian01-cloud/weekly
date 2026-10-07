-- CreateEnum
CREATE TYPE "ForecastMetric" AS ENUM ('REVENUE', 'PROMO_MARGIN', 'DIRECT_MARGIN', 'SALES');

-- CreateEnum
CREATE TYPE "ForecastReason" AS ENUM ('TRAFFIC', 'CONVERSION', 'CHECK_KV', 'PARTNER_SK', 'BUDGET_BASE', 'OTHER');

-- CreateTable
CREATE TABLE "numbers_rows" (
    "key" TEXT NOT NULL,
    "article" TEXT NOT NULL,
    "iface" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "mapping" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,
    "values" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "numbers_rows_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "forecasts" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "directionId" TEXT NOT NULL,
    "metric" "ForecastMetric" NOT NULL,
    "month" TEXT NOT NULL,
    "budget" DOUBLE PRECISION,
    "forecast" DOUBLE PRECISION NOT NULL,
    "reason" "ForecastReason",
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "numbers_rows_ord_idx" ON "numbers_rows"("ord");

-- CreateIndex
CREATE INDEX "forecasts_month_directionId_idx" ON "forecasts"("month", "directionId");

-- CreateIndex
CREATE UNIQUE INDEX "forecasts_weekId_authorId_directionId_metric_month_key" ON "forecasts"("weekId", "authorId", "directionId", "metric", "month");

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "dictionary_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Ограничения (этап 24): месяц в виде ГГГГ-ММ, прогноз и бюджет конечные числа, комментарий не длиннее 500 знаков
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_month_format" CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_values_finite" CHECK ("forecast" = "forecast" AND ("budget" IS NULL OR "budget" = "budget"));
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_comment_len" CHECK ("comment" IS NULL OR length("comment") <= 500);

-- Живые обновления: прогноз меняет экраны weekly и отчёт
CREATE TRIGGER "forecasts_live" AFTER INSERT OR UPDATE OR DELETE ON "forecasts" FOR EACH STATEMENT EXECUTE FUNCTION "weekly_live_change"('weekly');
