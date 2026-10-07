-- CreateEnum
CREATE TYPE "PromiseResult" AS ENUM ('DONE', 'PARTIAL', 'NOT_DONE', 'DROPPED');

-- AlterEnum: «Выполнена частично» рядом с «Выполнена»
ALTER TYPE "TaskStatus" ADD VALUE 'PARTIAL' AFTER 'DONE';

-- Закрытая задача без итога или причины невозможна, теперь и частично выполненная. Сравнение по тексту: новое значение
-- перечисления в этой же транзакции использовать нельзя
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_closed_note";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_closed_note" CHECK ("status"::text NOT IN ('DONE', 'PARTIAL', 'FAILED', 'CANCELLED') OR char_length(btrim(coalesce("resolution", ''))) > 0);

-- CreateTable
CREATE TABLE "promise_reviews" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "entryId" TEXT,
    "what" TEXT NOT NULL,
    "result" "PromiseResult" NOT NULL,
    "note" TEXT,
    "carriedId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "promise_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promise_reviews_entryId_key" ON "promise_reviews"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "promise_reviews_carriedId_key" ON "promise_reviews"("carriedId");

-- CreateIndex
CREATE INDEX "promise_reviews_weekId_authorId_idx" ON "promise_reviews"("weekId", "authorId");

-- AddForeignKey
ALTER TABLE "promise_reviews" ADD CONSTRAINT "promise_reviews_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promise_reviews" ADD CONSTRAINT "promise_reviews_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promise_reviews" ADD CONSTRAINT "promise_reviews_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "weekly_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promise_reviews" ADD CONSTRAINT "promise_reviews_carriedId_fkey" FOREIGN KEY ("carriedId") REFERENCES "weekly_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Текст обещания и фраза итога короткие: одна мысль
ALTER TABLE "promise_reviews" ADD CONSTRAINT "promise_reviews_what_len" CHECK (char_length("what") BETWEEN 1 AND 1000);
ALTER TABLE "promise_reviews" ADD CONSTRAINT "promise_reviews_note_len" CHECK ("note" IS NULL OR char_length("note") <= 300);
-- Не сделано, частично и снято: только с фразой
ALTER TABLE "promise_reviews" ADD CONSTRAINT "promise_reviews_note_needed" CHECK ("result" = 'DONE' OR char_length(btrim(coalesce("note", ''))) > 0);
-- Перенести в план можно только невыполненное
ALTER TABLE "promise_reviews" ADD CONSTRAINT "promise_reviews_carry_open" CHECK ("carriedId" IS NULL OR "result" IN ('PARTIAL', 'NOT_DONE'));

-- Живые обновления: итоги обещаний видны в ленте и отчёте CEO
CREATE TRIGGER "promise_reviews_live" AFTER INSERT OR UPDATE OR DELETE ON "promise_reviews" FOR EACH STATEMENT EXECUTE FUNCTION "weekly_live_change"('weekly');
