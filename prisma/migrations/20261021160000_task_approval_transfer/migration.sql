-- повторяемая: этап 54, правки после проверки кода. Передача задачи в департамент с согласованием помнит прежнего
-- ответственного и статус: отказ руководителя возвращает задачу, а не отменяет её
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "approvalFromId" TEXT;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "approvalFromStatus" "TaskStatus";
DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_approvalFromId_fkey" FOREIGN KEY ("approvalFromId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- «Все лидеры» у прежнего ответственного и автор задачи для правила согласования (второй круг проверки кода)
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "approvalFromAll" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "approvalAuthorId" TEXT;
DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_approvalAuthorId_fkey" FOREIGN KEY ("approvalAuthorId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Задачи, у которых уже есть согласование: автор правила из просьбы, из которой сделана задача, иначе тот, кто поставил
UPDATE "tasks" t SET "approvalAuthorId" = COALESCE(
  (SELECT r."authorId" FROM "help_requests" r WHERE r."resultTaskId" = t.id ORDER BY r."createdAt" LIMIT 1),
  t."createdById"
)
WHERE t."approvalState" IS NOT NULL AND t."approvalAuthorId" IS NULL;
