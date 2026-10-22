-- Этап 60, правки после проверки 21.10. Миграция повторяемая.
-- Строгая привязка для общих деловых лент: к продукту нужно два разных признака
ALTER TABLE "news_sources" ADD COLUMN IF NOT EXISTS "strict" BOOLEAN NOT NULL DEFAULT false;
UPDATE "news_sources" SET "strict" = true
WHERE "url" IN (
  'https://www.kommersant.ru/RSS/section-finance.xml',
  'https://www.vedomosti.ru/rss/rubric/finance',
  'https://rssexport.rbc.ru/rbcnews/news/30/full.rss',
  'https://www.interfax.ru/rss.asp',
  'https://tass.ru/rss/v2.xml'
);
-- Ночная очистка старых дайджестов идёт по дате отправки
CREATE INDEX IF NOT EXISTS "news_digests_sentAt_idx" ON "news_digests"("sentAt");
