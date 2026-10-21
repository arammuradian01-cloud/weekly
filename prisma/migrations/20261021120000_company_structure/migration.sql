-- повторяемая: этап 53 (структура всей компании). Корень структуры «компания» над департаментами
-- событие «Мне» о составе команд и отметка участника из другой ветки структуры

ALTER TYPE "UnitKind" ADD VALUE IF NOT EXISTS 'COMPANY';
ALTER TYPE "InboxKind" ADD VALUE IF NOT EXISTS 'TEAM';
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "external" BOOLEAN NOT NULL DEFAULT false;
