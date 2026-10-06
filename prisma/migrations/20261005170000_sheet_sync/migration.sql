-- Этап 6: зеркало задач и weekly в Google-таблицу (раздел 5 ТЗ).

CREATE TABLE "sheet_outbox" (
    "id" BIGSERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sheet_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sheet_outbox_kind_check" CHECK ("kind" IN ('task', 'comment', 'entry', 'summary', 'all'))
);
CREATE INDEX "sheet_outbox_at_idx" ON "sheet_outbox"("at");

CREATE TABLE "sheet_runs" (
    "id" BIGSERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "items" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "details" JSONB,
    CONSTRAINT "sheet_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sheet_runs_kind_check" CHECK ("kind" IN ('push', 'reconcile', 'rebuild'))
);
CREATE INDEX "sheet_runs_kind_startedAt_idx" ON "sheet_runs"("kind", "startedAt");

-- Очередь заполняют триггеры: любая правка задачи, комментария, переноса, ссылки, соисполнителя или записи weekly
-- попадает в очередь в той же транзакции. Отдельно отметить «надо выгрузить» в коде забыть нельзя

CREATE OR REPLACE FUNCTION sheet_enqueue_task() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO "sheet_outbox" ("kind", "key") VALUES ('task', OLD."number"::text);
    IF OLD."weeklyEntryId" IS NOT NULL THEN
      INSERT INTO "sheet_outbox" ("kind", "key") VALUES ('entry', OLD."weeklyEntryId");
    END IF;
    RETURN OLD;
  END IF;
  INSERT INTO "sheet_outbox" ("kind", "key") VALUES ('task', NEW."number"::text);
  IF TG_OP = 'UPDATE' AND OLD."number" <> NEW."number" THEN
    INSERT INTO "sheet_outbox" ("kind", "key") VALUES ('task', OLD."number"::text);
  END IF;
  -- В строке weekly виден номер задачи, сделанной из записи
  IF NEW."weeklyEntryId" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."weeklyEntryId" IS DISTINCT FROM NEW."weeklyEntryId") THEN
    INSERT INTO "sheet_outbox" ("kind", "key") VALUES ('entry', NEW."weeklyEntryId");
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."weeklyEntryId" IS NOT NULL AND OLD."weeklyEntryId" IS DISTINCT FROM NEW."weeklyEntryId" THEN
    INSERT INTO "sheet_outbox" ("kind", "key") VALUES ('entry', OLD."weeklyEntryId");
  END IF;
  -- В строках комментариев видно название задачи, а комментарии задач в архиве в таблицу не выгружаются
  IF TG_OP = 'UPDATE' AND (OLD."title" IS DISTINCT FROM NEW."title" OR OLD."archivedAt" IS DISTINCT FROM NEW."archivedAt") THEN
    INSERT INTO "sheet_outbox" ("kind", "key") SELECT 'comment', c."id" FROM "task_comments" c WHERE c."taskId" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_sheet_enqueue AFTER INSERT OR UPDATE OR DELETE ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION sheet_enqueue_task();

-- Переносы, ссылки и соисполнители меняют строку задачи
CREATE OR REPLACE FUNCTION sheet_enqueue_task_child() RETURNS trigger AS $$
DECLARE
  task_id TEXT;
  task_number INTEGER;
BEGIN
  task_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."taskId" ELSE NEW."taskId" END;
  SELECT "number" INTO task_number FROM "tasks" WHERE "id" = task_id;
  IF task_number IS NOT NULL THEN
    INSERT INTO "sheet_outbox" ("kind", "key") VALUES ('task', task_number::text);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_transfers_sheet_enqueue AFTER INSERT OR UPDATE OR DELETE ON "task_transfers"
  FOR EACH ROW EXECUTE FUNCTION sheet_enqueue_task_child();
CREATE TRIGGER task_links_sheet_enqueue AFTER INSERT OR UPDATE OR DELETE ON "task_links"
  FOR EACH ROW EXECUTE FUNCTION sheet_enqueue_task_child();
CREATE TRIGGER task_co_executors_sheet_enqueue AFTER INSERT OR UPDATE OR DELETE ON "task_co_executors"
  FOR EACH ROW EXECUTE FUNCTION sheet_enqueue_task_child();

-- Комментарий: своя строка во вкладке «Комментарии к задачам» и «Последний комментарий» у задачи
CREATE OR REPLACE FUNCTION sheet_enqueue_comment() RETURNS trigger AS $$
DECLARE
  row_id TEXT;
  task_id TEXT;
  task_number INTEGER;
BEGIN
  row_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
  task_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."taskId" ELSE NEW."taskId" END;
  INSERT INTO "sheet_outbox" ("kind", "key") VALUES ('comment', row_id);
  SELECT "number" INTO task_number FROM "tasks" WHERE "id" = task_id;
  IF task_number IS NOT NULL THEN
    INSERT INTO "sheet_outbox" ("kind", "key") VALUES ('task', task_number::text);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_comments_sheet_enqueue AFTER INSERT OR UPDATE OR DELETE ON "task_comments"
  FOR EACH ROW EXECUTE FUNCTION sheet_enqueue_comment();

CREATE OR REPLACE FUNCTION sheet_enqueue_entry() RETURNS trigger AS $$
BEGIN
  INSERT INTO "sheet_outbox" ("kind", "key") VALUES ('entry', CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER weekly_entries_sheet_enqueue AFTER INSERT OR UPDATE OR DELETE ON "weekly_entries"
  FOR EACH ROW EXECUTE FUNCTION sheet_enqueue_entry();

-- Новое имя человека или новое название в справочнике меняют подписи во многих строках: выгружаем всё
CREATE OR REPLACE FUNCTION sheet_enqueue_all() RETURNS trigger AS $$
BEGIN
  INSERT INTO "sheet_outbox" ("kind", "key") VALUES ('all', '*');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER people_sheet_enqueue AFTER UPDATE OF "fullName" ON "people"
  FOR EACH ROW WHEN (OLD."fullName" IS DISTINCT FROM NEW."fullName")
  EXECUTE FUNCTION sheet_enqueue_all();
CREATE TRIGGER dictionary_items_sheet_enqueue AFTER UPDATE OF "label" ON "dictionary_items"
  FOR EACH ROW WHEN (OLD."label" IS DISTINCT FROM NEW."label")
  EXECUTE FUNCTION sheet_enqueue_all();

-- Новый человек, выключение, роль или порядок меняют только строки вкладки «Сводка»
CREATE OR REPLACE FUNCTION sheet_enqueue_summary() RETURNS trigger AS $$
BEGIN
  INSERT INTO "sheet_outbox" ("kind", "key") VALUES ('summary', '*');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER people_sheet_enqueue_summary AFTER INSERT OR DELETE OR UPDATE OF "active", "role", "sortOrder" ON "people"
  FOR EACH ROW EXECUTE FUNCTION sheet_enqueue_summary();

-- ID таблицы-копии задаёт владелец на странице «Синхронизация»; сама таблица подключается, когда есть и ID, и служебный аккаунт
INSERT INTO "settings" ("key", "value", "updatedAt") VALUES ('sheet.spreadsheetId', 'null'::jsonb, CURRENT_TIMESTAMP)
  ON CONFLICT ("key") DO NOTHING;
