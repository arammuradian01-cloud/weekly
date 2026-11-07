import "dotenv/config";
import { backupConfig } from "./lib/remote-backup/config";
import { createRemoteBackup } from "./lib/remote-backup/core";
import { clientFor } from "./lib/remote-backup/postgres";
import { migrationBackupNeeded } from "./lib/remote-backup/migrations";

if (process.env.BACKUP_ENABLED === "true") {
  try {
    const config = backupConfig();
    const client = clientFor(config.databaseUrl);
    let needed: boolean;
    try { await client.connect(); needed = await migrationBackupNeeded(client); }
    finally { await client.end().catch(() => undefined); }
    if (needed) {
      await createRemoteBackup("migration", { config });
      console.log("Внешняя копия перед миграциями подтверждена.");
    } else console.log("Новых миграций с существующими данными нет: дополнительная копия не нужна.");
  } catch {
    console.error("Копия перед миграциями не подтверждена. Запуск миграций остановлен.");
    process.exitCode = 1;
  }
} else console.log("Внешнее резервирование выключено. Защита миграций внешней копией не включена.");
