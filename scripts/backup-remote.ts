import "dotenv/config";
import { performReportedBackup } from "./lib/remote-backup/reported";
import { prisma } from "../src/lib/db";
import { backupConfig } from "./lib/remote-backup/config";
import { extractRemoteBackup } from "./lib/remote-backup/core";

try {
  if (process.argv[2] === "extract") {
    const [key, output] = process.argv.slice(3);
    if (!key || !output) throw new Error("Нужны ключ копии и путь к новому файлу");
    const manifest = await extractRemoteBackup(key, output);
    console.log(`Архив проверен и извлечён: ${manifest.tables.length} таблиц. Файл содержит открытые данные; после восстановления удалите его.`);
  } else {
    const check = process.argv[2] === "verify";
    const result = await performReportedBackup(check, backupConfig(), process.argv[3]);
    console.log(check
      ? `Внешняя копия восстановлена и сверена: ${result.tables} таблиц. Временная база удалена.`
      : `Зашифрованная внешняя копия создана и скачана для сверки: ${result.tables} таблиц.`);
  }
} catch {
  // Адреса базы, ключи хранилища и содержимое строк не попадают в вывод команд.
  console.error("Внешняя копия или её проверка не завершилась. Проверьте настройки, доступ к хранилищу и отдельному серверу восстановления.");
  process.exitCode = 1;
} finally {
  try { await prisma.$disconnect(); } catch { /* При неполной конфигурации клиент ещё не создан. */ }
}
