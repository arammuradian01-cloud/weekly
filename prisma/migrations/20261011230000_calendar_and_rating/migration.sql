-- повторяемая: этап 29 (календарь сроков и анонимная оценка встреч). Каждый шаг проверяет, что уже сделано, потому
-- что Prisma применяет операторы без общей транзакции, а платформа может перезапустить контейнер на полпути

CREATE TABLE IF NOT EXISTS "calendar_feeds" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "withTitles" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3),
    CONSTRAINT "calendar_feeds_pkey" PRIMARY KEY ("id")
);

-- Кто ответил и сами ответы лежат в разных таблицах, без времени и без общего ключа
CREATE TABLE IF NOT EXISTS "meeting_rating_votes" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    CONSTRAINT "meeting_rating_votes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "meeting_ratings" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "remove" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "meeting_ratings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "calendar_feeds_personId_key" ON "calendar_feeds"("personId");
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_feeds_tokenHash_key" ON "calendar_feeds"("tokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_rating_votes_teamId_month_personId_key" ON "meeting_rating_votes"("teamId", "month", "personId");
CREATE INDEX IF NOT EXISTS "meeting_ratings_teamId_month_idx" ON "meeting_ratings"("teamId", "month");

DO $$ BEGIN ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "meeting_rating_votes" ADD CONSTRAINT "meeting_rating_votes_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "meeting_rating_votes" ADD CONSTRAINT "meeting_rating_votes_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "meeting_ratings" ADD CONSTRAINT "meeting_ratings_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Ограничения: оценка от 1 до 5, месяц вида 2026-10, ответ «что убрать» не длиннее 500 знаков
DO $$ BEGIN ALTER TABLE "meeting_ratings" ADD CONSTRAINT "meeting_ratings_score_range" CHECK ("score" BETWEEN 1 AND 5); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "meeting_ratings" ADD CONSTRAINT "meeting_ratings_month_format" CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "meeting_ratings" ADD CONSTRAINT "meeting_ratings_remove_len" CHECK (char_length("remove") <= 500); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "meeting_rating_votes" ADD CONSTRAINT "meeting_rating_votes_month_format" CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
