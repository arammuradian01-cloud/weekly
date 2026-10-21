-- повторяемая: этап 61, второй круг проверки кода. Разбор встречи помнит, кто запустил последнюю попытку: событие
-- о готовности после «Повторить» уходит ему
ALTER TABLE "meeting_parses" ADD COLUMN IF NOT EXISTS "startedById" TEXT;
DO $$ BEGIN
  ALTER TABLE "meeting_parses" ADD CONSTRAINT "meeting_parses_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
