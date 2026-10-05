// Журнал изменений (критерий приёмки этапа 5): по любой правке видно, кто, когда, какое поле, что было и что стало.
// Плюс фильтры журнала на сервере: человек, период, тип события, источник, подгрузка.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as weekly from "@/lib/weekly/service";
import * as admin from "@/lib/admin/service";
import { importBordTasks } from "@/lib/tasks/bord-import";
import { importBordWeekly } from "@/lib/weekly/bord-import";
import { journalEvents } from "@/lib/journal";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays, formatLong } from "@/domain/dates";

const due = addDays(moscowToday(), 10);
let startId = 0n;

/** Новые строки журнала после отметки: что записала последняя правка */
async function since(mark: bigint) {
  return prisma.auditLog.findMany({ where: { id: { gt: mark } }, orderBy: { id: "asc" } });
}
async function mark() {
  return (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? 0n;
}

type Edit = { name: string; run: () => Promise<unknown>; /** Правка значения: должны быть и «было», и «стало» */ both?: boolean };

beforeAll(async () => {
  await prisma.task.deleteMany();
  await prisma.weeklyEntry.deleteMany();
  await prisma.weeklyReport.deleteMany();
  await prisma.ceoReport.deleteMany();
  await prisma.week.deleteMany();
  await prisma.setting.update({ where: { key: "tasks.nextNumber" }, data: { value: 52 } });
  await importBordTasks(prisma, readFileSync("data/bord/zadachi-2026-10-05.csv", "utf8"), { batch: "bord-2026-10-05" });
  await importBordWeekly(prisma, readFileSync("data/bord/weekly-ceo-2026-10-05.csv", "utf8"), { batch: "bord-2026-10-05" });
  startId = await mark();
});
afterAll(() => prisma.$disconnect());

describe("по любой правке видно, что было и что стало", () => {
  it("задачи, weekly, отчёт CEO, справочники, люди и ритм недели", async () => {
    const owner = await tasks.actorFor("muradyan", "OWNER");
    const reva = await tasks.actorFor("reva");
    const rk = await weekly.currentReportingKey();
    const t = (await tasks.createTask(owner, { title: "Проверка журнала", outcome: "Видно было и стало", owner: "reva", direction: "osago", due })).task.number;
    let linkId = "";
    let entryId = "";
    const common = await prisma.weeklyEntry.findFirstOrThrow({ where: { authorId: null } });

    const edits: Edit[] = [
      { name: "статус задачи", run: () => tasks.changeStatus(reva, t, "clarify"), both: true },
      { name: "состояние задачи", run: () => tasks.changeState(reva, t, "at-risk"), both: true },
      { name: "приоритет", run: () => tasks.changePriority(owner, t, "high"), both: true },
      { name: "где сейчас", run: () => tasks.updateWhere(reva, t, "Жду ответа партнёра") },
      { name: "срок", run: () => tasks.transferDue(reva, t, addDays(due, 7), "Партнёр в отпуске"), both: true },
      { name: "название и результат", run: () => tasks.editTask(owner, t, { title: "Проверка журнала, правка", outcome: "Видно было и стало, правка" }), both: true },
      { name: "направление и источник", run: () => tasks.editTask(owner, t, { direction: "kasko", source: "ceo" }), both: true },
      { name: "ответственный", run: () => tasks.assignOwner(owner, t, "fatyanov"), both: true },
      { name: "соисполнители", run: () => tasks.setCoExecutors(owner, t, ["reva"]), both: true },
      {
        name: "ссылка добавлена",
        run: async () => {
          const r = await tasks.addLink(owner, t, { title: "Письмо", url: "https://example.com/a" });
          linkId = r.task.links[0]!.id!;
        },
      },
      { name: "ссылка убрана", run: () => tasks.removeLink(owner, t, linkId) },
      { name: "комментарий", run: () => tasks.addComment(reva, t, "Комментарий для журнала") },
      { name: "в архив", run: () => tasks.archiveTask(owner, t, true), both: true },
      { name: "из архива", run: () => tasks.archiveTask(owner, t, false), both: true },
      {
        name: "отмена переноса срока возвращает срок и пишет было и стало",
        run: async () => {
          const r = await tasks.transferDue(owner, t, addDays(due, 20), "Проверка отмены");
          await tasks.undoChange(owner, r.undo!);
        },
      },
      {
        name: "отмена статуса",
        run: async () => {
          const r = await tasks.changeStatus(owner, t, "in-progress");
          await tasks.undoChange(owner, r.undo!);
        },
        both: true,
      },
      { name: "новый ответственный был соисполнителем", run: () => tasks.assignOwner(owner, t, "reva"), both: true },
      {
        name: "запись weekly создана",
        run: async () => {
          entryId = (await weekly.saveEntry(reva, { week: rk, direction: "osago", block: "product", type: "event", what: "Запись для журнала" })).id;
          await weekly.saveHeadline(reva, rk, "Главное до сдачи");
        },
      },
      { name: "weekly сдан", run: () => weekly.submitWeekly(reva, rk), both: true },
      { name: "главное после сдачи", run: () => weekly.saveHeadline(reva, rk, "Главное после сдачи"), both: true },
      {
        name: "запись после сдачи: текст, блок, ссылка",
        run: () => weekly.saveEntry(reva, { id: entryId, week: rk, direction: "osago", block: "risks", type: "risk", what: "Запись для журнала, правка", links: [{ title: "Отчёт", url: "https://example.com/r" }] }),
      },
      { name: "отметка В отчёт CEO", run: () => weekly.setCeoFlag(owner, entryId, true), both: true },
      { name: "автор общей записи", run: () => weekly.assignEntryAuthor(owner, common.id, "loginova"), both: true },
      { name: "отчёт CEO впервые", run: () => weekly.saveCeoReport(owner, rk, { main: "- Первое", risks: "", next: "" }) },
      { name: "отчёт CEO правка", run: () => weekly.saveCeoReport(owner, rk, { main: "- Второе", risks: "", next: "" }), both: true },
      { name: "неделя закрыта", run: () => weekly.setWeekClosed(owner, rk, true), both: true },
      { name: "неделя открыта", run: () => weekly.setWeekClosed(owner, rk, false), both: true },
      {
        name: "администратор правит чужой черновик",
        run: async () => {
          const lg = await tasks.actorFor("loginova");
          const e = await weekly.saveEntry(lg, { week: rk, direction: "red", block: "product", type: "event", what: "Черновик Логиновой" });
          await weekly.saveEntry(owner, { id: e.id, week: rk, direction: "red", block: "product", type: "event", what: "Черновик Логиновой, поправил владелец" });
        },
      },
      { name: "запись удалена", run: () => weekly.deleteEntry(reva, entryId) },
      { name: "значение справочника добавлено", run: () => admin.addDictItem(owner, "TASK_SOURCE", "Письмо партнёра") },
      { name: "значение справочника переименовано", run: () => admin.renameDictItem(owner, "TASK_SOURCE", "pismo-partnera", "Письмо от партнёра"), both: true },
      { name: "значение справочника скрыто", run: () => admin.setDictItemActive(owner, "TASK_SOURCE", "pismo-partnera", false), both: true },
      { name: "человек добавлен", run: () => admin.createPerson(owner, { fullName: "Журналова Ирина", role: "LEADER", zone: "Проверка", direction: "osago" }) },
      { name: "человек: роль и зона", run: () => admin.updatePerson(owner, "zhurnalova", { role: "ADMIN", zone: "Проверка журнала" }), both: true },
      { name: "человек выключен", run: () => admin.setPersonActive(owner, "zhurnalova", false), both: true },
      {
        name: "ритм недели",
        run: async () => {
          const r = await admin.getRhythm();
          await admin.saveRhythm(owner, { ...r, staleDays: r.staleDays + 3 });
          await admin.saveRhythm(owner, r);
        },
        both: true,
      },
    ];

    for (const e of edits) {
      const m = await mark();
      await e.run();
      const rows = await since(m);
      expect(rows.length, `${e.name}: правка не попала в журнал`).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.actorId, `${e.name}: нет автора`).toBeTruthy();
        expect(r.field, `${e.name}: не названо поле`).toBeTruthy();
        expect(r.before !== null || r.after !== null, `${e.name}: нет ни «было», ни «стало»`).toBe(true);
        if (e.both) {
          expect(r.before, `${e.name}, ${r.field}: нет «было»`).not.toBeNull();
          expect(r.after, `${e.name}, ${r.field}: нет «стало»`).not.toBeNull();
        }
      }
    }
  });

  it("в журнале подписи людям понятны: метки, а не коды", async () => {
    const rows = await prisma.auditLog.findMany({ where: { id: { gt: startId }, action: { in: ["task.update", "weekly.entry.update", "settings.person.update"] } } });
    expect(rows.length).toBeGreaterThan(10);
    const codes = /^(in-progress|clarify|at-risk|on-track|high|medium|osago|kasko|risks|product|risk|event|ADMIN|LEADER|reva|fatyanov)$/;
    for (const r of rows) {
      expect(String(r.before ?? "")).not.toMatch(codes);
      expect(String(r.after ?? "")).not.toMatch(codes);
    }
  });
});

describe("фильтры журнала на сервере", () => {
  it("тип события, человек, источник и подгрузка", async () => {
    const settings = await journalEvents({ kind: "settings", limit: 500 });
    expect(settings.events.length).toBeGreaterThan(0);
    expect(settings.events.every((e) => e.kind === "settings")).toBe(true);
    expect(settings.events.some((e) => e.object === "Справочник «Источники задач»: Письмо от партнёра")).toBe(true);
    expect(settings.events.some((e) => e.object === "Человек: Журналова Ирина")).toBe(true);
    expect(settings.events.some((e) => e.object === "Ритм недели")).toBe(true);

    const byReva = await journalEvents({ who: "reva", limit: 500 });
    expect(byReva.events.length).toBeGreaterThan(0);
    expect(byReva.events.every((e) => e.by === "reva")).toBe(true);

    const sheet = await journalEvents({ source: "sheet", limit: 5 });
    expect(sheet.events.every((e) => e.source === "sheet")).toBe(true);
    expect(sheet.total).toBeGreaterThan(5);
    expect(sheet.events).toHaveLength(5);

    const comments = await journalEvents({ kind: "comment" });
    expect(comments.events.every((e) => e.kind === "comment" && e.field === "Комментарий")).toBe(true);
    const tasksOnly = await journalEvents({ kind: "task", limit: 500 });
    expect(tasksOnly.events.some((e) => e.kind === "comment")).toBe(false);

    const weeklyRows = await journalEvents({ kind: "weekly", limit: 500 });
    expect(weeklyRows.events.some((e) => e.object.startsWith("Запись weekly «Запись для журнала"))).toBe(true);

    const old = await journalEvents({ days: 7, limit: 5000 }, new Date("2030-01-01T00:00:00Z"));
    expect(old.total).toBe(0);
  });
});

describe("точность журнала", () => {
  it("отмена пишет каждое возвращённое поле; повторная отметка CEO ничего не выдумывает", async () => {
    const owner = await tasks.actorFor("muradyan", "OWNER");
    const t = (await tasks.createTask(owner, { title: "Отмена", outcome: "Видно, что вернулось", owner: "reva", direction: "osago", due })).task.number;
    const r = await tasks.transferDue(owner, t, addDays(due, 5), "Проверка");
    const m = await mark();
    await tasks.undoChange(owner, r.undo!);
    const rows = await since(m);
    expect(rows.map((x) => x.field)).toEqual(["Срок (отмена)", "Перенос срока отменён"]);
    expect([rows[0]!.before, rows[0]!.after]).toEqual([formatLong(addDays(due, 5)), formatLong(due)]);

    const rk = await weekly.currentReportingKey();
    const e = await weekly.saveEntry(await tasks.actorFor("reva"), { week: rk, direction: "osago", block: "product", type: "event", what: "Для отметки" });
    await weekly.setCeoFlag(owner, e.id, true);
    const m2 = await mark();
    await weekly.setCeoFlag(owner, e.id, true);
    expect(await since(m2)).toHaveLength(0);
  });

  it("отмена создания не удаляет задачу, которую уже поменял другой", async () => {
    const reva = await tasks.actorFor("reva");
    const created = await tasks.createTask(reva, { title: "Своя задача", outcome: "Итог", owner: "reva", direction: "osago", due });
    await tasks.changePriority(await tasks.actorFor("golovkin", "ADMIN"), created.task.number, "critical");
    await expect(tasks.undoChange(reva, created.undo!)).rejects.toThrow(/уже изменили/);
    expect(await tasks.getTask(created.task.number)).not.toBeNull();
  });

  it("в архивную задачу лидер не пишет комментарий", async () => {
    const owner = await tasks.actorFor("muradyan", "OWNER");
    const t = (await tasks.createTask(owner, { title: "В архив", outcome: "Итог", owner: "reva", direction: "osago", due })).task.number;
    await tasks.archiveTask(owner, t, true);
    await expect(tasks.addComment(await tasks.actorFor("reva"), t, "Привет")).rejects.toThrow(/в архиве/);
  });

  it("выключенного соисполнителя можно снять, а новым его не назначить", async () => {
    const owner = await tasks.actorFor("muradyan", "OWNER");
    const t = (await tasks.createTask(owner, { title: "Соисполнители", outcome: "Итог", owner: "reva", direction: "osago", due, coExecutors: ["fatyanov", "loginova"] })).task.number;
    await admin.setPersonActive(owner, "fatyanov", false);
    // Логинову убираем, выключенный Фатьянов остаётся: правка проходит
    const r = await tasks.setCoExecutors(owner, t, ["fatyanov"]);
    expect(r.task.coExecutors).toEqual(["fatyanov"]);
    await expect(tasks.setCoExecutors(owner, t, ["fatyanov", "afanasyev"])).resolves.toBeTruthy();
    const t2 = (await tasks.createTask(owner, { title: "Другая", outcome: "Итог", owner: "reva", direction: "osago", due })).task.number;
    await expect(tasks.setCoExecutors(owner, t2, ["fatyanov"])).rejects.toThrow(/нет в команде/);
    await admin.setPersonActive(owner, "fatyanov", true);
  });
});
