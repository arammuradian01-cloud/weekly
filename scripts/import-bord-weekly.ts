// Разовый импорт weekly из вкладки «Weekly CEO» Insurance&Invest Bord (этап 4 ТЗ).
// npm run import:bord-weekly -- [файл] [--batch bord-2026-10-05]
// Работает только в пустой weekly: если записи уже есть, ничего не меняет.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { importBordWeekly } from "../src/lib/weekly/bord-import";
import { BORD_DEFAULT } from "./lib/bord-source";

async function main() {
  const args = process.argv.slice(2);
  const batchAt = args.indexOf("--batch");
  const batch = batchAt >= 0 ? args[batchAt + 1]! : BORD_DEFAULT.batch;
  const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--batch") ?? BORD_DEFAULT.weeklyFile;
  const report = await importBordWeekly(prisma, readFileSync(file, "utf8"), { batch });
  console.log(
    report.skipped
      ? "Weekly уже есть в базе: импорт пропущен"
      : `Импорт weekly из ${file}: записей ${report.created}, недели ${report.weeks.join(", ")}`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
