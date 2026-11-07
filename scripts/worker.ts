// Отдельный процесс внешних копий. Не читает и не изменяет рабочие Google-таблицы.
import "dotenv/config";
import { PgBoss } from "pg-boss";
import { performReportedBackup } from "./lib/remote-backup/reported";
import { backupConfig, restoreTarget } from "./lib/remote-backup/config";
import { pgConnectionConfig } from "../src/lib/database-url";
import { recordError } from "../src/lib/errors";
import { prisma } from "../src/lib/db";

async function main() {
if (process.env.BACKUP_ENABLED !== "true") {
  console.log("Внешнее резервирование выключено: BACKUP_ENABLED не равен true.");
  process.exit(0);
}
const config = backupConfig();
const checkEnabled = process.env.BACKUP_RESTORE_ENABLED === "true";
if (checkEnabled) restoreTarget(config.databaseUrl);
const boss = new PgBoss(pgConnectionConfig(config.databaseUrl));
boss.on("error", () => {
  console.error("Сбой очереди резервирования");
  void recordError({ source: "SERVER", place: "backup-worker", message: "Сбой очереди резервирования" }).catch(() => undefined);
});
await boss.start();
const nightly = "backup-nightly";
const monthly = "backup-restore-check";
const queueOptions = { retryLimit: 2, retryDelay: 300, expireInSeconds: 3600 };
for (const name of [nightly, monthly]) {
  await boss.createQueue(name, queueOptions);
  // createQueue не меняет существующую очередь: настройки нужны и после обновления прежнего worker.
  await boss.updateQueue(name, queueOptions);
}
await boss.schedule(nightly, "0 3 * * *", null, { tz: "Europe/Moscow", missed: "once" });
if (checkEnabled) await boss.schedule(monthly, "0 4 1 * *", null, { tz: "Europe/Moscow", missed: "once" });
else await boss.unschedule(monthly);

await boss.work(nightly, async () => { await performReportedBackup(false, config); });
await boss.work(monthly, async () => {
  // Старое задание в очереди тоже не должно восстанавливать при выключенной проверке.
  if (checkEnabled) await performReportedBackup(true, config);
});
console.log(`Внешние копии: ежедневно в 03:00 МСК. Проверка восстановления: ${checkEnabled ? "1-го числа в 04:00 МСК" : "не включена"}.`);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await boss.stop({ graceful: true });
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

}

void main().catch(() => {
  console.error("Фоновый процесс резервирования не запустился. Проверьте настройки и доступ к базе.");
  process.exit(1);
});
