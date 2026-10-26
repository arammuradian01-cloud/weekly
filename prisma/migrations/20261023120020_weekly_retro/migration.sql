-- повторяемая: этап 73, weekly за прошлую неделю сдаётся задним числом с отметкой
ALTER TABLE "weekly_reports" ADD COLUMN IF NOT EXISTS "retro" BOOLEAN NOT NULL DEFAULT false;
