-- CreateEnum
CREATE TYPE "RepeatKind" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "RepeatMode" AS ENUM ('ON_CLOSE', 'SCHEDULE');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "repeat" "RepeatKind",
ADD COLUMN     "repeatMode" "RepeatMode" NOT NULL DEFAULT 'ON_CLOSE',
ADD COLUMN     "repeatOfId" TEXT;

-- CreateTable
CREATE TABLE "task_checklist_items" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneById" TEXT,
    "doneAt" TIMESTAMPTZ(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_checklist_items_taskId_sortOrder_idx" ON "task_checklist_items"("taskId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "saved_views_personId_path_name_key" ON "saved_views"("personId", "path", "name");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_repeatOfId_key" ON "tasks"("repeatOfId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_repeatOfId_fkey" FOREIGN KEY ("repeatOfId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Ограничения (этап 25): текст пункта чек-листа и имя вида не пустые и не длиннее лимита
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "checklist_text_len" CHECK (length(btrim("text")) BETWEEN 1 AND 200);
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "checklist_done_by" CHECK (("done" = false AND "doneAt" IS NULL) OR ("done" = true AND "doneAt" IS NOT NULL));
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_name_len" CHECK (length(btrim("name")) BETWEEN 1 AND 60);
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_query_len" CHECK (length("query") BETWEEN 1 AND 1000);

-- Повтор: следующая задача не может повторять саму себя
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_repeat_not_self" CHECK ("repeatOfId" IS NULL OR "repeatOfId" <> "id");

-- Общий поиск (этап 25): полнотекстовые индексы с русской морфологией по задачам, записям weekly и комментариям.
-- Решения уже ищутся так же (этап 23)
CREATE INDEX "tasks_search_idx" ON "tasks" USING GIN (to_tsvector('russian', "title" || ' ' || "outcome" || ' ' || "whereNow"));
CREATE INDEX "weekly_entries_search_idx" ON "weekly_entries" USING GIN (
  to_tsvector('russian', "what" || ' ' || coalesce("details", '') || ' ' || coalesce("impact", '') || ' ' || coalesce("fact", '') || ' ' || coalesce("next", '') || ' ' || coalesce("help", ''))
);
CREATE INDEX "task_comments_search_idx" ON "task_comments" USING GIN (to_tsvector('russian', "text"));
CREATE INDEX "entry_comments_search_idx" ON "entry_comments" USING GIN (to_tsvector('russian', "text"));

-- Живые обновления: чек-лист меняет задачу на экранах
CREATE TRIGGER "task_checklist_live" AFTER INSERT OR UPDATE OR DELETE ON "task_checklist_items" FOR EACH STATEMENT EXECUTE FUNCTION "weekly_live_change"('tasks');
