-- Этап 5: люди, справочники и ритм недели правятся в настройках ресурса.

-- Порядок блоков weekly как на экранах: «Цифры и прогноз» и «Трафик и маркетинг» сразу после ключевых изменений.
-- Сид создал их последними; меняем только стартовый порядок, руками его ещё никто не правил
UPDATE "dictionary_items"
SET "sortOrder" = CASE "code"
  WHEN 'key-changes' THEN 10 WHEN 'numbers' THEN 20 WHEN 'traffic' THEN 30 WHEN 'partners' THEN 40
  WHEN 'product' THEN 50 WHEN 'risks' THEN 60 WHEN 'team' THEN 70 ELSE "sortOrder" END
WHERE "kind" = 'WEEKLY_BLOCK';

-- Правила экрана настроек продублированы в базе: пустые названия и имена не пройдут даже мимо сервиса
ALTER TABLE "dictionary_items" ADD CONSTRAINT "dictionary_items_label_check" CHECK (char_length(btrim("label")) BETWEEN 1 AND 60);
ALTER TABLE "people" ADD CONSTRAINT "people_full_name_check" CHECK (char_length(btrim("fullName")) BETWEEN 1 AND 80);
ALTER TABLE "people" ADD CONSTRAINT "people_short_name_check" CHECK (char_length(btrim("shortName")) BETWEEN 1 AND 30);
ALTER TABLE "people" ADD CONSTRAINT "people_zone_check" CHECK (char_length("zone") <= 120);
