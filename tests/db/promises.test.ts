// Этап 22а: обещания недели (модуль М6). Итоги планов прошлой недели, перенос невыполненного в план, статус
// «Выполнена частично», сводка для отчёта CEO, возврат weekly в черновик, несколько ссылок в записи.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as svc from "@/lib/weekly/service";
import * as promises from "@/lib/weekly/promise-service";
import * as req from "@/lib/requests/service";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";
import { shiftWeek, weekKeyOf } from "@/lib/weekly/weeks";
import { promiseShare } from "@/lib/weekly/promises";
import type { WeekKey } from "@/domain/types";

const actor = {
  reva: () => tasks.actorFor("reva"),
  loginova: () => tasks.actorFor("loginova"),
  owner: () => tasks.actorFor("muradyan", "OWNER"),
};
const id = async (slug: string) => (await prisma.person.findUniqueOrThrow({ where: { slug } })).id;
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

let key: WeekKey;
let prev: WeekKey;

async function plan(what: string, patch: Partial<svc.EntryInput> = {}) {
  return svc.saveEntry(await actor.reva(), { week: prev, direction: "osago", block: "product", type: "plan", what, ...patch });
}

beforeAll(async () => {
  key = await svc.currentReportingKey();
  prev = shiftWeek(key, -1);
});

beforeEach(async () => {
  await prisma.helpRequest.deleteMany();
  await prisma.task.deleteMany();
  await prisma.promiseReview.deleteMany();
  await prisma.weeklyEntry.deleteMany();
  await prisma.weeklyReport.deleteMany();
  await prisma.week.deleteMany();
  await prisma.inboxEvent.deleteMany();
});
afterAll(async () => {
  await prisma.task.deleteMany();
  await prisma.$disconnect();
});

describe("статус «Выполнена частично»", () => {
  it("закрывает задачу только с тем, что сделано и что нет, задача считается закрытой", async () => {
    const t = (await tasks.createTask(await actor.owner(), { title: "Новый тариф", outcome: "Тариф в продаже", owner: "reva", direction: "kasko", due: addDays(moscowToday(), 5) })).task;
    await expectRule(tasks.changeStatus(await actor.reva(), t.number, "partial"), /что сделано и что нет/);
    const closed = await tasks.changeStatus(await actor.reva(), t.number, "partial", "Тариф запущен в двух регионах из пяти");
    expect(closed.task).toMatchObject({ status: "partial", resolution: "Тариф запущен в двух регионах из пяти" });
    expect(closed.task.closedAt).toBeTruthy();
    await expectRule(tasks.transferDue(await actor.reva(), t.number, addDays(moscowToday(), 9), "Не успели"), /Срок переносит|Закрытой задаче/);
    // База не даёт закрыть частично без текста
    await expect(prisma.$executeRaw`UPDATE tasks SET status = 'PARTIAL', resolution = NULL WHERE number = ${t.number}`).rejects.toThrow(/tasks_closed_note/);
  });

  it("просьба, из которой сделана задача, выполнена частично", async () => {
    const r = await req.createRequest(await actor.loginova(), { to: "reva", text: "Выгрузка по убыткам", due: addDays(moscowToday(), 4) });
    await req.acceptRequest(await actor.reva(), r.number, addDays(moscowToday(), 4));
    const made = await req.requestToTask(await actor.reva(), r.number, "kasko");
    await tasks.changeStatus(await actor.reva(), made.task, "partial", "Выгрузка за два квартала из четырёх");
    const after = await req.getRequest(await actor.loginova(), r.number);
    expect(after?.status).toBe("done");
    expect(after?.answer).toContain("выполнена частично: Выгрузка за два квартала из четырёх");
  });
});

describe("шаг «Что обещал на прошлой неделе»", () => {
  it("обещания: планы и «что делаем дальше» прошлой недели, без записей с задачей и чужих", async () => {
    await plan("Запустить новый скоринг");
    await svc.saveEntry(await actor.reva(), { week: prev, direction: "osago", block: "product", type: "event", what: "Запустили AB-тест", next: "Разобрать итоги теста" });
    await svc.saveEntry(await actor.reva(), { week: prev, direction: "osago", block: "product", type: "event", what: "Без продолжения" });
    const withTask = await plan("План, по которому уже есть задача", { next: "Сделать задачу" });
    await tasks.createTask(await actor.reva(), { title: "Задача из плана", outcome: "Сделано", owner: "reva", direction: "osago", due: addDays(moscowToday(), 3), weeklyEntryId: withTask.id });
    await svc.saveEntry(await actor.loginova(), { week: prev, direction: "kasko", block: "product", type: "plan", what: "Чужой план" });
    const list = await promises.entryPromises(await id("reva"), key);
    expect(list.map((p) => [p.kind, p.what])).toEqual([
      ["plan", "Запустить новый скоринг"],
      ["next", "Разобрать итоги теста"],
    ]);
    expect(list[1]!.from).toBe("Запустили AB-тест");
  });

  it("итог: «Сделано» без фразы, остальное с фразой, правка в журнале, повтор без изменений отклоняется", async () => {
    const e = await plan("Запустить новый скоринг");
    const reva = await actor.reva();
    await expectRule(promises.reviewPromise(reva, e.id, "not-done"), /что помешало/);
    await expectRule(promises.reviewPromise(reva, e.id, "dropped", "  "), /почему сняли/);
    await expectRule(promises.reviewPromise(reva, e.id, "maybe"), /Выберите итог/);
    const done = await promises.reviewPromise(reva, e.id, "done");
    expect(done.review).toEqual({ result: "done" });
    await expectRule(promises.reviewPromise(reva, e.id, "done"), /не изменился/);
    const partial = await promises.reviewPromise(reva, e.id, "partial", "Запустили на ОСАГО, на КАСКО — нет");
    expect(partial.review).toEqual({ result: "partial", note: "Запустили на ОСАГО, на КАСКО - нет" });
    const log = await prisma.auditLog.findMany({ where: { action: "weekly.promise", entityId: e.id }, orderBy: { at: "asc" } });
    expect(log.map((l) => [l.before, l.after])).toEqual([
      [null, "Сделано"],
      ["Сделано", "Частично. Запустили на ОСАГО, на КАСКО - нет"],
    ]);
    const row = await prisma.promiseReview.findUniqueOrThrow({ where: { entryId: e.id }, include: { week: true } });
    expect(row.week.start.toISOString().slice(0, 10)).toBe(key);
  });

  it("чужой план итожит только управление, план этой недели итожат на следующей", async () => {
    const e = await plan("Запустить новый скоринг");
    await expectRule(promises.reviewPromise(await actor.loginova(), e.id, "done"), /Чужой weekly/);
    await promises.reviewPromise(await actor.owner(), e.id, "done");
    const now = await svc.saveEntry(await actor.reva(), { week: key, direction: "osago", block: "product", type: "plan", what: "План на следующую неделю" });
    await expectRule(promises.reviewPromise(await actor.reva(), now.id, "done"), /следующей недели/);
    const event = await svc.saveEntry(await actor.reva(), { week: prev, direction: "osago", block: "product", type: "event", what: "Событие" });
    await expectRule(promises.reviewPromise(await actor.reva(), event.id, "done"), /нет плана/);
  });

  it("прошлая неделя закрыта: итог всё равно ставится, закрыта эта неделя: нет", async () => {
    const e = await plan("Запустить новый скоринг");
    await svc.setWeekClosed(await actor.owner(), prev, true);
    await promises.reviewPromise(await actor.reva(), e.id, "done");
    await svc.setWeekClosed(await actor.owner(), key, true);
    await expectRule(promises.reviewPromise(await actor.reva(), e.id, "dropped", "Не нужно"), /закрыта/);
  });

  it("невыполненное переносится в план этой недели один раз; перенесённое не становится «сделано»", async () => {
    const e = await plan("Договориться с Ингосстрахом о новой комиссии. Подробности в письме");
    const reva = await actor.reva();
    await expectRule(promises.carryPromise(reva, e.id), /Сначала поставьте итог/);
    await promises.reviewPromise(reva, e.id, "done");
    await expectRule(promises.carryPromise(reva, e.id), /только то, что сделано частично или не сделано/);
    await promises.reviewPromise(reva, e.id, "not-done", "Партнёр перенёс встречу");
    const carried = await promises.carryPromise(reva, e.id);
    expect(carried.entry).toMatchObject({ week: key, author: "reva", type: "plan", direction: "osago", block: "product", what: "Договориться с Ингосстрахом о новой комиссии." });
    expect(carried.entry.details).toBe("Подробности в письме");
    expect(carried.promise.review?.carried).toEqual({ id: carried.entry.id, what: carried.entry.what });
    await expectRule(promises.carryPromise(reva, e.id), /Уже в плане/);
    await expectRule(promises.reviewPromise(reva, e.id, "done"), /уже перенесено/);
    // Перенесённый план появился черновиком weekly этой недели
    const mine = await svc.getMyWeekly(await id("reva"), key);
    expect(mine.report.state).toBe("draft");
    expect(mine.entries.map((x) => x.id)).toContain(carried.entry.id);
    // Удалили перенесённый план: перенести можно снова, отмена удаления возвращает связь
    const snap = await svc.deleteEntry(reva, carried.entry.id);
    expect((await promises.entryPromises(await id("reva"), key))[0]!.review?.carried).toBeUndefined();
    await svc.restoreEntry(reva, snap);
    expect((await promises.entryPromises(await id("reva"), key))[0]!.review?.carried?.id).toBe(carried.entry.id);
  });

  it("одновременный перенос создаёт один план", async () => {
    const e = await plan("Запустить новый скоринг");
    const reva = await actor.reva();
    await promises.reviewPromise(reva, e.id, "partial", "Половина готова");
    const results = await Promise.allSettled([promises.carryPromise(reva, e.id), promises.carryPromise(reva, e.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.weeklyEntry.count({ where: { week: { start: new Date(`${key}T00:00:00Z`) } } })).toBe(1);
  });

  it("удаление записи-обещания и отмена: итог возвращается к записи", async () => {
    const e = await plan("Запустить новый скоринг");
    await promises.reviewPromise(await actor.reva(), e.id, "done");
    const snap = await svc.deleteEntry(await actor.reva(), e.id);
    expect(await prisma.promiseReview.count({ where: { entryId: null } })).toBe(1);
    await svc.restoreEntry(await actor.reva(), snap);
    expect((await promises.entryPromises(await id("reva"), key))[0]!.review).toEqual({ result: "done" });
  });
});

describe("сводка обещаний для отчёта CEO", () => {
  it("планы с итогами и задачи со сроком на неделе: сделано, частично, перенесено, без итога", async () => {
    // Неделя задач: та, где сегодня. Итоги планов пишем прямо в базу: на этой неделе их могут ещё не ставить
    const W = weekKeyOf(moscowToday());
    const end = addDays(W, 6);
    const owner = await actor.owner();
    const reva = await actor.reva();
    const mk = async (title: string, due = end) => (await tasks.createTask(owner, { title, outcome: "Результат", owner: "reva", direction: "kasko", due })).task;
    const done = await mk("Сделана");
    const part = await mk("Частично");
    const moved = await mk("Перенесена");
    await mk("Открыта");
    const later = await mk("Срок на следующей неделе", addDays(end, 7));
    await tasks.changeStatus(reva, done.number, "done", "Готово");
    await tasks.changeStatus(reva, part.number, "partial", "Половина");
    await tasks.transferDue(reva, moved.number, addDays(end, 7), "Ждём партнёра");
    expect(later.number).toBeGreaterThan(0);
    const prevWeek = await svc.ensureWeek(prisma, shiftWeek(W, -1));
    const week = await svc.ensureWeek(prisma, W);
    const revaId = await id("reva");
    const dirs = await prisma.dictionaryItem.findMany({ where: { OR: [{ kind: "DIRECTION", code: "osago" }, { kind: "WEEKLY_BLOCK", code: "product" }, { kind: "ENTRY_TYPE", code: "plan" }] } });
    const by = (kind: string) => dirs.find((d) => d.kind === kind)!.id;
    const entry = (what: string) =>
      prisma.weeklyEntry.create({ data: { weekId: prevWeek.id, authorId: revaId, directionId: by("DIRECTION"), blockId: by("WEEKLY_BLOCK"), typeId: by("ENTRY_TYPE"), what } });
    const a = await entry("План А");
    const b = await entry("План Б");
    await entry("План без итога");
    await prisma.promiseReview.create({ data: { weekId: week.id, authorId: revaId, entryId: a.id, what: a.what, result: "DONE" } });
    await prisma.promiseReview.create({ data: { weekId: week.id, authorId: revaId, entryId: b.id, what: b.what, result: "DROPPED", note: "Не актуально" } });
    const sum = await promises.promiseSummaries(W, [revaId, await id("loginova")]);
    expect(sum.people.map((p) => p.slug)).toEqual(["reva"]);
    expect(sum.total).toEqual({ done: 2, partial: 1, notDone: 1, dropped: 1, pending: 2, total: 7 });
    expect(promiseShare(sum.total)).toBe(50);
  });
});

describe("weekly обратно в черновик, несколько ссылок", () => {
  it("сданный weekly возвращается в черновик, пока неделя открыта, с записью в журнале", async () => {
    const reva = await actor.reva();
    await expectRule(promises.reopenWeekly(reva, key), /ещё не сдан/);
    await svc.saveHeadline(reva, key, "Главное за неделю");
    await svc.saveEntry(reva, { week: key, direction: "osago", block: "product", type: "event", what: "Запустили AB-тест" });
    await svc.submitWeekly(reva, key);
    await promises.reopenWeekly(reva, key);
    const mine = await svc.getMyWeekly(await id("reva"), key);
    expect(mine.report.state).toBe("draft");
    expect(mine.report.submittedAt).toBeUndefined();
    expect(await prisma.auditLog.count({ where: { action: "weekly.reopen" } })).toBe(1);
    await svc.submitWeekly(reva, key);
    await svc.setWeekClosed(await actor.owner(), key, true);
    await expectRule(promises.reopenWeekly(reva, key), /закрыта/);
  });

  it("в записи несколько ссылок, без названия ссылку подписывает адрес сайта", async () => {
    const saved = await svc.saveEntry(await actor.reva(), {
      week: key,
      direction: "osago",
      block: "product",
      type: "event",
      what: "Запустили AB-тест",
      links: [
        { title: "Дашборд", url: "https://datalens.example.ru/abc" },
        { title: "", url: "https://wiki.example.ru/page" },
        { title: "Отчёт", url: "https://docs.example.ru/report" },
      ],
    });
    expect(saved.links).toEqual([
      { title: "Дашборд", url: "https://datalens.example.ru/abc" },
      { title: "wiki.example.ru", url: "https://wiki.example.ru/page" },
      { title: "Отчёт", url: "https://docs.example.ru/report" },
    ]);
  });
});
