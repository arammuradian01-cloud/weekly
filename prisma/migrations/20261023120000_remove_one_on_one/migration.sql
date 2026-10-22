-- повторяемая: этап 76, раздел «Один на один» (этап 28) удалён вместе с данными по решению Арама 23.10.2026.
-- Prisma применяет операторы без общей транзакции, а платформа может перезапустить контейнер на полпути, поэтому
-- перенос и удаление идут одним блоком DO (он атомарный) и только пока таблицы есть, остальное через IF EXISTS.
--
-- Задачи, поставленные из тем встреч, остаются обычными задачами: внешний ключ был только у темы (taskId), у задачи
-- источник «Другое» и подпись «Встреча один на один», так их ставил этап 28. Справочник источников не меняется.
-- Если подпись успели стереть, она возвращается: по карточке задачи и журналу видно, откуда задача.
-- В журнал одна системная запись со счётом, без содержимого встреч (их содержимое в журнал не писалось и раньше).

DO $$
DECLARE
  pairs integer;
  meetings integer;
  topics integer;
  tasks integer;
BEGIN
  IF to_regclass('public.one_on_one_pairs') IS NULL THEN
    RETURN;
  END IF;
  SELECT count(*) INTO pairs FROM "one_on_one_pairs";
  SELECT count(*) INTO meetings FROM "one_on_ones";
  SELECT count(*) INTO topics FROM "one_on_one_topics";
  SELECT count(DISTINCT "taskId") INTO tasks FROM "one_on_one_topics" WHERE "taskId" IS NOT NULL;

  UPDATE "tasks" SET "sourceNote" = 'Встреча один на один'
  WHERE "id" IN (SELECT "taskId" FROM "one_on_one_topics" WHERE "taskId" IS NOT NULL)
    AND ("sourceNote" IS NULL OR btrim("sourceNote") = '');

  IF pairs > 0 THEN
    INSERT INTO "audit_log" ("source", "action", "entity", "after")
    VALUES ('SYSTEM', 'system.oneOnOne.removed', 'one-on-one',
      to_jsonb(format('Раздел удалён: пар %s, встреч %s, тем %s. Задачи из тем (%s) остались обычными задачами с источником «Другое», подпись «Встреча один на один»', pairs, meetings, topics, tasks)));
  END IF;

  DELETE FROM "inbox_events" WHERE "kind" = 'ONE_ON_ONE' OR "subject" LIKE '1on1:%';

  DROP TABLE IF EXISTS "one_on_one_notes";
  DROP TABLE IF EXISTS "one_on_one_topics";
  DROP TABLE IF EXISTS "one_on_ones";
  DROP TABLE IF EXISTS "one_on_one_pairs";
END $$;

-- События «Мне» о встречах (значение ONE_ON_ONE остаётся в типе InboxKind: Postgres значения перечисления не убирает)
DELETE FROM "inbox_events" WHERE "kind" = 'ONE_ON_ONE' OR "subject" LIKE '1on1:%';

DROP TYPE IF EXISTS "OneOnOneTopicStatus";
DROP TYPE IF EXISTS "OneOnOneStatus";
