-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DONE', 'DECLINED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "InboxKind" ADD VALUE 'REQUEST';
ALTER TYPE "InboxKind" ADD VALUE 'REQUEST_ANSWER';

-- AlterTable
ALTER TABLE "inbox_events" ADD COLUMN     "requestId" TEXT;

-- CreateTable
CREATE TABLE "help_requests" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "authorId" TEXT NOT NULL,
    "addresseeId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "due" DATE NOT NULL,
    "acceptedDue" DATE,
    "status" "RequestStatus" NOT NULL DEFAULT 'OPEN',
    "answer" TEXT,
    "taskId" TEXT,
    "entryId" TEXT,
    "resultTaskId" TEXT,
    "remindedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "answeredAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "help_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "help_requests_number_key" ON "help_requests"("number");

-- CreateIndex
CREATE INDEX "help_requests_addresseeId_status_idx" ON "help_requests"("addresseeId", "status");

-- CreateIndex
CREATE INDEX "help_requests_authorId_status_idx" ON "help_requests"("authorId", "status");

-- CreateIndex
CREATE INDEX "help_requests_taskId_idx" ON "help_requests"("taskId");

-- CreateIndex
CREATE INDEX "help_requests_entryId_idx" ON "help_requests"("entryId");

-- CreateIndex
CREATE INDEX "help_requests_resultTaskId_idx" ON "help_requests"("resultTaskId");

-- CreateIndex
CREATE INDEX "inbox_events_requestId_idx" ON "inbox_events"("requestId");

-- AddForeignKey
ALTER TABLE "inbox_events" ADD CONSTRAINT "inbox_events_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "help_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "help_requests" ADD CONSTRAINT "help_requests_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "help_requests" ADD CONSTRAINT "help_requests_addresseeId_fkey" FOREIGN KEY ("addresseeId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "help_requests" ADD CONSTRAINT "help_requests_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "help_requests" ADD CONSTRAINT "help_requests_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "weekly_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "help_requests" ADD CONSTRAINT "help_requests_resultTaskId_fkey" FOREIGN KEY ("resultTaskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Живые обновления (этап 20): просьба поменялась, экраны «Мне», «Моя неделя», задачи и сама просьба обновятся
CREATE TRIGGER "help_requests_live" AFTER INSERT OR UPDATE OR DELETE ON "help_requests" FOR EACH STATEMENT EXECUTE FUNCTION "weekly_live_change"('tasks');
