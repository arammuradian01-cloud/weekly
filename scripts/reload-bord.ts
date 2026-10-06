// Перезаливка задач и weekly из свежей выгрузки Insurance&Invest Bord перед пилотом (этап 7 ТЗ).
//
// npm run reload:bord -- --tasks data/bord/zadachi-ДАТА.csv --weekly data/bord/weekly-ceo-ДАТА.csv [--batch bord-ДАТА] [--yes]
//
// Без --yes ничего не меняет: проверяет обе выгрузки и пишет, что будет удалено и что загружено.
// С --yes удаляет все задачи (вместе с комментариями, переносами и ссылками), все записи и сдачи weekly,
// черновики отчёта CEO и недели, затем загружает выгрузку заново. Люди, справочники, настройки и журнал остаются.
// Запускать только с согласия владельца и вне рабочего времени команды: в базе стенда живые данные.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { checkBordTasks, importBordTasks } from "../src/lib/tasks/bord-import";
import { checkBordWeekly, importBordWeekly } from "../src/lib/weekly/bord-import";

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
  const [t, w] = await Promise.all([checkBordTasks(prisma, tasksText), checkBordWeekly(prisma, weeklyText)]);
  const problems = [...t.problems, ...w.problems];
  const now = {
    tasks: await prisma.task.count(),
    comments: await prisma.taskComment.count(),
    entries: await prisma.weeklyEntry.count(),
    reports: await prisma.weeklyReport.count(),
    ceo: await prisma.ceoReport.count(),
  };
  console.log(`Сейчас в базе: задач ${now.tasks}, комментариев ${now.comments}, записей weekly ${now.entries}, сданных и начатых weekly ${now.reports}, черновиков отчёта CEO ${now.ceo}.`);
  console.log(`В выгрузке: задач ${t.rows} (${tasksFile}), строк weekly ${w.rows} (${weeklyFile}).`);
  if (problems.length) throw new Error(`Выгрузку не загрузить, база не тронута:\n- ${problems.join("\n- ")}`);
  if (!yes) {
    console.log("Проверка прошла. Это был пробный запуск: чтобы удалить текущие задачи и weekly и загрузить выгрузку, добавьте --yes.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Комментарии, переносы, ссылки и соисполнители удаляются вместе с задачами (каскад в базе)
    await tx.task.deleteMany();
    await tx.weeklyEntry.deleteMany();
    await tx.weeklyReport.deleteMany();
    await tx.ceoReport.deleteMany();
    await tx.week.deleteMany();
    // Номера новых задач начнутся после самой старшей задачи из выгрузки
    await tx.setting.upsert({ where: { key: "tasks.nextNumber" }, update: { value: 1 }, create: { key: "tasks.nextNumber", value: 1 } });
    await tx.auditLog.create({
      data: {
        action: "data.reload",
        source: "SYSTEM",
        actorName: "Перезаливка из выгрузки Bord",
        entity: "data",
        entityId: batch,
        field: "Задачи и weekly",
        before: `задач ${now.tasks}, записей weekly ${now.entries}`,
        after: `загружается: задач ${t.rows}, строк weekly ${w.rows}`,
      },
    });
  });
  const tasksReport = await importBordTasks(prisma, tasksText, { batch });
  const weeklyReport = await importBordWeekly(prisma, weeklyText, { batch });
  console.log(`Загружено: задач ${tasksReport.created.length}, записей weekly ${weeklyReport.created}, недели ${weeklyReport.weeks.join(", ")}. Следующая новая задача получит номер ${tasksReport.nextNumber}.`);
  console.log("Дальше: на странице «Синхронизация» нажмите «Пересобрать вкладки», чтобы таблица сразу совпала с базой.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
