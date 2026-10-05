// Сверка задач ресурса с вкладкой «Задачи» Insurance&Invest Bord по каждому полю (критерий приёмки этапа 3).
// npm run reconcile:bord -- [файл] [--as-of 2026-10-04]
// --as-of: на какую дату таблица считала «Статус просроченности». Код выхода 1, если есть расхождения.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { reconcileBordTasks } from "../src/lib/tasks/bord-import";
import { BORD_DEFAULT } from "./lib/bord-source";

async function main() {
  const args = process.argv.slice(2);
  const asOfAt = args.indexOf("--as-of");
  const asOf = asOfAt >= 0 ? args[asOfAt + 1]! : BORD_DEFAULT.overdueAsOf;
  const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--as-of") ?? BORD_DEFAULT.file;
  const report = await reconcileBordTasks(prisma, readFileSync(file, "utf8"), asOf);
  const fields = new Map<string, number>();
  for (const d of report.diffs) fields.set(d.field, (fields.get(d.field) ?? 0) + 1);
  console.log(`Сверено задач: ${report.checked}. Просрочка посчитана на ${asOf}.`);
  console.log(`Расхождений: ${report.diffs.length}${fields.size ? ` (${[...fields].map(([f, n]) => `${f}: ${n}`).join(", ")})` : ""}`);
  for (const d of report.diffs) console.log(`  №${d.number}, ${d.field}\n    в таблице: ${d.table}\n    в ресурсе: ${d.resource}`);
  if (report.notInTable.length) console.log(`Импортированы, но в таблице их нет: ${report.notInTable.join(", ")}`);
  if (report.newInResource.length) console.log(`Новые задачи ресурса (в таблице их и не должно быть): ${report.newInResource.join(", ")}`);
  if (report.diffs.length || report.notInTable.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
