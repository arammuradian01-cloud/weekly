import "dotenv/config";
import { disconnect, runRestoreCheck } from "./lib/backup-core";

try {
  const file = process.argv[2];
  const result = await runRestoreCheck(file);
  console.log(`Копия ${result.file} восстановлена во временную базу ${result.database} и сверена:`);
  for (const t of result.tables) {
    const mark = t.restored === t.live ? "совпадает" : "отличается (в рабочей базе были изменения после копии)";
    console.log(`  ${t.table}: в копии ${t.restored}, в рабочей базе ${t.live}, ${mark}`);
  }
  console.log("Временная база удалена. Копия рабочая.");
} catch (error) {
  console.error("Копия не прошла проверку:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await disconnect();
}
