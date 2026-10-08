-- повторяемая: этап 28 (встречи один на один). Каждый шаг проверяет, что уже сделано, потому что Prisma применяет
-- операторы без общей транзакции, а платформа может перезапустить контейнер на полпути

DO $$ BEGIN CREATE TYPE "OneOnOneStatus" AS ENUM ('PLANNED', 'DONE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "OneOnOneTopicStatus" AS ENUM ('OPEN', 'DISCUSSED', 'DROPPED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE "InboxKind" ADD VALUE IF NOT EXISTS 'ONE_ON_ONE';

CREATE TABLE IF NOT EXISTS "one_on_one_pairs" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "one_on_one_pairs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "one_on_ones" (
    "id" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "OneOnOneStatus" NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT NOT NULL DEFAULT '',
    "closedAt" TIMESTAMPTZ(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "one_on_ones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "one_on_one_topics" (
    "id" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "authorId" TEXT,
    "text" TEXT NOT NULL,
    "status" "OneOnOneTopicStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" TEXT,
    "meetingId" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    CONSTRAINT "one_on_one_topics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "one_on_one_notes" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "one_on_one_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "one_on_one_pairs_managerId_reportId_key" ON "one_on_one_pairs"("managerId", "reportId");
CREATE INDEX IF NOT EXISTS "one_on_one_pairs_reportId_idx" ON "one_on_one_pairs"("reportId");
CREATE INDEX IF NOT EXISTS "one_on_ones_pairId_date_idx" ON "one_on_ones"("pairId", "date");
CREATE INDEX IF NOT EXISTS "one_on_one_topics_pairId_status_idx" ON "one_on_one_topics"("pairId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "one_on_one_notes_meetingId_authorId_key" ON "one_on_one_notes"("meetingId", "authorId");
-- У пары одна запланированная встреча: двойное нажатие не создаёт вторую
CREATE UNIQUE INDEX IF NOT EXISTS "one_on_ones_one_planned" ON "one_on_ones"("pairId") WHERE "status" = 'PLANNED';

DO $$ BEGIN ALTER TABLE "one_on_one_pairs" ADD CONSTRAINT "one_on_one_pairs_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "one_on_one_pairs" ADD CONSTRAINT "one_on_one_pairs_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "one_on_ones" ADD CONSTRAINT "one_on_ones_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "one_on_one_pairs"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "one_on_one_topics" ADD CONSTRAINT "one_on_one_topics_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "one_on_one_pairs"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "one_on_one_topics" ADD CONSTRAINT "one_on_one_topics_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "one_on_one_topics" ADD CONSTRAINT "one_on_one_topics_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "one_on_ones"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "one_on_one_topics" ADD CONSTRAINT "one_on_one_topics_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "one_on_one_notes" ADD CONSTRAINT "one_on_one_notes_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "one_on_ones"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "one_on_one_notes" ADD CONSTRAINT "one_on_one_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Ограничения: пара из двух разных людей, тема одной-двумя фразами, заметки не бесконечные
DO $$ BEGIN ALTER TABLE "one_on_one_pairs" ADD CONSTRAINT "one_on_one_pairs_two_people" CHECK ("managerId" <> "reportId"); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "one_on_one_topics" ADD CONSTRAINT "one_on_one_topics_text_len" CHECK (char_length(btrim("text")) BETWEEN 1 AND 500); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "one_on_one_topics" ADD CONSTRAINT "one_on_one_topics_outcome_len" CHECK ("outcome" IS NULL OR char_length("outcome") <= 2000); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "one_on_ones" ADD CONSTRAINT "one_on_ones_notes_len" CHECK (char_length("notes") <= 20000); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "one_on_one_notes" ADD CONSTRAINT "one_on_one_notes_text_len" CHECK (char_length("text") <= 20000); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
