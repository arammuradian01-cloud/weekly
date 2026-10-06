// Перезаливка задач и weekly из свежей выгрузки Insurance&Invest Bord перед пилотом (этап 7 ТЗ).
// Общая часть для команды npm run reload:bord и для раздела «Перезаливка из выгрузки» в настройках владельца.
// Модуль без server-only: его загружает и скрипт на сервере.

import type { PrismaClient } from "@/generated/prisma/client";
import { checkBordTasks, importBordTasks } from "@/lib/tasks/bord-import";
import { checkBordWeekly, importBordWeekly } from "@/lib/weekly/bord-import";

export type ReloadCounts = { tasks: number; comments: number; entries: number; reports: number; ceo: number };

export type ReloadPlan = {
  /** Что сейчас в базе и будет удалено */
  now: ReloadCounts;
  /** Сколько строк в выгрузках */
  rows: { tasks: number; weekly: number };
  /** Почему выгрузку не загрузить. Пусто: можно загружать */
  problems: string[];
};

export type ReloadResult = { tasks: number; entries: number; weeks: number[]; nextNumber: number };

/** Кто перезаливает: владелец из настроек или скрипт на сервере */
export type ReloadActor = { personId: string | null; name: string; source: "APP" | "SYSTEM"; ip?: string | null };

export async function currentCounts(db: PrismaClient): Promise<ReloadCounts> {
  const [tasks, comments, entries, reports, ceo] = await Promise.all([
    db.task.count(),
    db.taskComment.count(),
    db.weeklyEntry.count(),
    db.weeklyReport.count(),
    db.ceoReport.count(),
  ]);
  return { tasks, comments, entries, reports, ceo };
}

/** Проверка обеих выгрузок без записи в базу */
export async function planReload(db: PrismaClient, tasksText: string, weeklyText: string): Promise<ReloadPlan> {
  // Не та вкладка или не CSV: разбор падает с понятным текстом, он уходит в список проблем
  const safely = async (what: string, check: () => Promise<{ rows: number; problems: string[] }>) => {
    try {
      return await check();
    } catch (error) {
      return { rows: -1, problems: [`${what}: ${error instanceof Error ? error.message : String(error)}`] };
    }
  };
  const [t, w, now] = await Promise.all([
    safely("Файл задач", () => checkBordTasks(db, tasksText)),
    safely("Файл weekly", () => checkBordWeekly(db, weeklyText)),
    currentCounts(db),
  ]);
  const problems = [...t.problems, ...w.problems];
  if (t.rows === 0) problems.unshift("В выгрузке задач нет ни одной строки: проверьте, что скачана вкладка «Задачи»");
  if (w.rows === 0) problems.unshift("В выгрузке weekly нет ни одной строки: проверьте, что скачана вкладка «Weekly CEO»");
  return { now, rows: { tasks: Math.max(t.rows, 0), weekly: Math.max(w.rows, 0) }, problems };
}

/**
 * Удаляет все задачи (вместе с комментариями, переносами и ссылками), записи и сдачи weekly, черновики отчёта CEO
 * и недели, затем загружает выгрузку. Люди, справочники, настройки и журнал остаются.
 * Битая выгрузка останавливает перезаливку до удаления
 */
export async function reloadFromBord(db: PrismaClient, tasksText: string, weeklyText: string, opts: { batch: string; actor: ReloadActor }): Promise<ReloadResult> {
  const plan = await planReload(db, tasksText, weeklyText);
  if (plan.problems.length) throw new ReloadProblemsError(plan.problems);

  await db.$transaction(async (tx) => {
    // Комментарии, переносы, ссылки и соисполнители удаляются вместе с задачами (каскад в базе)
    await tx.task.deleteMany();
    await tx.weeklyEntry.deleteMany();
    await tx.weeklyReport.deleteMany();
    await tx.ceoReport.deleteMany();
    await tx.week.deleteMany();
    // Номера новых задач начнутся после самой старшей задачи из выгрузки, а при заборе из Bord от 1001
    const pullOn = await tx.setting.findUnique({ where: { key: "bord.sourceId" } });
    const first = typeof pullOn?.value === "string" && pullOn.value ? 1001 : 1;
    await tx.setting.upsert({ where: { key: "tasks.nextNumber" }, update: { value: first }, create: { key: "tasks.nextNumber", value: first } });
    // Прошлые значения полей забора относились к удалённым задачам: следующий забор сверит всё с Bord заново
    await tx.setting.deleteMany({ where: { key: "bord.snapshot" } });
    await tx.auditLog.create({
      data: {
        action: "data.reload",
        source: opts.actor.source,
        actorId: opts.actor.personId,
        actorName: opts.actor.name,
        entity: "data",
        entityId: opts.batch,
        field: "Задачи и weekly",
        before: `задач ${plan.now.tasks}, записей weekly ${plan.now.entries}`,
        after: `загружается: задач ${plan.rows.tasks}, строк weekly ${plan.rows.weekly}`,
        ip: opts.actor.ip ?? null,
      },
    });
  });
  const tasks = await importBordTasks(db, tasksText, { batch: opts.batch });
  const weekly = await importBordWeekly(db, weeklyText, { batch: opts.batch });
  return { tasks: tasks.created.length, entries: weekly.created, weeks: weekly.weeks, nextNumber: tasks.nextNumber };
}

export class ReloadProblemsError extends Error {
  constructor(readonly problems: string[]) {
    super(`Выгрузку не загрузить, база не тронута:\n- ${problems.join("\n- ")}`);
    this.name = "ReloadProblemsError";
  }
}
