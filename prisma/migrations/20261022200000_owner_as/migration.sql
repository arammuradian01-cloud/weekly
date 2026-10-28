-- повторяемая: этап 71, «Сменить профиль» у владельца. Владелец при личном входе входит в профиль другого человека,
-- каждая запись журнала за это время несёт способ входа OWNER_AS и того владельца, который вошёл
ALTER TYPE "LoginMethod" ADD VALUE IF NOT EXISTS 'OWNER_AS';

ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "asOwnerId" TEXT;
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "asOwnerName" TEXT;
