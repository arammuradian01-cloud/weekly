-- повторяемая: этап 54 (согласование и информирование). Задача человеку из другого департамента ждёт согласования
-- его руководителя или руководитель о ней только узнаёт

DO $$ BEGIN
  CREATE TYPE "ApprovalState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'INFORMED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TYPE "InboxKind" ADD VALUE IF NOT EXISTS 'APPROVAL';
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "approvalState" "ApprovalState";
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "approverId" TEXT;
DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "tasks_approverId_approvalState_idx" ON "tasks"("approverId", "approvalState");
