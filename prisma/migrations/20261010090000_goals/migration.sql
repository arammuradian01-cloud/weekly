-- CreateEnum
CREATE TYPE "GoalResult" AS ENUM ('IN_PROGRESS', 'ACHIEVED', 'PARTIAL', 'MISSED', 'DROPPED');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "goalId" TEXT;

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "code" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metric" TEXT,
    "base" TEXT,
    "target" TEXT,
    "teamId" TEXT NOT NULL,
    "ownerId" TEXT,
    "parentId" TEXT,
    "atRisk" BOOLEAN NOT NULL DEFAULT false,
    "riskNote" TEXT,
    "result" "GoalResult" NOT NULL DEFAULT 'IN_PROGRESS',
    "link" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goals_quarter_teamId_idx" ON "goals"("quarter", "teamId");

-- CreateIndex
CREATE INDEX "goals_parentId_idx" ON "goals"("parentId");

-- CreateIndex
CREATE INDEX "tasks_goalId_idx" ON "tasks"("goalId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Квартал вида 2026-Q4, номер цели уникален внутри квартала и команды
ALTER TABLE "goals" ADD CONSTRAINT "goals_quarter_check" CHECK ("quarter" ~ '^[0-9]{4}-Q[1-4]$');
ALTER TABLE "goals" ADD CONSTRAINT "goals_title_check" CHECK (char_length("title") BETWEEN 1 AND 300);
ALTER TABLE "goals" ADD CONSTRAINT "goals_parent_check" CHECK ("parentId" IS NULL OR "parentId" <> "id");
CREATE UNIQUE INDEX "goals_quarter_team_code_key" ON "goals" ("quarter", "teamId", "code") WHERE "code" IS NOT NULL;
