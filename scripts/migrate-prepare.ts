import "dotenv/config";
import { prepareDatabaseFromEnv } from "../src/lib/migrate-prepare";

// Шаг запуска контейнера перед prisma migrate deploy: снять зависшие сессии базы и брошенные миграции.
// Порог в секундах задаётся MIGRATE_STALE_SECONDS (по умолчанию 60). Ошибка здесь не останавливает запуск:
// лучше дать миграциям шанс, чем упасть на подготовке
try {
  // Пустое или нечисловое значение в панели не должно давать порог 0: это сняло бы живые сессии
  const n = Number(process.env.MIGRATE_STALE_SECONDS);
  const report = await prepareDatabaseFromEnv({ staleSeconds: n > 0 ? n : 60, log: (line) => console.log(line) });
  if (!report) console.log("Подготовка базы пропущена: адрес базы не задан");
  else if (report.terminated.length === 0 && report.rolledBack.length === 0 && report.manual.length === 0 && !report.neighbourMigrating)
    console.log("База готова к миграциям: зависших сессий и брошенных миграций нет");
} catch (error) {
  console.error("Подготовка базы не удалась, миграции запускаются как есть:", error instanceof Error ? error.message : error);
}
