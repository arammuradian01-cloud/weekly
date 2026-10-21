-- повторяемая: этап 54, правки после проверки кода. Передача задачи в департамент с согласованием помнит прежнего
-- ответственного и статус: отказ руководителя возвращает задачу, а не отменяет её
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "approvalFromId" TEXT;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "approvalFromStatus" "TaskStatus";
DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_approvalFromId_fkey" FOREIGN KEY ("approvalFromId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
