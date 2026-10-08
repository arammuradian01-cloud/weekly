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

-- Кто ответил: человек, команда, месяц. Без времени, ключ случайный
CREATE TABLE IF NOT EXISTS "meeting_rating_votes" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    CONSTRAINT "meeting_rating_votes_pkey" PRIMARY KEY ("id")
);

-- Урна: одна строка на команду и месяц, только суммы по оценкам и ответы «что убрать» в случайном порядке
CREATE TABLE IF NOT EXISTS "meeting_rating_boxes" (
    "teamId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "counts" INTEGER[] DEFAULT ARRAY[0, 0, 0, 0, 0]::INTEGER[],
    "remove" TEXT[] DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT "meeting_rating_boxes_pkey" PRIMARY KEY ("teamId","month")
);

CREATE UNIQUE INDEX IF NOT EXISTS "calendar_feeds_personId_key" ON "calendar_feeds"("personId");
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_feeds_tokenHash_key" ON "calendar_feeds"("tokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_rating_votes_teamId_month_personId_key" ON "meeting_rating_votes"("teamId", "month", "personId");

DO $$ BEGIN ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "meeting_rating_votes" ADD CONSTRAINT "meeting_rating_votes_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "meeting_rating_votes" ADD CONSTRAINT "meeting_rating_votes_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "meeting_rating_boxes" ADD CONSTRAINT "meeting_rating_boxes_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Ограничения: месяц вида 2026-10, в урне ровно пять счётчиков и все не меньше нуля, ответов «что убрать» не больше,
-- чем людей в любой команде с запасом
DO $$ BEGIN ALTER TABLE "meeting_rating_boxes" ADD CONSTRAINT "meeting_rating_boxes_month_format" CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "meeting_rating_boxes" ADD CONSTRAINT "meeting_rating_boxes_counts" CHECK (array_length("counts", 1) = 5 AND 0 <= ALL ("counts")); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "meeting_rating_boxes" ADD CONSTRAINT "meeting_rating_boxes_remove_count" CHECK (coalesce(array_length("remove", 1), 0) <= 1000); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "meeting_rating_votes" ADD CONSTRAINT "meeting_rating_votes_month_format" CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
