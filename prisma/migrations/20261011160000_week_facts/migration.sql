-- Этап 22б: факты недели в черновике weekly, благодарности, снимок недели

-- AlterEnum
ALTER TYPE "InboxKind" ADD VALUE 'THANKS';

-- AlterTable
ALTER TABLE "weekly_entries" ADD COLUMN     "factKey" TEXT;

-- AlterTable
ALTER TABLE "weekly_reports" ADD COLUMN     "hiddenFacts" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "thanks" TEXT,
ADD COLUMN     "thanksMentions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "week_snapshots" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "takenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL,

    CONSTRAINT "week_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "week_snapshots_weekId_key" ON "week_snapshots"("weekId");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_entries_weekId_authorId_factKey_key" ON "weekly_entries"("weekId", "authorId", "factKey");

-- AddForeignKey
ALTER TABLE "week_snapshots" ADD CONSTRAINT "week_snapshots_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Благодарность одной строкой
ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_thanks_len" CHECK ("thanks" IS NULL OR char_length("thanks") <= 300);

-- Живые обновления: снимок недели виден в отчёте CEO
CREATE TRIGGER "week_snapshots_live" AFTER INSERT OR UPDATE OR DELETE ON "week_snapshots" FOR EACH STATEMENT EXECUTE FUNCTION "weekly_live_change"('weekly');
