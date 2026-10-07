-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "deadlineTime" TEXT,
ADD COLUMN     "deadlineWeek" INTEGER,
ADD COLUMN     "deadlineWeekday" INTEGER,
ADD COLUMN     "meetingTime" TEXT,
ADD COLUMN     "meetingWeek" INTEGER,
ADD COLUMN     "meetingWeekday" INTEGER,
ADD COLUMN     "specialistsWeekly" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "weekly_promotions" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_week_closes" (
    "teamId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "closedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,

    CONSTRAINT "team_week_closes_pkey" PRIMARY KEY ("teamId","weekId")
);

-- CreateIndex
CREATE INDEX "weekly_promotions_byId_idx" ON "weekly_promotions"("byId");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_promotions_entryId_byId_key" ON "weekly_promotions"("entryId", "byId");

-- CreateIndex
CREATE INDEX "team_week_closes_weekId_idx" ON "team_week_closes"("weekId");

-- AddForeignKey
ALTER TABLE "weekly_promotions" ADD CONSTRAINT "weekly_promotions_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "weekly_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_promotions" ADD CONSTRAINT "weekly_promotions_byId_fkey" FOREIGN KEY ("byId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_week_closes" ADD CONSTRAINT "team_week_closes_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_week_closes" ADD CONSTRAINT "team_week_closes_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_week_closes" ADD CONSTRAINT "team_week_closes_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ритм команды: допустимые значения проверяет и база
ALTER TABLE "teams" ADD CONSTRAINT "teams_deadline_week_check" CHECK ("deadlineWeek" IS NULL OR "deadlineWeek" IN (0, 1));
ALTER TABLE "teams" ADD CONSTRAINT "teams_meeting_week_check" CHECK ("meetingWeek" IS NULL OR "meetingWeek" IN (0, 1));
ALTER TABLE "teams" ADD CONSTRAINT "teams_deadline_weekday_check" CHECK ("deadlineWeekday" IS NULL OR "deadlineWeekday" BETWEEN 1 AND 7);
ALTER TABLE "teams" ADD CONSTRAINT "teams_meeting_weekday_check" CHECK ("meetingWeekday" IS NULL OR "meetingWeekday" BETWEEN 1 AND 7);
ALTER TABLE "teams" ADD CONSTRAINT "teams_deadline_time_check" CHECK ("deadlineTime" IS NULL OR "deadlineTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "teams" ADD CONSTRAINT "teams_meeting_time_check" CHECK ("meetingTime" IS NULL OR "meetingTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
-- Фраза руководителя к записи, поднятой наверх
ALTER TABLE "weekly_promotions" ADD CONSTRAINT "weekly_promotions_note_check" CHECK ("note" IS NULL OR char_length("note") <= 150);
