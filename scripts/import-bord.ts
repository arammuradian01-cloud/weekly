// Разовый импорт задач из вкладки «Задачи» Insurance&Invest Bord (этап 3 ТЗ).
// npm run import:bord -- [файл] [--batch bord-2026-10-05]
// Файл: CSV вкладки или выгрузка всей таблицы. Задачи, которые уже есть по номеру, не трогаются.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { importBordTasks } from "../src/lib/tasks/bord-import";
import { BORD_DEFAULT } from "./lib/bord-source";

async function main() {
  const args = process.argv.slice(2);
  const batchAt = args.indexOf("--batch");
  const batch = batchAt >= 0 ? args[batchAt + 1]! : BORD_DEFAULT.batch;
  const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--batch") ?? BORD_DEFAULT.file;
  const report = await importBordTasks(prisma, readFileSync(file, "utf8"), { batch });
  console.log(`Импорт из ${file}: создано ${report.created.length}, уже были ${report.skipped.length}. Следующая новая задача получит номер ${report.nextNumber}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
