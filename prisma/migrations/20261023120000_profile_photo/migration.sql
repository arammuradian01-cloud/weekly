-- повторяемая: этап 80, фото и «О себе» в профиле. Тексты в карточке человека, фото отдельной таблицей (списки людей
-- не тянут картинки). Каждый шаг проверяет, что уже сделано
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "about" TEXT;
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "helpWith" TEXT;
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "telegram" TEXT;

CREATE TABLE IF NOT EXISTS "person_avatars" (
  "personId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "large" BYTEA,
  "small" BYTEA,
  "bytes" INTEGER NOT NULL DEFAULT 0,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "person_avatars_pkey" PRIMARY KEY ("personId")
);

DO $$ BEGIN ALTER TABLE "person_avatars" ADD CONSTRAINT "person_avatars_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
