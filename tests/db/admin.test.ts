// Настройки на настоящей базе: справочники, люди и роли, ритм недели. Каждая правка в журнале с тем, что было и что стало.
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as weekly from "@/lib/weekly/service";
import * as admin from "@/lib/admin/service";
import { loadRegistry } from "@/lib/registry";
import { importBordWeekly } from "@/lib/weekly/bord-import";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";

const owner = () => tasks.actorFor("muradyan", "OWNER");
const adminActor = () => tasks.actorFor("golovkin", "ADMIN");
const due = addDays(moscowToday(), 10);

async function lastAudit(action: string) {
  return prisma.auditLog.findFirst({ where: { action }, orderBy: { id: "desc" } });
}

beforeEach(async () => {
  await prisma.task.deleteMany();
  await prisma.weeklyEntry.deleteMany();
  await prisma.weeklyReport.deleteMany();
  await prisma.ceoReport.deleteMany();
  await prisma.week.deleteMany();
  await prisma.person.deleteMany({ where: { slug: { notIn: ["muradyan", "golovkin", "analyst", "reva", "loginova", "fatyanov", "sakhibullina", "afanasyev", "cheychenets", "ceo"] } } });
  await prisma.dictionaryItem.deleteMany({ where: { kind: { in: ["DIRECTION", "WEEKLY_BLOCK", "TASK_SOURCE"] }, code: { notIn: ["osago", "kasko", "red", "deposits", "partners", "product", "insurance", "department", "key-changes", "risks", "team", "numbers", "traffic", "meeting", "weekly", "ceo", "other"] } } });
  await prisma.dictionaryItem.updateMany({ data: { active: true }, where: { kind: { in: ["DIRECTION", "WEEKLY_BLOCK", "ENTRY_TYPE", "TASK_SOURCE"] } } });
  await prisma.dictionaryItem.updateMany({ data: { label: "План" }, where: { kind: "ENTRY_TYPE", code: "plan" } });
  await prisma.setting.update({ where: { key: "week.deadline" }, data: { value: { weekday: 1, time: "18:00" } } });
  await prisma.setting.update({ where: { key: "week.meeting" }, data: { value: { weekday: 2 } } });
  await prisma.setting.update({ where: { key: "tasks.staleDays" }, data: { value: 14 } });
  await prisma.setting.upsert({ where: { key: "stand.banner" }, update: { value: "test" }, create: { key: "stand.banner", value: "test" } });
});
afterAll(() => prisma.$disconnect());

describe("справочники", () => {
  it("новое значение получает латинский код, повтор названия не проходит, журнал пишет что добавили", async () => {
    const a = await adminActor();
    const added = await admin.addDictItem(a, "DIRECTION", "Страхование жизни");
    expect(added.code).toBe("strakhovanie-zhizni");
    await expect(admin.addDictItem(a, "DIRECTION", "страхование ЖИЗНИ")).rejects.toThrow(/уже есть/);
    const log = await lastAudit("settings.dict.create");
    expect([log?.field, log?.before, log?.after]).toEqual(["Направления", null, "Страхование жизни"]);
    await expect(admin.addDictItem(a, "WEEKLY_BLOCK", "Партнёры и СК ")).rejects.toThrow(/уже есть/);
  });

  it("типы записей не добавляются, но переименовываются; было и стало в журнале", async () => {
    const a = await adminActor();
    await expect(admin.addDictItem(a, "ENTRY_TYPE", "Идея")).rejects.toThrow(/разделы отчёта CEO/);
    await admin.renameDictItem(a, "ENTRY_TYPE", "plan", "План на неделю");
    const log = await lastAudit("settings.dict.rename");
    expect([log?.field, log?.before, log?.after]).toEqual(["Типы записей: название", "План", "План на неделю"]);
    const reg = await loadRegistry();
    expect(reg.dicts.ENTRY_TYPE.find((d) => d.code === "plan")?.label).toBe("План на неделю");
  });

  it("скрытое значение нельзя выбрать заново, но запись с ним сохраняется; последнее видимое не скрыть", async () => {
    const a = await adminActor();
    await importBordWeekly(prisma, readFileSync("data/bord/weekly-ceo-2026-10-05.csv", "utf8"), { batch: "x" });
    const rk = await weekly.currentReportingKey();
    const reva = await tasks.actorFor("reva");
    const e = await weekly.saveEntry(reva, { week: rk, direction: "kasko", block: "product", type: "event", what: "Запись до скрытия" });
    await admin.setDictItemActive(a, "DIRECTION", "kasko", false);
    const hide = await lastAudit("settings.dict.hide");
    expect([hide?.field, hide?.before, hide?.after]).toEqual(["Направления: «КАСКО»", "в списке", "скрыто"]);
    // Старая запись правится с прежним направлением
    await weekly.saveEntry(reva, { id: e.id, week: rk, direction: "kasko", block: "product", type: "event", what: "Запись после скрытия" });
    // Новая с ним не создаётся, задача тоже
    await expect(weekly.saveEntry(reva, { week: rk, direction: "kasko", block: "product", type: "event", what: "Новая" })).rejects.toThrow(/направление из списка/);
    await expect(tasks.createTask(a, { title: "С КАСКО", outcome: "Итог", owner: "reva", direction: "kasko", due })).rejects.toThrow(/направление из списка/);
    // Подпись в снимке для экранов осталась, но в выборе значения нет
    const reg = await loadRegistry();
    expect(reg.dicts.DIRECTION.find((d) => d.code === "kasko")).toEqual({ code: "kasko", label: "КАСКО", active: false });

    const sources = await prisma.dictionaryItem.findMany({ where: { kind: "TASK_SOURCE" } });
    for (const s of sources.slice(1)) await admin.setDictItemActive(a, "TASK_SOURCE", s.code, false);
    await expect(admin.setDictItemActive(a, "TASK_SOURCE", sources[0]!.code, false)).rejects.toThrow(/Последнее видимое/);
  });

  it("счётчик использования считает задачи, записи и людей", async () => {
    const list = await admin.listDictionaries();
    const department = list.DIRECTION.find((d) => d.code === "department")!;
    expect(department.used).toBeGreaterThan(0);
  });
});

describe("люди и роли", () => {
  it("владелец добавляет человека: код из фамилии, сразу в списке экранов, может стать ответственным", async () => {
    const o = await owner();
    const p = await admin.createPerson(o, { fullName: "Новикова Анна", role: "LEADER", zone: "Ипотека", direction: "red" });
    expect(p.slug).toBe("novikova");
    const log = await lastAudit("settings.person.create");
    expect(log?.after).toBe("Новикова Анна, лидер, Ипотека");
    const reg = await loadRegistry();
    expect(reg.people.find((x) => x.slug === "novikova")).toMatchObject({ fullName: "Новикова Анна", shortName: "Анна", direction: "red", active: true });
    const t = await tasks.createTask(o, { title: "Познакомиться с командой", outcome: "Встреча проведена", owner: "novikova", direction: "red", due });
    expect(t.task.owner).toBe("novikova");
    const twin = await admin.createPerson(o, { fullName: "Новикова Мария", role: "LEADER", zone: "Ипотека", direction: "red" });
    expect(twin.slug).toBe("novikova-2");
    await expect(admin.createPerson(o, { fullName: "Новикова Анна", role: "LEADER", zone: "X", direction: "red" })).rejects.toThrow(/уже есть в команде/);
  });

  it("правка роли и зоны пишет в журнал каждое поле: было и стало", async () => {
    const o = await owner();
    // Журнал общий для всех файлов тестов: смотрим только записи этой правки
    const since = await prisma.auditLog.aggregate({ _max: { id: true } });
    await admin.updatePerson(o, "reva", { role: "ADMIN", zone: "Продукт" });
    const rows = await prisma.auditLog.findMany({ where: { action: "settings.person.update", entityId: "reva", id: { gt: since._max.id ?? 0n } }, orderBy: { id: "asc" } });
    expect(rows.map((r) => [r.field, r.before, r.after])).toEqual([
      ["Зона", "Продукт и CJM по всем линиям", "Продукт"],
      ["Роль", "Лидер", "Администратор"],
    ]);
    await admin.updatePerson(o, "reva", { role: "LEADER", zone: "Продукт и CJM по всем линиям" });
  });

  it("выключенный пропадает из выбора себя и списков, история остаётся; включается обратно", async () => {
    const o = await owner();
    await admin.setPersonActive(o, "afanasyev", false);
    expect(await prisma.person.findMany({ where: { active: true, slug: "afanasyev" } })).toHaveLength(0);
    const log = await lastAudit("settings.person.disable");
    expect([log?.field, log?.before, log?.after]).toEqual(["В команде", "да", "выключен"]);
    await admin.setPersonActive(o, "afanasyev", true);
    expect((await lastAudit("settings.person.enable"))?.after).toBe("да");
  });
});

describe("ритм недели", () => {
  it("новый срок действует для недель, срок которых ещё не прошёл; прошедшие и закрытые не трогаются", async () => {
    // 05.10.2026 утро: неделя 40 открыта, срок сегодня 18:00; неделя 39 закрыта
    const NOW = new Date("2026-10-05T07:00:00Z");
    await weekly.ensureWeek(prisma, "2026-09-28");
    const w39 = await weekly.ensureWeek(prisma, "2026-09-21");
    await prisma.week.update({ where: { id: w39.id }, data: { closedAt: NOW } });
    const a = await adminActor();
    const r = await admin.saveRhythm(a, { deadlineWeekday: 2, deadlineTime: "12:00", meetingWeekday: 3, staleDays: 10 }, NOW);
    expect(r).toEqual({ changed: 3, weeks: 1 });
    const w40 = await prisma.week.findUniqueOrThrow({ where: { start: new Date("2026-09-28T00:00:00Z") } });
    // Вторник 06.10 12:00 по Москве
    expect(w40.deadline.toISOString()).toBe("2026-10-06T09:00:00.000Z");
    expect(w40.meetingDate.toISOString().slice(0, 10)).toBe("2026-10-07");
    const old = await prisma.week.findUniqueOrThrow({ where: { id: w39.id } });
    expect(old.deadline.toISOString()).toBe(w39.deadline.toISOString());
    const rows = await prisma.auditLog.findMany({ where: { action: "settings.update" }, orderBy: { id: "desc" }, take: 3 });
    expect(rows.map((x) => [x.field, x.before, x.after]).reverse()).toEqual([
      ["Срок сдачи weekly", "понедельник, 18:00", "вторник, 12:00"],
      ["День встречи", "вторник", "среда"],
      ["Давно не обновлялась, дней", "14", "10"],
    ]);
    expect((await loadRegistry()).staleDays).toBe(10);
    // Повтор тех же значений ничего не пишет
    expect(await admin.saveRhythm(a, { deadlineWeekday: 2, deadlineTime: "12:00", meetingWeekday: 3, staleDays: 10 }, NOW)).toEqual({ changed: 0, weeks: 0 });
  });

  it("неверные значения не проходят", async () => {
    const a = await adminActor();
    await expect(admin.saveRhythm(a, { deadlineWeekday: 8, deadlineTime: "18:00", meetingWeekday: 2, staleDays: 14 })).rejects.toThrow(/день недели/);
    await expect(admin.saveRhythm(a, { deadlineWeekday: 1, deadlineTime: "25:00", meetingWeekday: 2, staleDays: 14 })).rejects.toThrow(/18:00/);
    await expect(admin.saveRhythm(a, { deadlineWeekday: 1, deadlineTime: "18:00", meetingWeekday: 2, staleDays: 0 })).rejects.toThrow(/от 1 до 90/);
  });
});

describe("ограничения базы", () => {
  it("пустое название значения и пустое имя не пройдут даже мимо сервиса", async () => {
    await expect(prisma.dictionaryItem.create({ data: { kind: "DIRECTION", code: "empty", label: "  " } })).rejects.toThrow(/dictionary_items_label_check/);
    const p = await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } });
    await expect(prisma.person.update({ where: { id: p.id }, data: { fullName: "" } })).rejects.toThrow(/people_full_name_check/);
  });
});

describe("выгрузка в Excel", () => {
  it("все листы с данными, подписи вместо кодов, московское время", async () => {
    const { buildExport } = await import("@/lib/admin/export");
    const ExcelJS = (await import("exceljs")).default;
    const { importBordTasks } = await import("@/lib/tasks/bord-import");
    await prisma.setting.update({ where: { key: "tasks.nextNumber" }, data: { value: 52 } });
    await importBordTasks(prisma, readFileSync("data/bord/zadachi-2026-10-05.csv", "utf8"), { batch: "bord-2026-10-05" });
    await importBordWeekly(prisma, readFileSync("data/bord/weekly-ceo-2026-10-05.csv", "utf8"), { batch: "x" });
    const o = await owner();
    await tasks.archiveTask(o, 3, true);

    const { buffer, summary } = await buildExport();
    expect(summary).toMatchObject({ tasks: 51, entries: 51 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Задачи", "Переносы", "Комментарии", "Weekly", "Сдача weekly", "Недели", "Отчёты CEO", "Просьбы", "Люди", "Справочники", "Журнал"]);
    const t = wb.getWorksheet("Задачи")!;
    expect(t.rowCount).toBe(52);
    const header = (t.getRow(1).values as string[]).slice(1);
    const row3 = t.getRows(2, 51)!.find((r) => r.getCell(1).value === 3)!;
    expect(row3.getCell(header.indexOf("В архиве") + 1).value).toBe("да");
    expect(["В работе", "Выполнена", "Требует уточнений", "Не выполнена", "Отменена"]).toContain(row3.getCell(header.indexOf("Статус") + 1).value);
    expect(wb.getWorksheet("Weekly")!.rowCount).toBe(52);
    expect(wb.getWorksheet("Люди")!.getRow(2).getCell(3).value).toBe("Владелец");
    // Журнал: последнее событие (архив задачи 3) с московским временем
    const j = wb.getWorksheet("Журнал")!;
    const last = j.getRow(j.rowCount);
    expect(last.getCell(3).value).toBe("Задача в архиве");
    const at = last.getCell(1).value as Date;
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "task.archive" }, orderBy: { id: "desc" } });
    expect(at.getTime() - audit.at.getTime()).toBe(3 * 3600 * 1000);
  });
});

describe("плашка над страницами (этап 7)", () => {
  it("переключает только владелец, в журнале было и стало, неизвестный вид не проходит", async () => {
    expect(await admin.getStandBanner()).toBe("test");
    await expect(admin.saveStandBanner(await adminActor(), "pilot")).rejects.toThrow(/только владелец/);
    await expect(admin.saveStandBanner(await owner(), "nope" as admin.StandBanner)).rejects.toThrow(/из списка/);
    expect(await admin.saveStandBanner(await owner(), "pilot")).toBe("pilot");
    expect(await admin.getStandBanner()).toBe("pilot");
    const log = await lastAudit("settings.banner");
    expect([log?.field, log?.before, log?.after]).toEqual(["Плашка над страницами", "Тестовый стенд", "Пилот"]);
    // Повтор того же вида журнал не засоряет
    await admin.saveStandBanner(await owner(), "pilot");
    expect(await prisma.auditLog.count({ where: { action: "settings.banner" } })).toBe(1);
    await prisma.setting.update({ where: { key: "stand.banner" }, data: { value: "garbage" } });
    expect(await admin.getStandBanner()).toBe("test");
  });
});

