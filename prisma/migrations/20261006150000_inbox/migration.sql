-- Этап 11: раздел «Мне». События адресатам: поставили или передали задачу, предложили, подтвердили, добавили соисполнителем, прокомментировали, перенесли срок.

-- CreateEnum
CREATE TYPE "InboxKind" AS ENUM ('TASK_ASSIGNED', 'TASK_PROPOSED', 'TASK_CONFIRMED', 'TASK_COEXECUTOR', 'TASK_COMMENT', 'TASK_DUE');

-- CreateTable
CREATE TABLE "inbox_events" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "kind" "InboxKind" NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "subject" TEXT NOT NULL,
    "taskId" TEXT,
    "commentId" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMPTZ(3),
    "snoozeUntil" TIMESTAMPTZ(3),

    CONSTRAINT "inbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inbox_events_recipientId_doneAt_idx" ON "inbox_events"("recipientId", "doneAt");

-- CreateIndex
CREATE INDEX "inbox_events_recipientId_subject_idx" ON "inbox_events"("recipientId", "subject");

-- AddForeignKey
ALTER TABLE "inbox_events" ADD CONSTRAINT "inbox_events_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_events" ADD CONSTRAINT "inbox_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_events" ADD CONSTRAINT "inbox_events_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "task_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

