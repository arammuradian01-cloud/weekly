// Перезаливка задач и weekly из свежей выгрузки Insurance&Invest Bord перед пилотом (этап 7 ТЗ).
//
// npm run reload:bord -- --tasks data/bord/zadachi-ДАТА.csv --weekly data/bord/weekly-ceo-ДАТА.csv [--batch bord-ДАТА] [--yes]
//
// Без --yes ничего не меняет: проверяет обе выгрузки и пишет, что будет удалено и что загружено.
// С --yes удаляет все задачи (вместе с комментариями, переносами и ссылками), все записи и сдачи weekly,
// черновики отчёта CEO и недели, затем загружает выгрузку заново. Люди, справочники, настройки и журнал остаются.
// Запускать только с согласия владельца и вне рабочего времени команды: в базе стенда живые данные.
// То же самое без консоли: «Настройки», «Перезаливка из выгрузки», пока плашка «Тестовый стенд».
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { planReload, reloadFromBord } from "../src/lib/admin/reload";

function arg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

async function main() {
  const tasksFile = arg("--tasks");
  const weeklyFile = arg("--weekly");
  const yes = process.argv.includes("--yes");
  if (!tasksFile || !weeklyFile) {
    throw new Error("Укажите обе выгрузки: --tasks <CSV вкладки «Задачи»> --weekly <CSV вкладки «Weekly CEO»>");
  }
  const batch = arg("--batch") ?? `bord-${new Date().toISOString().slice(0, 10)}`;
  const tasksText = readFileSync(tasksFile, "utf8");
  const weeklyText = readFileSync(weeklyFile, "utf8");

  // Сначала проверка: если выгрузка не загрузится, база не трогается
  const plan = await planReload(prisma, tasksText, weeklyText);
  const now = plan.now;
  console.log(`Сейчас в базе: задач ${now.tasks}, комментариев ${now.comments}, записей weekly ${now.entries}, сданных и начатых weekly ${now.reports}, черновиков отчёта CEO ${now.ceo}.`);
  console.log(`В выгрузке: задач ${plan.rows.tasks} (${tasksFile}), строк weekly ${plan.rows.weekly} (${weeklyFile}).`);
  if (plan.problems.length) throw new Error(`Выгрузку не загрузить, база не тронута:\n- ${plan.problems.join("\n- ")}`);
  if (!yes) {
    console.log("Проверка прошла. Это был пробный запуск: чтобы удалить текущие задачи и weekly и загрузить выгрузку, добавьте --yes.");
    return;
  }

  const result = await reloadFromBord(prisma, tasksText, weeklyText, {
    batch,
    actor: { personId: null, name: "Перезаливка из выгрузки Bord", source: "SYSTEM" },
  });
  console.log(`Загружено: задач ${result.tasks}, записей weekly ${result.entries}, недели ${result.weeks.join(", ")}. Следующая новая задача получит номер ${result.nextNumber}.`);
  console.log("Дальше: на странице «Синхронизация» нажмите «Пересобрать вкладки», чтобы таблица сразу совпала с базой.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
