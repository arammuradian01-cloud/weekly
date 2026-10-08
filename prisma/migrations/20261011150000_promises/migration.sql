-- повторяемая: на стенде 08.10.2026 она была убита платформой на полпути, а Prisma применяет
-- операторы без общей транзакции, поэтому часть объектов уже существовала. Каждый шаг проверяет, что сделано

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PromiseResult') THEN
    CREATE TYPE "PromiseResult" AS ENUM ('DONE', 'PARTIAL', 'NOT_DONE', 'DROPPED');
  END IF;
END $$;

-- AlterEnum: «Выполнена частично» рядом с «Выполнена»
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'PARTIAL' AFTER 'DONE';

-- Закрытая задача без итога или причины невозможна, теперь и частично выполненная. Сравнение по тексту: новое значение
-- перечисления в этой же транзакции использовать нельзя
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_closed_note";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_closed_note" CHECK ("status"::text NOT IN ('DONE', 'PARTIAL', 'FAILED', 'CANCELLED') OR char_length(btrim(coalesce("resolution", ''))) > 0);

-- CreateTable
CREATE TABLE IF NOT EXISTS "promise_reviews" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "promise_reviews_entryId_key" ON "promise_reviews"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "promise_reviews_carriedId_key" ON "promise_reviews"("carriedId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "promise_reviews_weekId_authorId_idx" ON "promise_reviews"("weekId", "authorId");

-- AddForeignKey
ALTER TABLE "promise_reviews" DROP CONSTRAINT IF EXISTS "promise_reviews_weekId_fkey";
ALTER TABLE "promise_reviews" ADD CONSTRAINT "promise_reviews_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promise_reviews" DROP CONSTRAINT IF EXISTS "promise_reviews_authorId_fkey";
ALTER TABLE "promise_reviews" ADD CONSTRAINT "promise_reviews_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promise_reviews" DROP CONSTRAINT IF EXISTS "promise_reviews_entryId_fkey";
ALTER TABLE "promise_reviews" ADD CONSTRAINT "promise_reviews_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "weekly_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promise_reviews" DROP CONSTRAINT IF EXISTS "promise_reviews_carriedId_fkey";
ALTER TABLE "promise_reviews" ADD CONSTRAINT "promise_reviews_carriedId_fkey" FOREIGN KEY ("carriedId") REFERENCES "weekly_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Текст обещания и фраза итога короткие: одна мысль
ALTER TABLE "promise_reviews" DROP CONSTRAINT IF EXISTS "promise_reviews_what_len";
ALTER TABLE "promise_reviews" ADD CONSTRAINT "promise_reviews_what_len" CHECK (char_length("what") BETWEEN 1 AND 1000);
ALTER TABLE "promise_reviews" DROP CONSTRAINT IF EXISTS "promise_reviews_note_len";
ALTER TABLE "promise_reviews" ADD CONSTRAINT "promise_reviews_note_len" CHECK ("note" IS NULL OR char_length("note") <= 300);
-- Не сделано, частично и снято: только с фразой
ALTER TABLE "promise_reviews" DROP CONSTRAINT IF EXISTS "promise_reviews_note_needed";
ALTER TABLE "promise_reviews" ADD CONSTRAINT "promise_reviews_note_needed" CHECK ("result" = 'DONE' OR char_length(btrim(coalesce("note", ''))) > 0);
-- Перенести в план можно только невыполненное
ALTER TABLE "promise_reviews" DROP CONSTRAINT IF EXISTS "promise_reviews_carry_open";
ALTER TABLE "promise_reviews" ADD CONSTRAINT "promise_reviews_carry_open" CHECK ("carriedId" IS NULL OR "result" IN ('PARTIAL', 'NOT_DONE'));

-- Живые обновления: итоги обещаний видны в ленте и отчёте CEO
DROP TRIGGER IF EXISTS "promise_reviews_live" ON "promise_reviews";
CREATE TRIGGER "promise_reviews_live" AFTER INSERT OR UPDATE OR DELETE ON "promise_reviews" FOR EACH STATEMENT EXECUTE FUNCTION "weekly_live_change"('weekly');
