-- AlterTable
ALTER TABLE "inbox_events" ADD COLUMN     "reactionId" TEXT;

-- CreateIndex
CREATE INDEX "inbox_events_entryId_idx" ON "inbox_events"("entryId");

-- CreateIndex
CREATE INDEX "inbox_events_entryCommentId_idx" ON "inbox_events"("entryCommentId");

-- CreateIndex
CREATE INDEX "inbox_events_reactionId_idx" ON "inbox_events"("reactionId");

-- CreateIndex
CREATE INDEX "reactions_entryCommentId_idx" ON "reactions"("entryCommentId");

-- CreateIndex
CREATE INDEX "reactions_taskCommentId_idx" ON "reactions"("taskCommentId");

-- AddForeignKey
ALTER TABLE "inbox_events" ADD CONSTRAINT "inbox_events_reactionId_fkey" FOREIGN KEY ("reactionId") REFERENCES "reactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Событие ушло из «Мне» вместе с реакцией или комментарием: счётчик у адресата обновляется сразу
CREATE OR REPLACE FUNCTION "weekly_live_inbox_gone"() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('weekly_live', json_build_object('t', 'inbox', 'p', OLD."recipientId")::text);
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "inbox_events_live_gone" AFTER DELETE ON "inbox_events" FOR EACH ROW EXECUTE FUNCTION "weekly_live_inbox_gone"();
