-- CreateEnum
CREATE TYPE "ReactionKind" AS ENUM ('ACCEPTED', 'QUESTION', 'DISCUSS', 'THANKS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InboxKind" ADD VALUE 'MENTION';
ALTER TYPE "InboxKind" ADD VALUE 'ENTRY_COMMENT';
ALTER TYPE "InboxKind" ADD VALUE 'REACTION';

-- AlterTable
ALTER TABLE "inbox_events" ADD COLUMN     "entryCommentId" TEXT,
ADD COLUMN     "entryId" TEXT,
ADD COLUMN     "mailedAt" TIMESTAMPTZ(3),
ADD COLUMN     "seenAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "people" ADD COLUMN     "mailPrefs" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "task_comments" ADD COLUMN     "editedAt" TIMESTAMPTZ(3),
ADD COLUMN     "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "weekly_entries" ADD COLUMN     "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "entry_comments" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMPTZ(3),

    CONSTRAINT "entry_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entry_watches" (
    "entryId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entry_watches_pkey" PRIMARY KEY ("entryId","personId")
);

-- CreateTable
CREATE TABLE "reactions" (
    "id" TEXT NOT NULL,
    "kind" "ReactionKind" NOT NULL,
    "personId" TEXT NOT NULL,
    "entryId" TEXT,
    "entryCommentId" TEXT,
    "taskCommentId" TEXT,
    "question" TEXT,
    "discussedAt" TIMESTAMPTZ(3),
    "discussedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_marks" (
    "personId" TEXT NOT NULL,
    "week" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_marks_pkey" PRIMARY KEY ("personId","week","kind")
);

-- CreateIndex
CREATE INDEX "entry_comments_entryId_at_idx" ON "entry_comments"("entryId", "at");

-- CreateIndex
CREATE INDEX "entry_watches_personId_idx" ON "entry_watches"("personId");

-- CreateIndex
CREATE INDEX "reactions_entryId_idx" ON "reactions"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "reactions_personId_kind_entryId_key" ON "reactions"("personId", "kind", "entryId");

-- CreateIndex
CREATE UNIQUE INDEX "reactions_personId_kind_entryCommentId_key" ON "reactions"("personId", "kind", "entryCommentId");

-- CreateIndex
CREATE UNIQUE INDEX "reactions_personId_kind_taskCommentId_key" ON "reactions"("personId", "kind", "taskCommentId");

-- CreateIndex
CREATE INDEX "inbox_events_mailedAt_createdAt_idx" ON "inbox_events"("mailedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "inbox_events" ADD CONSTRAINT "inbox_events_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "weekly_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_events" ADD CONSTRAINT "inbox_events_entryCommentId_fkey" FOREIGN KEY ("entryCommentId") REFERENCES "entry_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_comments" ADD CONSTRAINT "entry_comments_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "weekly_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_comments" ADD CONSTRAINT "entry_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_watches" ADD CONSTRAINT "entry_watches_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "weekly_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_watches" ADD CONSTRAINT "entry_watches_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "weekly_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_entryCommentId_fkey" FOREIGN KEY ("entryCommentId") REFERENCES "entry_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_taskCommentId_fkey" FOREIGN KEY ("taskCommentId") REFERENCES "task_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_discussedById_fkey" FOREIGN KEY ("discussedById") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_marks" ADD CONSTRAINT "mail_marks_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Этап 20: у реакции ровно одна цель, у «Обсудить на встрече» обязателен вопрос
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_one_target" CHECK (num_nonnulls("entryId", "entryCommentId", "taskCommentId") = 1);
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_discuss_question" CHECK ("kind" <> 'DISCUSS' OR length(btrim(coalesce("question", ''))) > 0);

-- Старые события писем не порождают: письма только о том, что случится после выкладки
UPDATE "inbox_events" SET "mailedAt" = "createdAt" WHERE "mailedAt" IS NULL;

-- Живые обновления (этап 20): база сама сообщает, что изменилось. В сообщении только вид изменения и, для «Мне»,
-- id адресата: содержимое экран берёт с сервера обычным запросом с проверкой прав
CREATE OR REPLACE FUNCTION "weekly_live_inbox"() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('weekly_live', json_build_object('t', 'inbox', 'p', NEW."recipientId")::text);
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "weekly_live_change"() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('weekly_live', json_build_object('t', TG_ARGV[0])::text);
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "inbox_events_live" AFTER INSERT OR UPDATE OF "doneAt", "snoozeUntil" ON "inbox_events" FOR EACH ROW EXECUTE FUNCTION "weekly_live_inbox"();
CREATE TRIGGER "tasks_live" AFTER INSERT OR UPDATE OR DELETE ON "tasks" FOR EACH STATEMENT EXECUTE FUNCTION "weekly_live_change"('tasks');
CREATE TRIGGER "task_comments_live" AFTER INSERT OR UPDATE OR DELETE ON "task_comments" FOR EACH STATEMENT EXECUTE FUNCTION "weekly_live_change"('tasks');
CREATE TRIGGER "weekly_entries_live" AFTER INSERT OR UPDATE OR DELETE ON "weekly_entries" FOR EACH STATEMENT EXECUTE FUNCTION "weekly_live_change"('weekly');
CREATE TRIGGER "weekly_reports_live" AFTER INSERT OR UPDATE OR DELETE ON "weekly_reports" FOR EACH STATEMENT EXECUTE FUNCTION "weekly_live_change"('weekly');
CREATE TRIGGER "entry_comments_live" AFTER INSERT OR UPDATE OR DELETE ON "entry_comments" FOR EACH STATEMENT EXECUTE FUNCTION "weekly_live_change"('weekly');
CREATE TRIGGER "reactions_live" AFTER INSERT OR UPDATE OR DELETE ON "reactions" FOR EACH STATEMENT EXECUTE FUNCTION "weekly_live_change"('weekly');
