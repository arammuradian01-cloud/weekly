-- AlterEnum
ALTER TYPE "AttemptKind" ADD VALUE 'PERSONAL';

-- AlterEnum
ALTER TYPE "LoginMethod" ADD VALUE 'PASSWORD';

-- AlterTable
ALTER TABLE "login_attempts" ADD COLUMN     "personId" TEXT;

-- AlterTable
ALTER TABLE "people" ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "passwordSetAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "login_attempts_personId_at_idx" ON "login_attempts"("personId", "at");
