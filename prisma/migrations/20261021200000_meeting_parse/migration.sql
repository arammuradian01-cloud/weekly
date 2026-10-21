-- повторяемая: этап 61. Разбор встречи из Notion: итоги встречи, черновик weekly для CEO и черновики задач хранятся
-- в разборе; отчёт CEO помнит, когда, кем и кому отправлен

DO $$ BEGIN
  CREATE TYPE "MeetingParseStatus" AS ENUM ('PENDING', 'READY', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "MeetingParseMethod" AS ENUM ('AI', 'RULES');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ceo_reports" ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMPTZ(3);
ALTER TABLE "ceo_reports" ADD COLUMN IF NOT EXISTS "sentById" TEXT;
ALTER TABLE "ceo_reports" ADD COLUMN IF NOT EXISTS "sentTo" JSONB NOT NULL DEFAULT '[]';
DO $$ BEGIN
  ALTER TABLE "ceo_reports" ADD CONSTRAINT "ceo_reports_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "meeting_parses" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "notionUrl" TEXT NOT NULL,
    "notionPageId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "pageText" TEXT NOT NULL DEFAULT '',
    "status" "MeetingParseStatus" NOT NULL DEFAULT 'PENDING',
    "method" "MeetingParseMethod",
    "model" TEXT,
    "note" TEXT,
    "result" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ceoSentAt" TIMESTAMPTZ(3),
    "ceoSentById" TEXT,
    "tasksCreatedAt" TIMESTAMPTZ(3),
    "tasksCreatedById" TEXT,
    "taskNumbers" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "decisionsCreated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "meeting_parses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "meeting_parses_meetingId_createdAt_idx" ON "meeting_parses"("meetingId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "meeting_parses" ADD CONSTRAINT "meeting_parses_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "meeting_parses" ADD CONSTRAINT "meeting_parses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "meeting_parses" ADD CONSTRAINT "meeting_parses_ceoSentById_fkey" FOREIGN KEY ("ceoSentById") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "meeting_parses" ADD CONSTRAINT "meeting_parses_tasksCreatedById_fkey" FOREIGN KEY ("tasksCreatedById") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
