-- повторяемая: этап 30 (шкала готовности крупных инициатив). Каждый шаг проверяет, что уже сделано, потому что Prisma
-- применяет операторы без общей транзакции, а платформа может перезапустить контейнер на полпути

DO $$ BEGIN CREATE TYPE "InitiativeState" AS ENUM ('SEARCHING', 'DOING'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "InitiativeResult" AS ENUM ('DONE', 'DROPPED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE "AgendaKind" ADD VALUE IF NOT EXISTS 'INITIATIVE';
ALTER TYPE "InboxKind" ADD VALUE IF NOT EXISTS 'INITIATIVE';

ALTER TABLE "agenda_items" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;

CREATE TABLE IF NOT EXISTS "initiatives" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "why" TEXT NOT NULL DEFAULT '',
    "ownerId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL DEFAULT 'top',
    "goalId" TEXT,
    "state" "InitiativeState" NOT NULL DEFAULT 'SEARCHING',
    "stateSince" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL DEFAULT '',
    "noteAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" "InitiativeResult",
    "resultNote" TEXT,
    "closedAt" TIMESTAMPTZ(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "initiatives_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "initiative_changes" (
    "id" TEXT NOT NULL,
    "initiativeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromState" "InitiativeState",
    "toState" "InitiativeState",
    "note" TEXT,
    "byId" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "initiative_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "initiatives_closedAt_idx" ON "initiatives"("closedAt");
CREATE INDEX IF NOT EXISTS "initiatives_ownerId_idx" ON "initiatives"("ownerId");
CREATE INDEX IF NOT EXISTS "initiative_changes_initiativeId_at_idx" ON "initiative_changes"("initiativeId", "at");

DO $$ BEGIN ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_initiativeId_fkey" FOREIGN KEY ("initiativeId") REFERENCES "initiatives"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "initiative_changes" ADD CONSTRAINT "initiative_changes_initiativeId_fkey" FOREIGN KEY ("initiativeId") REFERENCES "initiatives"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "initiative_changes" ADD CONSTRAINT "initiative_changes_byId_fkey" FOREIGN KEY ("byId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Ограничения: название одной мыслью, «зачем» и заметка короткие, у закрытой инициативы есть итог
DO $$ BEGIN ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_title_len" CHECK (char_length(btrim("title")) BETWEEN 1 AND 120); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_why_len" CHECK (char_length("why") <= 500); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_note_len" CHECK (char_length("note") <= 300); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_closed_has_result" CHECK (("closedAt" IS NULL) = ("result" IS NULL)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_result_note_len" CHECK ("resultNote" IS NULL OR char_length("resultNote") <= 300); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
