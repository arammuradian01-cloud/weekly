import "dotenv/config";
import { performReportedBackup } from "./lib/remote-backup/reported";
import { prisma } from "../src/lib/db";
import { backupConfig } from "./lib/remote-backup/config";
import { extractRemoteBackup } from "./lib/remote-backup/core";
import { backupCommand, BackupUsageError, BACKUP_USAGE } from "./lib/remote-backup/command";

let databaseUsed = false;
try {
  const command = backupCommand(process.argv.slice(2));
  if (command.kind === "help") console.log(BACKUP_USAGE);
  else if (command.kind === "extract") {
    const manifest = await extractRemoteBackup(command.key, command.output);
    console.log(`Архив проверен и извлечён: ${manifest.tables.length} таблиц. Файл содержит открытые данные; после восстановления удалите его.`);
  } else {
    const check = command.kind === "verify";
    const config = backupConfig();
    databaseUsed = true;
    const result = await performReportedBackup(check, config, command.kind === "verify" ? command.key : undefined);
    console.log(check
      ? `Внешняя копия восстановлена и сверена: ${result.tables} таблиц. Временная база удалена.`
      : `Зашифрованная внешняя копия создана и скачана для сверки: ${result.tables} таблиц.`);
  }
} catch (error) {
  // Адреса базы, ключи хранилища и содержимое строк не попадают в вывод команд.
  console.error(error instanceof BackupUsageError ? BACKUP_USAGE : "Внешняя копия или её проверка не завершилась. Проверьте настройки, доступ к хранилищу и отдельному серверу восстановления.");
  process.exitCode = 1;
} finally {
  if (databaseUsed) {
    try { await prisma.$disconnect(); } catch { /* Клиент мог не создаться при недоступной конфигурации. */ }
  }
}
