import "dotenv/config";
import { disconnect, runBackup } from "./lib/backup-core";

try {
  const result = await runBackup();
  const mb = (result.bytes / 1024 / 1024).toFixed(2);
  console.log(`Копия создана: ${result.file} (${mb} МБ)${result.monthly ? ", она же копия месяца" : ""}`);
  if (result.deleted.length) console.log(`Удалены старые копии: ${result.deleted.length}`);
} catch (error) {
  console.error("Копия не создалась:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await disconnect();
}
