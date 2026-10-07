-- CreateEnum
CREATE TYPE "UnitKind" AS ENUM ('DEPARTMENT', 'MANAGEMENT', 'DIVISION', 'SECTOR', 'STREAM', 'FUNCTION', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "TeamKind" AS ENUM ('TOP', 'UNIT', 'CUSTOM');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'EMPLOYEE';

-- AlterTable
ALTER TABLE "people" ADD COLUMN     "functionalManagerId" TEXT,
ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "position" TEXT,
ADD COLUMN     "unitId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "teamId" TEXT NOT NULL DEFAULT 'top';

-- CreateTable
CREATE TABLE "org_units" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "UnitKind" NOT NULL,
    "parentId" TEXT,
    "headId" TEXT,
    "headNote" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "org_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacancies" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "vacancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TeamKind" NOT NULL DEFAULT 'UNIT',
    "leaderId" TEXT,
    "parentId" TEXT,
    "parentManual" BOOLEAN NOT NULL DEFAULT false,
    "unitId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "teamId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "addedById" TEXT,
    "addedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auto" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("teamId","personId")
);

-- Топ-команда (этап 14): всё, что было до команд. Руководитель: владелец, участники: все остальные люди.
-- В свежей базе людей ещё нет: руководителя и участников добавит prisma/seed.ts
INSERT INTO "teams" ("id", "name", "kind", "leaderId", "sortOrder", "updatedAt")
VALUES ('top', 'Топ-команда', 'TOP', (SELECT "id" FROM "people" WHERE "role" = 'OWNER' AND "active" ORDER BY "sortOrder", "fullName" LIMIT 1), 0, CURRENT_TIMESTAMP);

INSERT INTO "team_members" ("teamId", "personId")
SELECT 'top', p."id" FROM "people" p
WHERE p."id" IS DISTINCT FROM (SELECT "leaderId" FROM "teams" WHERE "id" = 'top');

-- CreateIndex
CREATE INDEX "org_units_parentId_idx" ON "org_units"("parentId");

-- CreateIndex
CREATE INDEX "vacancies_unitId_idx" ON "vacancies"("unitId");

-- CreateIndex
CREATE INDEX "teams_leaderId_idx" ON "teams"("leaderId");

-- CreateIndex
CREATE INDEX "teams_parentId_idx" ON "teams"("parentId");

-- CreateIndex
CREATE INDEX "team_members_personId_idx" ON "team_members"("personId");

-- CreateIndex
CREATE INDEX "tasks_teamId_idx" ON "tasks"("teamId");

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_functionalManagerId_fkey" FOREIGN KEY ("functionalManagerId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "org_units"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_headId_fkey" FOREIGN KEY ("headId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "org_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Таблица для просмотра (этап 14): новое название команды меняет колонку «Команда» во многих строках, выгружаем всё.
-- Состав топ-команды меняет строки вкладки «Сводка»
CREATE TRIGGER teams_sheet_enqueue AFTER UPDATE OF "name" ON "teams"
  FOR EACH ROW WHEN (OLD."name" IS DISTINCT FROM NEW."name")
  EXECUTE FUNCTION sheet_enqueue_all();
CREATE TRIGGER team_members_sheet_enqueue_summary_ins AFTER INSERT ON "team_members"
  FOR EACH ROW WHEN (NEW."teamId" = 'top')
  EXECUTE FUNCTION sheet_enqueue_summary();
CREATE TRIGGER team_members_sheet_enqueue_summary_del AFTER DELETE ON "team_members"
  FOR EACH ROW WHEN (OLD."teamId" = 'top')
  EXECUTE FUNCTION sheet_enqueue_summary();
