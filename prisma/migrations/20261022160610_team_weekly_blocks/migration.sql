-- повторяемая: этап 66, смысловые блоки weekly команды. Шаблон блоков задаёт руководитель, участники сдают weekly по
-- нему, руководитель собирает отчёт команды по блокам и отправляет своему руководителю
CREATE TABLE IF NOT EXISTS "team_weekly_templates" (
  "teamId" TEXT NOT NULL,
  "blocks" JSONB NOT NULL,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "team_weekly_templates_pkey" PRIMARY KEY ("teamId")
);

CREATE TABLE IF NOT EXISTS "team_weekly_reports" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "weekId" TEXT NOT NULL,
  "blocks" JSONB NOT NULL,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "sentAt" TIMESTAMPTZ(3),
  "sentById" TEXT,
  "sentTo" JSONB NOT NULL DEFAULT '[]',
  "sentSnapshot" JSONB,
  CONSTRAINT "team_weekly_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "team_weekly_reports_teamId_weekId_key" ON "team_weekly_reports"("teamId", "weekId");
CREATE INDEX IF NOT EXISTS "team_weekly_reports_weekId_idx" ON "team_weekly_reports"("weekId");

DO $$ BEGIN
  ALTER TABLE "team_weekly_templates" ADD CONSTRAINT "team_weekly_templates_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "team_weekly_reports" ADD CONSTRAINT "team_weekly_reports_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "team_weekly_reports" ADD CONSTRAINT "team_weekly_reports_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
