-- повторяемая: этап 67г, продукт у крупной инициативы. Инициативы на странице делятся по департаментам и продуктам,
-- загрузчик наполнения ставит продукт из пакета. Каждый шаг проверяет, что уже сделано
ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "directionId" TEXT;
CREATE INDEX IF NOT EXISTS "initiatives_directionId_idx" ON "initiatives"("directionId");
DO $$ BEGIN ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "dictionary_items"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
