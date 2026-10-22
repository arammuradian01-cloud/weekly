-- повторяемая: этап 66, weekly по смысловым блокам. Отчёт CEO хранит блоки рядом с прежними разделами (главное, риски,
-- что дальше остаются и собираются из блоков), запись weekly помнит блок шаблона команды, по которому её сдали
ALTER TABLE "ceo_reports" ADD COLUMN IF NOT EXISTS "blocks" JSONB;
ALTER TABLE "weekly_entries" ADD COLUMN IF NOT EXISTS "section" TEXT;
