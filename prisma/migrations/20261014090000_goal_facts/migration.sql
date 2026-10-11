-- повторяемая: этап 33 (факт цели с историей). Каждый шаг проверяет, что уже сделано, потому что Prisma применяет
-- операторы без общей транзакции, а платформа может перезапустить контейнер на полпути

CREATE TABLE IF NOT EXISTS "goal_facts" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "number" DOUBLE PRECISION,
    "note" TEXT,
    "authorId" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "goal_facts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "goal_facts_goalId_at_idx" ON "goal_facts"("goalId", "at");
CREATE INDEX IF NOT EXISTS "goal_facts_authorId_idx" ON "goal_facts"("authorId");

DO $$ BEGIN ALTER TABLE "goal_facts" ADD CONSTRAINT "goal_facts_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "goal_facts" ADD CONSTRAINT "goal_facts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Значение коротко, комментарий одной фразой
DO $$ BEGIN ALTER TABLE "goal_facts" ADD CONSTRAINT "goal_facts_value_len" CHECK (char_length(btrim("value")) BETWEEN 1 AND 120); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "goal_facts" ADD CONSTRAINT "goal_facts_note_len" CHECK ("note" IS NULL OR char_length("note") <= 300); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
