-- повторяемая: этап 73, комментарии получателя к отправленному отчёту руководителю (к отчёту целиком и к строке) и
-- ответы автора. Отправленные версии уже хранятся снимками этапа 66 (ceo_reports, team_weekly_reports)
CREATE TABLE IF NOT EXISTS "leader_report_comments" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "weekId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "parentId" TEXT,
  "blockKey" TEXT,
  "lineIndex" INTEGER,
  "lineText" TEXT,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leader_report_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "leader_report_comments_teamId_weekId_idx" ON "leader_report_comments"("teamId", "weekId");

DO $$ BEGIN
  ALTER TABLE "leader_report_comments" ADD CONSTRAINT "leader_report_comments_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "leader_report_comments" ADD CONSTRAINT "leader_report_comments_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "leader_report_comments" ADD CONSTRAINT "leader_report_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "leader_report_comments" ADD CONSTRAINT "leader_report_comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "leader_report_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
