-- повторяемая: этап 26 (телефон и уведомления в браузере). Каждый шаг проверяет, что уже сделано, потому что Prisma
-- применяет операторы без общей транзакции, а платформа может перезапустить контейнер на полпути

-- Уведомление в браузере по событию «Мне» ушло или не нужно
ALTER TABLE "inbox_events" ADD COLUMN IF NOT EXISTS "pushedAt" TIMESTAMPTZ(3);
-- События, которые были до этапа 26, уведомлением не уходят: никому не придёт пачка старого. Старше 12 часов
-- проход отметит сам, поэтому трогаем только свежие строки, а не всю таблицу
UPDATE "inbox_events" SET "pushedAt" = now() WHERE "pushedAt" IS NULL AND "createdAt" > now() - interval '12 hours';
CREATE INDEX IF NOT EXISTS "inbox_events_pushedAt_createdAt_idx" ON "inbox_events"("pushedAt", "createdAt");

-- Какие уведомления в браузере получает человек
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "pushPrefs" JSONB NOT NULL DEFAULT '{}';

-- Ключ черновика записи weekly с устройства: повтор после обрыва связи правит ту же запись
ALTER TABLE "weekly_entries" ADD COLUMN IF NOT EXISTS "clientKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "weekly_entries_authorId_clientKey_key" ON "weekly_entries"("authorId", "clientKey") WHERE "clientKey" IS NOT NULL;

-- Подписки устройств на уведомления в браузере
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMPTZ(3),
    "failures" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX IF NOT EXISTS "push_subscriptions_personId_idx" ON "push_subscriptions"("personId");
ALTER TABLE "push_subscriptions" DROP CONSTRAINT IF EXISTS "push_subscriptions_personId_fkey";
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_subscriptions" DROP CONSTRAINT IF EXISTS "push_subscriptions_deviceId_fkey";
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "device_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
