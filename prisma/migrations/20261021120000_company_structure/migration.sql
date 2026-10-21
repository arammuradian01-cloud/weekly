-- повторяемая: этап 53 (структура всей компании). Корень структуры «компания» над департаментами
-- событие «Мне» о составе команд, отметка участника из другой ветки и запросы в команду с согласием руководителя

ALTER TYPE "UnitKind" ADD VALUE IF NOT EXISTS 'COMPANY';
ALTER TYPE "InboxKind" ADD VALUE IF NOT EXISTS 'TEAM';
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "external" BOOLEAN NOT NULL DEFAULT false;
DO $$ BEGIN
  CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE TABLE IF NOT EXISTS "team_join_requests" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "requestedById" TEXT,
  "approverId" TEXT NOT NULL,
  "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMPTZ(3),
  CONSTRAINT "team_join_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "team_join_requests_approverId_status_idx" ON "team_join_requests"("approverId", "status");
CREATE INDEX IF NOT EXISTS "team_join_requests_teamId_status_idx" ON "team_join_requests"("teamId", "status");
DO $$ BEGIN
  ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
