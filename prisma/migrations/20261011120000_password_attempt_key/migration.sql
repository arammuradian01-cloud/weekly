-- AlterTable
ALTER TABLE "login_attempts" ADD COLUMN     "login" TEXT;

-- CreateIndex
CREATE INDEX "login_attempts_login_at_idx" ON "login_attempts"("login", "at");
