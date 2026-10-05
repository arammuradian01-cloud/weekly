-- CreateEnum
CREATE TYPE "WeeklyState" AS ENUM ('DRAFT', 'SUBMITTED', 'LATE');

-- CreateTable
CREATE TABLE "weeks" (
    "id" TEXT NOT NULL,
    "start" DATE NOT NULL,
    "isoYear" INTEGER NOT NULL,
    "isoNumber" INTEGER NOT NULL,
    "deadline" TIMESTAMPTZ(3) NOT NULL,
    "meetingDate" DATE NOT NULL,
    "closedAt" TIMESTAMPTZ(3),
    "closedById" TEXT,

    CONSTRAINT "weeks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_reports" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "headline" TEXT NOT NULL DEFAULT '',
    "state" "WeeklyState" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "weekly_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_entries" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "authorId" TEXT,
    "directionId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "details" TEXT,
    "impact" TEXT,
    "fact" TEXT,
    "next" TEXT,
    "help" TEXT,
    "links" JSONB NOT NULL DEFAULT '[]',
    "ceo" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "importBatch" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "weekly_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ceo_reports" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "main" TEXT NOT NULL DEFAULT '',
    "risks" TEXT NOT NULL DEFAULT '',
    "next" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ceo_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weeks_start_key" ON "weeks"("start");

-- CreateIndex
CREATE UNIQUE INDEX "weeks_isoYear_isoNumber_key" ON "weeks"("isoYear", "isoNumber");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_reports_weekId_authorId_key" ON "weekly_reports"("weekId", "authorId");

-- CreateIndex
CREATE INDEX "weekly_entries_weekId_authorId_idx" ON "weekly_entries"("weekId", "authorId");

-- CreateIndex
CREATE UNIQUE INDEX "ceo_reports_weekId_key" ON "ceo_reports"("weekId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_weeklyEntryId_fkey" FOREIGN KEY ("weeklyEntryId") REFERENCES "weekly_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_entries" ADD CONSTRAINT "weekly_entries_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_entries" ADD CONSTRAINT "weekly_entries_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_entries" ADD CONSTRAINT "weekly_entries_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "dictionary_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_entries" ADD CONSTRAINT "weekly_entries_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "dictionary_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_entries" ADD CONSTRAINT "weekly_entries_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "dictionary_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceo_reports" ADD CONSTRAINT "ceo_reports_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceo_reports" ADD CONSTRAINT "ceo_reports_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Правила раздела 3 ТЗ в базе
ALTER TABLE "weekly_entries" ADD CONSTRAINT "weekly_entries_what_len" CHECK (char_length(btrim("what")) BETWEEN 1 AND 150);
ALTER TABLE "weekly_entries" ADD CONSTRAINT "weekly_entries_details_len" CHECK ("details" IS NULL OR char_length("details") <= 1000);
ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_headline_len" CHECK (char_length("headline") <= 150);
ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_submitted_at" CHECK ("state" = 'DRAFT' OR "submittedAt" IS NOT NULL OR "headline" = '');
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_start_monday" CHECK (EXTRACT(ISODOW FROM "start") = 1);

-- Блоки «Цифры и прогноз» и «Трафик и маркетинг» команда уже ведёт в Insurance&Invest Bord: открыты 05.10.2026
UPDATE "dictionary_items" SET "active" = true WHERE "kind" = 'WEEKLY_BLOCK' AND "code" = 'numbers';
