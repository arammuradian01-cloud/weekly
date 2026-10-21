-- повторяемая: этап 61, правки после проверки кода. Отчёт CEO хранит снимок того, что ушло CEO; идущий разбор встречи
-- обновляет отметку «жив», по ней видно, что разбор завис
ALTER TABLE "ceo_reports" ADD COLUMN IF NOT EXISTS "sentSnapshot" JSONB;
ALTER TABLE "meeting_parses" ADD COLUMN IF NOT EXISTS "lastBeatAt" TIMESTAMPTZ(3);
