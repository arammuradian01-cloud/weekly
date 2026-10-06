// Перезаливка задач и weekly из выгрузки Bord перед пилотом (этап 7): пробный запуск ничего не меняет,
// битая выгрузка не трогает базу, с --yes база совпадает с выгрузкой.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import { importBordTasks } from "@/lib/tasks/bord-import";
import { importBordWeekly } from "@/lib/weekly/bord-import";
import * as admin from "@/lib/admin/service";

const TASKS = "data/bord/zadachi-2026-10-05.csv";
const WEEKLY = "data/bord/weekly-ceo-2026-10-05.csv";

function reload(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync("npx", ["tsx", "scripts/reload-bord.ts", ...args], { env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

beforeEach(async () => {
  await prisma.task.deleteMany();
  await prisma.weeklyEntry.deleteMany();
  await prisma.weeklyReport.deleteMany();
  await prisma.ceoReport.deleteMany();
  await prisma.week.deleteMany();
  await importBordTasks(prisma, readFileSync(TASKS, "utf8"), { batch: "bord-2026-10-05" });
  await importBordWeekly(prisma, readFileSync(WEEKLY, "utf8"), { batch: "bord-2026-10-05" });
  await prisma.setting.upsert({ where: { key: "stand.banner" }, update: { value: "test" }, create: { key: "stand.banner", value: "test" } });
});
afterAll(() => prisma.$disconnect());

describe("перезаливка из выгрузки Bord", () => {
  it("без --yes только проверка, с --yes правки стенда уходят и база совпадает с выгрузкой", async () => {
    const reva = await tasks.actorFor("reva");
    const created = await tasks.createTask(reva, { title: "Задача со стенда", outcome: "Проверка", owner: "reva", direction: "product", due: "2030-01-15", source: "weekly" });
    await tasks.addComment(reva, 1, "Комментарий со стенда");

    const logsBefore = await prisma.auditLog.count({ where: { action: "data.reload" } });
    const dry = reload(["--tasks", TASKS, "--weekly", WEEKLY]);
    expect(dry.code, dry.out).toBe(0);
    expect(dry.out).toMatch(/пробный запуск/);
    expect(await prisma.task.count()).toBe(52);
    expect(await prisma.task.findFirst({ where: { number: created.task.number } })).not.toBeNull();

    const real = reload(["--tasks", TASKS, "--weekly", WEEKLY, "--batch", "bord-test", "--yes"]);
    expect(real.code, real.out).toBe(0);
    expect(await prisma.task.count()).toBe(51);
    expect(await prisma.taskComment.count()).toBe(0);
    expect(await prisma.weeklyEntry.count()).toBe(51);
    expect(await prisma.task.findFirst({ where: { title: "Задача со стенда" } })).toBeNull();
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: "tasks.nextNumber" } })).value).toBe(52);
    // Журнал только дописывается: пробный запуск в него не пишет, настоящий пишет одну запись
    expect(await prisma.auditLog.count({ where: { action: "data.reload" } })).toBe(logsBefore + 1);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "data.reload" }, orderBy: { id: "desc" } });
    expect([log.entityId, log.before]).toEqual(["bord-test", "задач 52, записей weekly 51"]);
  });

  it("битая выгрузка останавливает перезаливку до удаления, база не тронута", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reload-"));
    const broken = join(dir, "zadachi.csv");
    writeFileSync(broken, readFileSync(TASKS, "utf8").replace("Мурадян Арам", "Неизвестный Человек"));
    const logsBefore = await prisma.auditLog.count({ where: { action: "data.reload" } });
    const result = reload(["--tasks", broken, "--weekly", WEEKLY, "--yes"]);
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/база не тронута/);
    expect(result.out).toMatch(/Неизвестный Человек/);
    expect(await prisma.task.count()).toBe(51);
    expect(await prisma.weeklyEntry.count()).toBe(51);
    expect(await prisma.auditLog.count({ where: { action: "data.reload" } })).toBe(logsBefore);

    const missing = reload(["--tasks", TASKS]);
    expect(missing.code).toBe(1);
    expect(missing.out).toMatch(/Укажите обе выгрузки/);
  });

  it("из настроек: только владелец, только до пилота, только со словом подтверждения", async () => {
    const tasksText = readFileSync(TASKS, "utf8");
    const weeklyText = readFileSync(WEEKLY, "utf8");
    const owner = await tasks.actorFor("muradyan", "OWNER");
    const admin1 = await tasks.actorFor("golovkin", "ADMIN");
    const reva = await tasks.actorFor("reva");

    await expect(admin.previewReload(admin1, tasksText, weeklyText)).rejects.toThrow(/только владелец/);
    await expect(admin.runReload(reva, tasksText, weeklyText, "перезалить")).rejects.toThrow(/только владелец/);
    await expect(admin.previewReload(owner, tasksText, "")).rejects.toThrow(/оба файла/);

    const plan = await admin.previewReload(owner, tasksText, weeklyText);
    expect(plan).toMatchObject({ problems: [], rows: { tasks: 51, weekly: 51 }, now: { tasks: 51, entries: 51 } });

    // Перепутанные файлы: проверка называет проблему, база не тронута
    const swapped = await admin.previewReload(owner, weeklyText, tasksText);
    expect(swapped.problems.length).toBeGreaterThan(0);
    await expect(admin.runReload(owner, weeklyText, tasksText, "перезалить")).rejects.toThrow(/база не тронута/);

    await expect(admin.runReload(owner, tasksText, weeklyText, "да")).rejects.toThrow(/введите слово «перезалить»/);

    const reva2 = await tasks.actorFor("reva");
    await tasks.createTask(reva2, { title: "Задача со стенда", outcome: "Проверка", owner: "reva", direction: "product", due: "2030-01-15", source: "weekly" });
    const before = await prisma.auditLog.count({ where: { action: "data.reload" } });
    const result = await admin.runReload(owner, tasksText, weeklyText, " Перезалить ", new Date("2026-10-06T09:00:00Z"));
    expect(result).toMatchObject({ tasks: 51, entries: 51, nextNumber: 52 });
    expect(await prisma.task.findFirst({ where: { title: "Задача со стенда" } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "data.reload" } })).toBe(before + 1);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "data.reload" }, orderBy: { id: "desc" } });
    expect([log.source, log.actorId, log.entityId]).toEqual(["APP", owner.personId, "bord-2026-10-06"]);

    // После включения плашки «Пилот» перезаливка закрыта
    await prisma.setting.update({ where: { key: "stand.banner" }, data: { value: "pilot" } });
    await expect(admin.previewReload(owner, tasksText, weeklyText)).rejects.toThrow(/только до пилота/);
  });
});
