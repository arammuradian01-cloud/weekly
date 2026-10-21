-- Этап 57: один ожидающий запрос на человека в команду. Два одинаковых запроса могли появиться при параллельном
-- добавлении: оставляем самый ранний, остальные отменяем, потом запрещаем повтор индексом. Повторный запуск безопасен
UPDATE "team_join_requests" r
SET "status" = 'CANCELLED', "decidedAt" = now()
WHERE r."status" = 'PENDING'
  AND EXISTS (
    SELECT 1 FROM "team_join_requests" o
    WHERE o."teamId" = r."teamId" AND o."personId" = r."personId" AND o."status" = 'PENDING'
      AND (o."createdAt" < r."createdAt" OR (o."createdAt" = r."createdAt" AND o."id" < r."id"))
  );

CREATE UNIQUE INDEX IF NOT EXISTS "team_join_requests_one_pending" ON "team_join_requests" ("teamId", "personId") WHERE "status" = 'PENDING';
