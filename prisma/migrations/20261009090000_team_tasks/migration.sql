-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InboxKind" ADD VALUE 'UPDATE_REQUEST';
ALTER TYPE "InboxKind" ADD VALUE 'TASK_WATCH';

-- CreateTable
CREATE TABLE "task_watches" (
    "taskId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_watches_pkey" PRIMARY KEY ("taskId","personId")
);

-- CreateIndex
CREATE INDEX "task_watches_personId_idx" ON "task_watches"("personId");

-- AddForeignKey
ALTER TABLE "task_watches" ADD CONSTRAINT "task_watches_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_watches" ADD CONSTRAINT "task_watches_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
