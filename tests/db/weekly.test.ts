// Weekly на настоящей базе: импорт вкладки Weekly CEO, недели, черновик, сдача, права, журнал, отчёт CEO.
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as svc from "@/lib/weekly/service";
import { importBordWeekly } from "@/lib/weekly/bord-import";
import { shiftWeek } from "@/lib/weekly/weeks";

const CSV = readFileSync("data/bord/weekly-ceo-2026-10-05.csv", "utf8");
// 05.10.2026, утро понедельника: отчётная неделя 40 (28.09-04.10), срок сдачи сегодня в 18:00
const NOW = new Date("2026-10-05T07:00:00Z");
const W40 = "2026-09-28";
const W39 = "2026-09-21";

async function reset() {
  await prisma.task.deleteMany();
  await prisma.weeklyEntry.deleteMany();
  await prisma.weeklyReport.deleteMany();
  await prisma.ceoReport.deleteMany();
  await prisma.week.deleteMany();
  await importBordWeekly(prisma, CSV, { batch: "bord-2026-10-05" });
}

const actor = {
  reva: () => tasks.actorFor("reva"),
  loginova: () => tasks.actorFor("loginova"),
  admin: () => tasks.actorFor("golovkin", "ADMIN"),
  adminPlain: () => tasks.actorFor("golovkin"),
  owner: () => tasks.actorFor("muradyan", "OWNER"),
  observer: async (): Promise<tasks.Actor> => ({ ...(await tasks.actorFor("ceo")), role: "OBSERVER" }),
};

const entry = (week = W40, patch: Partial<svc.EntryInput> = {}): svc.EntryInput => ({ week, direction: "osago", block: "product", type: "event", what: "Запустили AB-тест рекомендаций", ...patch });

const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

beforeEach(reset);
afterAll(() => prisma.$disconnect());

describe("импорт вкладки Weekly CEO", () => {
  it("51 запись в неделях 38 и 39, недели закрыты, у авторов weekly сдан, общие записи без автора", async () => {
    expect(await prisma.weeklyEntry.count()).toBe(51);
    const weeks = await prisma.week.findMany({ orderBy: { start: "asc" } });
    expect(weeks.map((w) => [w.isoNumber, w.closedAt !== null])).toEqual([
      [38, true],
      [39, true],
    ]);
    expect(await prisma.weeklyEntry.count({ where: { authorId: null } })).toBe(2);
    expect(await prisma.weeklyEntry.count({ where: { ceo: true } })).toBe(35);
    const reports = await prisma.weeklyReport.findMany({ include: { author: true } });
    expect(reports.every((r) => r.state === "SUBMITTED")).toBe(true);
    expect(new Set(reports.map((r) => r.author.slug)).size).toBe(7);
    const again = await importBordWeekly(prisma, CSV, { batch: "x" });
    expect(again.skipped).toBe(true);
    expect(await prisma.weeklyEntry.count()).toBe(51);
  });

  it("ссылки из колонки «Комментарий» стали ссылками записи, «что произошло» не длиннее 150 знаков", async () => {
    const withLinks = await prisma.weeklyEntry.findMany({ where: { NOT: { links: { equals: [] } } } });
    expect(withLinks.length).toBeGreaterThan(0);
    const all = await prisma.weeklyEntry.findMany();
    expect(all.every((e) => e.what.length <= 150)).toBe(true);
  });
});

describe("лента недели", () => {
  it("пока отчётная неделя пустая, открывается последняя неделя с записями", async () => {
    const view = await svc.getWeekView(null, NOW);
    expect(view.fallback).toBe(true);
    expect(view.week.number).toBe(39);
    expect(view.reportingNumber).toBe(40);
    expect(view.next).toBe(W40);
    expect(view.entries).toHaveLength(17);
    expect(view.reports.find((r) => r.author === "reva")?.state).toBe("submitted");
    expect(view.reports.find((r) => r.author === "afanasyev")?.state).toBe("not-started");
  });

  it("с первой записью отчётной недели лента открывает её, дальше отчётной не листается", async () => {
    await svc.saveEntry(await actor.reva(), entry());
    const view = await svc.getWeekView(null, NOW);
    expect(view.fallback).toBe(false);
    expect(view.week.key).toBe(W40);
    expect(view.next).toBeNull();
    const future = await svc.getWeekView(shiftWeek(W40, 5), NOW);
    expect(future.week.key).toBe(W40);
  });
});

describe("сдача weekly в три шага", () => {
  it("черновик, запись, сдача до срока: «Сдан»; после срока: «Сдан с опозданием»", async () => {
    const reva = await actor.reva();
    await expectRule(svc.submitWeekly(reva, W40, NOW), /главное за неделю/);
    const draft = await svc.saveHeadline(reva, W40, "Вернули продажи после бага Альфы");
    expect(draft.state).toBe("draft");
    await expectRule(svc.submitWeekly(reva, W40, NOW), /хотя бы одну запись/);
    await svc.saveEntry(reva, entry());
    const done = await svc.submitWeekly(reva, W40, NOW);
    expect(done.state).toBe("submitted");
    expect(done.submittedAt).toBe(NOW.toISOString());
    await expectRule(svc.submitWeekly(reva, W40, NOW), /уже сдан/);

    const loginova = await actor.loginova();
    await svc.saveHeadline(loginova, W40, "Кросс к ипотеке работает");
    await svc.saveEntry(loginova, entry(W40, { direction: "red" }));
    const late = await svc.submitWeekly(loginova, W40, new Date("2026-10-05T15:30:00Z"));
    expect(late.state).toBe("late");
  });

  it("автосохранение черновика журнал не засоряет, правки после сдачи пишутся с «было» и «стало»", async () => {
    const reva = await actor.reva();
    const created = await svc.saveEntry(reva, entry());
    await svc.saveEntry(reva, entry(W40, { id: created.id, what: "Запустили AB-тест рекомендаций при нулевой выдаче" }));
    const draftLogs = await prisma.auditLog.count({ where: { action: "weekly.entry.update", entityId: created.id } });
    expect(draftLogs).toBe(0);
    await svc.saveHeadline(reva, W40, "Главное");
    await svc.submitWeekly(reva, W40, NOW);
    await svc.saveEntry(reva, entry(W40, { id: created.id, what: "Тест завершён", fact: "+3% конверсии" }));
    const logs = await prisma.auditLog.findMany({ where: { action: "weekly.entry.update", entityId: created.id }, orderBy: { id: "asc" } });
    expect(logs.map((l) => [l.field, l.before, l.after])).toEqual([
      ["Что произошло", "Запустили AB-тест рекомендаций при нулевой выдаче", "Тест завершён"],
      ["Цифра или факт", null, "+3% конверсии"],
    ]);
  });

  it("проверки записи: обязательное «что произошло» до 150 знаков, справочники, ссылки только http", async () => {
    const reva = await actor.reva();
    await expectRule(svc.saveEntry(reva, entry(W40, { what: " " })), /что произошло/);
    await expectRule(svc.saveEntry(reva, entry(W40, { what: "x".repeat(151) })), /150/);
    await expectRule(svc.saveEntry(reva, entry(W40, { block: "nope" })), /блок/);
    await expectRule(svc.saveEntry(reva, entry(W40, { links: [{ title: "", url: "javascript:alert(1)" }] })), /https/);
    const ok = await svc.saveEntry(reva, entry(W40, { what: "Итоги — в отчёте", links: [{ title: "", url: "https://datalens.example/x" }] }));
    expect(ok.what).toBe("Итоги - в отчёте");
    expect(ok.links).toEqual([{ title: "datalens.example", url: "https://datalens.example/x" }]);
  });
});

describe("права weekly (матрица раздела 2)", () => {
  it("чужой weekly лидер не правит, закрытую неделю тоже; администратор в режиме управления может", async () => {
    const reva = await actor.reva();
    const mine = await svc.saveEntry(reva, entry());
    await expectRule(svc.saveEntry(await actor.loginova(), entry(W40, { id: mine.id, what: "Подмена" })), /Чужой weekly/);
    await expectRule(svc.deleteEntry(await actor.loginova(), mine.id), /Чужой weekly/);
    await expectRule(svc.saveEntry(await actor.adminPlain(), entry(W40, { id: mine.id, what: "Без режима" })), /Чужой weekly/);
    const fixed = await svc.saveEntry(await actor.admin(), entry(W40, { id: mine.id, what: "Поправил администратор" }));
    expect(fixed.what).toBe("Поправил администратор");
    expect(fixed.author).toBe("reva");

    const old = await prisma.weeklyEntry.findFirstOrThrow({ where: { author: { slug: "reva" }, week: { isoNumber: 39 } } });
    await expectRule(svc.saveEntry(reva, entry(W39, { id: old.id, what: "Поздняя правка" })), /закрыта/);
    expect((await svc.saveEntry(await actor.admin(), entry(W39, { id: old.id, what: "Правка после встречи" }))).what).toBe("Правка после встречи");
  });

  it("за будущую неделю weekly не пишут, наблюдатель не пишет вовсе", async () => {
    await expectRule(svc.saveEntry(await actor.reva(), entry(shiftWeek(W40, 10))), /будущую/);
    await expectRule(svc.saveHeadline(await actor.observer(), W40, "Нет"), /Наблюдатель/);
  });

  it("закрыть неделю, отметить «В отчёт CEO» и назначить автора общей записи: только режим управления", async () => {
    const reva = await actor.reva();
    const e = await svc.saveEntry(reva, entry());
    await expectRule(svc.setCeoFlag(reva, e.id, true), /режиме управления/);
    expect((await svc.setCeoFlag(await actor.admin(), e.id, true)).ceo).toBe(true);
    await expectRule(svc.setWeekClosed(await actor.adminPlain(), W40, true), /режиме управления/);
    const closed = await svc.setWeekClosed(await actor.admin(), W40, true);
    expect(closed.closed).toBe(true);
    await expectRule(svc.saveEntry(reva, entry(W40, { id: e.id, what: "После закрытия" })), /закрыта/);
    await svc.setWeekClosed(await actor.owner(), W40, false);
    expect((await svc.saveEntry(reva, entry(W40, { id: e.id, what: "Снова открыта" }))).what).toBe("Снова открыта");

    const common = await prisma.weeklyEntry.findFirstOrThrow({ where: { authorId: null } });
    await expectRule(svc.assignEntryAuthor(reva, common.id, "reva"), /режиме управления/);
    const assigned = await svc.assignEntryAuthor(await actor.owner(), common.id, "sakhibullina");
    expect(assigned.author).toBe("sakhibullina");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "weekly.entry.author", entityId: common.id } });
    expect(log.after).toBe("Сахибуллина Алсу");
  });
});

describe("отчёт CEO и задачи из записей", () => {
  it("отчёт сохраняется по неделе с автором правки, длинное тире становится дефисом, видна история", async () => {
    await expectRule(svc.saveCeoReport(await actor.reva(), W39, { main: "x", risks: "", next: "" }), /режиме управления/);
    const saved = await svc.saveCeoReport(await actor.owner(), W39, { main: "- Продажи — вверх", risks: "", next: "" });
    expect(saved.sections?.main).toBe("- Продажи - вверх");
    expect((await svc.getCeoReport(W39)).updatedBy).toBe("Мурадян Арам");
    const history = await svc.ceoReportHistory();
    expect(history.map((h) => [h.number, h.flagged, !!h.savedAt])).toEqual([
      [39, 12, true],
      [38, 23, false],
    ]);
  });

  it("«Сделать задачей» связывает задачу с записью", async () => {
    const reva = await actor.reva();
    const e = await svc.saveEntry(reva, entry(W40, { next: "Отчёт по ошибкам СК" }));
    const t = await tasks.createTask(reva, { title: "Отчёт по ошибкам СК", outcome: e.what, owner: "reva", direction: "product", due: "2030-01-15", source: "weekly", weeklyEntryId: e.id });
    const view = await svc.getMyWeekly((await actor.reva()).personId, W40);
    expect(view.entries.find((x) => x.id === e.id)?.taskNumber).toBe(t.task.number);
  });
});

describe("удаление записи с отменой (этап 7)", () => {
  it("отмена возвращает запись с тем же id, порядком, ссылками и связью с задачей, «Обновлена» у задачи не меняется", async () => {
    const reva = await actor.reva();
    const first = await svc.saveEntry(reva, entry(W40, { what: "Первая запись" }));
    const e = await svc.saveEntry(reva, entry(W40, { what: "Запись с задачей", fact: "+3%", links: [{ title: "Отчёт", url: "https://datalens.example/r" }] }));
    const t = await tasks.createTask(reva, { title: "Задача из записи", outcome: e.what, owner: "reva", direction: "product", due: "2030-01-15", source: "weekly", weeklyEntryId: e.id });
    const before = await prisma.weeklyEntry.findUniqueOrThrow({ where: { id: e.id } });
    const taskBefore = await prisma.task.findUniqueOrThrow({ where: { id: (await prisma.task.findFirstOrThrow({ where: { number: t.task.number } })).id } });

    const snapshot = await svc.deleteEntry(reva, e.id);
    expect(await prisma.weeklyEntry.findUnique({ where: { id: e.id } })).toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskBefore.id } })).weeklyEntryId).toBeNull();
    expect(snapshot.taskIds).toEqual([taskBefore.id]);

    const back = await svc.restoreEntry(reva, snapshot);
    expect(back.id).toBe(e.id);
    expect(back.taskNumber).toBe(t.task.number);
    expect(back.links).toEqual([{ title: "Отчёт", url: "https://datalens.example/r" }]);
    const after = await prisma.weeklyEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect([after.sortOrder, after.fact, after.createdAt.toISOString()]).toEqual([before.sortOrder, "+3%", before.createdAt.toISOString()]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskBefore.id } })).updatedAt.toISOString()).toBe(taskBefore.updatedAt.toISOString());
    expect(await prisma.weeklyEntry.findUnique({ where: { id: first.id } })).not.toBeNull();

    const logs = await prisma.auditLog.findMany({ where: { entityId: e.id, action: { in: ["weekly.entry.delete", "weekly.entry.restore"] } }, orderBy: { id: "asc" } });
    expect(logs.map((l) => [l.action, l.before, l.after])).toEqual([
      ["weekly.entry.delete", "Запись с задачей", null],
      ["weekly.entry.restore", null, "Запись с задачей"],
    ]);
    await expectRule(svc.restoreEntry(reva, snapshot), /уже на месте/);
  });

  it("вернуть запись может тот, кто может её править: чужую нельзя, после закрытия недели только управление", async () => {
    const reva = await actor.reva();
    const e = await svc.saveEntry(reva, entry(W40, { what: "Удалю и верну" }));
    const snapshot = await svc.deleteEntry(reva, e.id);
    await expectRule(svc.restoreEntry(await actor.loginova(), snapshot), /Чужой weekly/);
    await svc.setWeekClosed(await actor.admin(), W40, true);
    await expectRule(svc.restoreEntry(reva, snapshot), /закрыта/);
    expect((await svc.restoreEntry(await actor.admin(), snapshot)).author).toBe("reva");
  });
});


describe("нет на неделе (этап 9)", () => {
  beforeEach(async () => {
    await prisma.absence.deleteMany();
  });

  it("человек отмечает себя с замещающим: weekly не ждём, в ленте он отсутствует, журнал пишет было и стало", async () => {
    const reva = await actor.reva();
    const saved = await svc.setAbsence(reva, { slug: "reva", week: W40, substitute: "golovkin" }, NOW);
    expect(saved).toMatchObject({ week: W40, number: 40, substitute: "golovkin" });
    const view = await svc.getWeekView(W40, NOW);
    expect(view.reports.find((r) => r.author === "reva")?.absent).toEqual({ substitute: "golovkin" });
    expect(view.reports.find((r) => r.author === "loginova")?.absent).toBeUndefined();
    const mine = await svc.getMyWeekly(reva.personId, W40, NOW);
    expect(mine.report.absent).toEqual({ substitute: "golovkin" });

    // Смена замещающего и отмена
    await svc.setAbsence(reva, { slug: "reva", week: W40, substitute: null }, NOW);
    const logs = await prisma.auditLog.findMany({ where: { action: "weekly.absence.set" }, orderBy: { id: "asc" } });
    expect(logs.map((l) => [l.entityId, l.before, l.after])).toEqual([
      [`${W40}/reva`, "на месте", "нет, замещает Головкин Владислав"],
      [`${W40}/reva`, "нет, замещает Головкин Владислав", "нет, без замещающего"],
    ]);
    expect(await svc.upcomingAbsences(reva.personId, NOW)).toEqual([{ week: W40, number: 40, start: W40, end: "2026-10-04", substitute: null }]);
    await svc.removeAbsence(reva, "reva", W40, NOW);
    expect((await svc.getWeekView(W40, NOW)).reports.find((r) => r.author === "reva")?.absent).toBeUndefined();
    expect(await prisma.auditLog.count({ where: { action: "weekly.absence.remove" } })).toBe(1);
  });

  it("правила: не в прошлое, не дальше 12 недель, замещающий не сам человек, за коллегу только управление", async () => {
    const reva = await actor.reva();
    await expectRule(svc.setAbsence(reva, { slug: "reva", week: W39, substitute: null }, NOW), /Прошедшую неделю/);
    await expectRule(svc.setAbsence(reva, { slug: "reva", week: shiftWeek(W40, 13), substitute: null }, NOW), /не дальше чем на 12 недель/);
    await expectRule(svc.setAbsence(reva, { slug: "reva", week: W40, substitute: "reva" }, NOW), /сам отсутствующий/);
    await expectRule(svc.setAbsence(reva, { slug: "reva", week: W40, substitute: "ceo" }, NOW), /из списка команды/);
    await expectRule(svc.setAbsence(reva, { slug: "loginova", week: W40, substitute: null }, NOW), /только владелец и администраторы/);
    await expectRule(svc.setAbsence(await actor.observer(), { slug: "ceo", week: W40, substitute: null }, NOW), /Наблюдатель/);
    // Владелец в режиме управления отмечает коллегу на больничном
    const saved = await svc.setAbsence(await actor.owner(), { slug: "loginova", week: shiftWeek(W40, 12), substitute: "reva" }, NOW);
    expect(saved.number).toBe(52);
  });

  it("отсутствующий может сдать weekly после срока, опозданием это не считается", async () => {
    const reva = await actor.reva();
    await svc.setAbsence(reva, { slug: "reva", week: W40, substitute: "golovkin" }, NOW);
    await svc.saveHeadline(reva, W40, "Неделя в отпуске, коротко");
    await svc.saveEntry(reva, entry());
    const afterDeadline = new Date("2026-10-05T19:00:00Z");
    const done = await svc.submitWeekly(reva, W40, afterDeadline);
    expect(done.state).toBe("submitted");

    // Без отметки та же сдача после срока: «Сдан с опозданием»
    const loginova = await actor.loginova();
    await svc.saveHeadline(loginova, W40, "Кросс к ипотеке работает");
    await svc.saveEntry(loginova, entry(W40, { what: "Кросс к ипотеке" }));
    expect((await svc.submitWeekly(loginova, W40, afterDeadline)).state).toBe("late");
  });
});
