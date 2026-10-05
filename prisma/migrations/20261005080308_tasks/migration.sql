-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PROPOSED', 'IN_PROGRESS', 'CLARIFY', 'DONE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "TaskState" AS ENUM ('ON_TRACK', 'AT_RISK', 'BLOCKED');

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "ownerId" TEXT,
    "ownerAll" BOOLEAN NOT NULL DEFAULT false,
    "directionId" TEXT NOT NULL,
    "priority" "TaskPriority",
    "status" "TaskStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "state" "TaskState",
    "blockedBy" TEXT,
    "whereNow" TEXT NOT NULL DEFAULT '',
    "whereUpdatedAt" DATE NOT NULL,
    "due" DATE NOT NULL,
    "originalDue" DATE,
    "sourceCode" TEXT NOT NULL DEFAULT 'other',
    "sourceNote" TEXT,
    "sourceDate" DATE,
    "weeklyEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "closedAt" TIMESTAMPTZ(3),
    "resolution" TEXT,
    "archivedAt" TIMESTAMPTZ(3),
    "importBatch" TEXT,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_co_executors" (
    "taskId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,

    CONSTRAINT "task_co_executors_pkey" PRIMARY KEY ("taskId","personId")
);

-- CreateTable
CREATE TABLE "task_transfers" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromDue" DATE,
    "toDue" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "byId" TEXT,
    "at" TIMESTAMPTZ(3),

    CONSTRAINT "task_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_comments" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source" "ChangeSource" NOT NULL DEFAULT 'APP',
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_links" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "addedById" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tasks_number_key" ON "tasks"("number");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "tasks_ownerId_idx" ON "tasks"("ownerId");

-- CreateIndex
CREATE INDEX "task_transfers_taskId_idx" ON "task_transfers"("taskId");

-- CreateIndex
CREATE INDEX "task_comments_taskId_at_idx" ON "task_comments"("taskId", "at");

-- CreateIndex
CREATE INDEX "task_links_taskId_idx" ON "task_links"("taskId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "dictionary_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_co_executors" ADD CONSTRAINT "task_co_executors_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_co_executors" ADD CONSTRAINT "task_co_executors_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_transfers" ADD CONSTRAINT "task_transfers_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_transfers" ADD CONSTRAINT "task_transfers_byId_fkey" FOREIGN KEY ("byId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Правила раздела 4 ТЗ продублированы в базе: их не обойти ни интерфейсом, ни скриптом
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_title_len" CHECK (char_length("title") BETWEEN 1 AND 120);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_outcome_present" CHECK (char_length(btrim("outcome")) > 0);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_one_owner" CHECK (NOT ("ownerId" IS NOT NULL AND "ownerAll"));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_blocked_reason" CHECK ("state" IS DISTINCT FROM 'BLOCKED' OR char_length(btrim(coalesce("blockedBy", ''))) > 0);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_closed_note" CHECK ("status" NOT IN ('DONE', 'FAILED', 'CANCELLED') OR char_length(btrim(coalesce("resolution", ''))) > 0);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_number_positive" CHECK ("number" > 0);
ALTER TABLE "task_transfers" ADD CONSTRAINT "task_transfers_reason" CHECK (char_length(btrim("reason")) > 0);
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_text" CHECK (char_length(btrim("text")) > 0);
