-- AlterEnum
ALTER TYPE "InboxKind" ADD VALUE 'TASK_DEPENDENCY';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "riskNote" TEXT;

-- CreateTable
CREATE TABLE "task_dependencies" (
    "taskId" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("taskId","blockerId")
);

-- CreateIndex
CREATE INDEX "task_dependencies_blockerId_idx" ON "task_dependencies"("blockerId");

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Живые обновления (этап 20): связи задач поменялись, экраны задач обновятся
CREATE TRIGGER "task_dependencies_live" AFTER INSERT OR UPDATE OR DELETE ON "task_dependencies" FOR EACH STATEMENT EXECUTE FUNCTION "weekly_live_change"('tasks');
