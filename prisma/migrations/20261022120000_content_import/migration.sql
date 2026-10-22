-- повторяемая: этап 67, импорт наполнения. Внешние ключи записей пакета: повторная загрузка не плодит дубли.
-- Сам пакет в базе и в репозитории не хранится, только ключ, отпечаток и запись в том виде, в каком её загрузили
CREATE TABLE IF NOT EXISTS "content_import_keys" (
  "kind" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "importedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_import_keys_pkey" PRIMARY KEY ("kind", "key")
);
