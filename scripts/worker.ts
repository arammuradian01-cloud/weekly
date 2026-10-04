// Фоновый процесс: ночная копия в 03:00 по Москве и ежемесячная проверка восстановления.
// На этапе 6 сюда же добавится выгрузка в Google-таблицу.
import "dotenv/config";
import { PgBoss } from "pg-boss";
import { disconnect, runBackup, runRestoreCheck } from "./lib/backup-core";

const TZ = "Europe/Moscow";
const QUEUE_BACKUP = "backup-nightly";
const QUEUE_CHECK = "backup-restore-check";

const boss = new PgBoss(process.env.DATABASE_URL!);
boss.on("error", (error) => console.error("[worker]", error));

await boss.start();
await boss.createQueue(QUEUE_BACKUP);
await boss.createQueue(QUEUE_CHECK);

// Если компьютер спал в 03:00, копия сделается один раз при следующем запуске
await boss.schedule(QUEUE_BACKUP, "0 3 * * *", null, { tz: TZ, missed: "once" });
await boss.schedule(QUEUE_CHECK, "0 4 1 * *", null, { tz: TZ, missed: "once" });

await boss.work(QUEUE_BACKUP, async () => {
  const result = await runBackup();
  console.log(`[worker] Копия создана: ${result.file}`);
});

await boss.work(QUEUE_CHECK, async () => {
  const result = await runRestoreCheck();
  console.log(`[worker] Копия проверена: ${result.file}, таблиц ${result.tables.length}`);
});

console.log("[worker] Работает: копия каждую ночь в 03:00 по Москве, проверка восстановления 1-го числа в 04:00");

async function shutdown() {
  await boss.stop({ graceful: true });
  await disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
