-- Этап 23: встреча 2.0, повестка, решения

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('PLANNED', 'LIVE', 'DONE');

-- CreateEnum
CREATE TYPE "AgendaKind" AS ENUM ('FOLLOW_UP', 'REQUEST', 'TASK_STATE', 'TASK_ATTENTION', 'QUESTION', 'PROPOSAL', 'PERSON', 'MANUAL');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'PLANNED',
    "leaderId" TEXT,
    "currentItemId" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "agendaBuiltAt" TIMESTAMPTZ(3),
    "protocol" TEXT,
    "protocolSentAt" TIMESTAMPTZ(3),
    "notionUrl" TEXT,
    "timerMinutes" INTEGER NOT NULL DEFAULT 7,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agenda_items" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "kind" "AgendaKind" NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "autoKey" TEXT,
    "removedAt" TIMESTAMPTZ(3),
    "taskId" TEXT,
    "entryId" TEXT,
    "requestId" TEXT,
    "personId" TEXT,
    "reactionId" TEXT,
    "discussedAt" TIMESTAMPTZ(3),
    "discussedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agenda_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT,
    "itemId" TEXT,
    "teamId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "ownerId" TEXT,
    "date" DATE NOT NULL,
    "status" "DecisionStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_tasks" (
    "decisionId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,

    CONSTRAINT "decision_tasks_pkey" PRIMARY KEY ("decisionId","taskId")
);

-- CreateIndex
CREATE INDEX "meetings_teamId_date_idx" ON "meetings"("teamId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_weekId_teamId_key" ON "meetings"("weekId", "teamId");

-- CreateIndex
CREATE INDEX "agenda_items_meetingId_sortOrder_idx" ON "agenda_items"("meetingId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "agenda_items_meetingId_autoKey_key" ON "agenda_items"("meetingId", "autoKey");

-- CreateIndex
CREATE INDEX "decisions_teamId_date_idx" ON "decisions"("teamId", "date");

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "weekly_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "help_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_discussedById_fkey" FOREIGN KEY ("discussedById") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "agenda_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_tasks" ADD CONSTRAINT "decision_tasks_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_tasks" ADD CONSTRAINT "decision_tasks_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Ограничения текста
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_title_len" CHECK (char_length("title") BETWEEN 1 AND 300);
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_note_len" CHECK ("note" IS NULL OR char_length("note") <= 1000);
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_text_len" CHECK (char_length("text") BETWEEN 1 AND 1000);
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_cancel_reason" CHECK ("status" <> 'CANCELLED' OR char_length(btrim(coalesce("cancelReason", ''))) > 0);
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_timer" CHECK ("timerMinutes" BETWEEN 1 AND 60);

-- Поиск по решениям с русскими словоформами
CREATE INDEX "decisions_text_search" ON "decisions" USING GIN (to_tsvector('russian', "text"));

-- Живые обновления: встреча, повестка и решения видны всем участникам сразу
CREATE TRIGGER "meetings_live" AFTER INSERT OR UPDATE OR DELETE ON "meetings" FOR EACH STATEMENT EXECUTE FUNCTION "weekly_live_change"('meeting');
CREATE TRIGGER "agenda_items_live" AFTER INSERT OR UPDATE OR DELETE ON "agenda_items" FOR EACH STATEMENT EXECUTE FUNCTION "weekly_live_change"('meeting');
CREATE TRIGGER "decisions_live" AFTER INSERT OR UPDATE OR DELETE ON "decisions" FOR EACH STATEMENT EXECUTE FUNCTION "weekly_live_change"('meeting');
