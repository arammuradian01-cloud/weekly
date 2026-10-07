// Этап 22б (модуль М6, вторая часть): черновик weekly из фактов недели, благодарности, снимок недели при закрытии,
// личная статистика «обещал и сделал».
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as svc from "@/lib/weekly/service";
import * as facts from "@/lib/weekly/facts-service";
import * as promises from "@/lib/weekly/promise-service";
import * as req from "@/lib/requests/service";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";
import { shiftWeek, weekKeyOf } from "@/lib/weekly/weeks";
import { moscowDateTime } from "@/lib/week";
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
/** Полдень дня по Москве: так правка точно внутри недели, в какой бы день ни шли тесты */
const noon = (iso: string) => moscowDateTime({ year: +iso.slice(0, 4), month: +iso.slice(5, 7), day: +iso.slice(8, 10) }, 12);

let key: WeekKey;

beforeAll(async () => {
  key = await svc.currentReportingKey();
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

describe("черновик weekly из фактов недели", () => {
  async function setup() {
    const owner = await actor.owner();
    const reva = await actor.reva();
    const mk = async (title: string) => (await tasks.createTask(owner, { title, outcome: "Результат", owner: "reva", direction: "kasko", due: addDays(moscowToday(), 10) })).task;
    const closed = await mk("Тариф для такси");
    const moved = await mk("Выгрузка по партнёрам");
    const blocked = await mk("Интеграция с СК");
    const other = await mk("Ждём эту задачу");
    await tasks.changeStatus(reva, closed.number, "done", "Тариф в продаже");
    await tasks.transferDue(reva, moved.number, addDays(moscowToday(), 20), "Партнёр перенёс встречу");
    await tasks.changeState(reva, blocked.number, "blocked", null, { waitTask: other.number });
    // Закрытие и перенос внутри отчётной недели
    await prisma.task.updateMany({ where: { number: closed.number }, data: { closedAt: noon(addDays(key, 2)) } });
    await prisma.taskTransfer.updateMany({ where: { task: { number: moved.number } }, data: { at: noon(addDays(key, 2)) } });
    const r = await req.createRequest(await actor.loginova(), { to: "reva", text: "Выгрузка по убыткам", due: addDays(moscowToday(), 4) });
    await req.completeRequest(reva, r.number, "Отправил в почту");
    await prisma.helpRequest.updateMany({ where: { number: r.number }, data: { closedAt: noon(addDays(key, 3)) } });
    return { closed, moved, blocked, request: r };
  }

  it("закрытое, перенесённое, заблокированное и выполненная просьба предлагаются строками", async () => {
    const { closed, moved, blocked, request } = await setup();
    const list = await facts.weekFacts(await id("reva"), key);
    expect(list.map((f) => [f.kind, f.taskNumber ?? null])).toEqual([
      ["closed", closed.number],
      ["moved", moved.number],
      ["blocked", blocked.number],
      ["request", null],
    ]);
    expect(list.find((f) => f.kind === "request")?.what).toBe("Выполнили просьбу коллеги: Выгрузка по убыткам");
    expect(list.find((f) => f.kind === "request")?.key).toBe(`request:${request.number}`);
    expect(await facts.weekFacts(await id("loginova"), key)).toEqual([]);
  });

  it("факт становится записью один раз; скрытый не предлагается; удалённая запись возвращает факт, отмена удаления нет", async () => {
    const { closed } = await setup();
    const reva = await actor.reva();
    const entry = await facts.addFact(reva, key, `closed:${closed.number}`);
    expect(entry).toMatchObject({ week: key, author: "reva", type: "result", block: "key-changes", direction: "kasko", what: "Тариф для такси", details: "Тариф в продаже" });
    await expectRule(facts.addFact(reva, key, `closed:${closed.number}`), /уже в weekly/);
    await expectRule(facts.addFact(reva, key, "closed:99999"), /не актуален/);
    await expectRule(facts.addFact(reva, key, "<script>"), /Такого факта нет/);
    let keys = (await facts.weekFacts(await id("reva"), key)).map((f) => f.key);
    expect(keys).not.toContain(`closed:${closed.number}`);
    const blockedKey = keys.find((k) => k.startsWith("blocked:"))!;
    await facts.hideFact(reva, key, blockedKey);
    await facts.hideFact(reva, key, blockedKey);
    keys = (await facts.weekFacts(await id("reva"), key)).map((f) => f.key);
    expect(keys).not.toContain(blockedKey);
    const snap = await svc.deleteEntry(reva, entry.id);
    expect((await facts.weekFacts(await id("reva"), key)).map((f) => f.key)).toContain(`closed:${closed.number}`);
    await svc.restoreEntry(reva, snap);
    expect((await facts.weekFacts(await id("reva"), key)).map((f) => f.key)).not.toContain(`closed:${closed.number}`);
  });

  it("одновременное «Добавить» создаёт одну запись, метку факта с экрана подделать нельзя", async () => {
    const { closed } = await setup();
    const reva = await actor.reva();
    const results = await Promise.allSettled([facts.addFact(reva, key, `closed:${closed.number}`), facts.addFact(reva, key, `closed:${closed.number}`)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.weeklyEntry.count({ where: { factKey: `closed:${closed.number}` } })).toBe(1);
  });
});

describe("благодарности", () => {
  it("строка в weekly, событие упомянутому один раз, видна в ленте", async () => {
    const reva = await actor.reva();
    await svc.saveThanks(reva, key, "Спасибо @Логинова Светлана за выгрузку по убыткам");
    await svc.saveThanks(reva, key, "Спасибо @Логинова Светлана за выгрузку по убыткам и разбор");
    const events = await prisma.inboxEvent.findMany({ where: { kind: "THANKS", recipientId: await id("loginova") } });
    expect(events).toHaveLength(1);
    expect(events[0]!.text).toMatch(/^Спасибо в weekly за неделю \d+: «Спасибо @Логинова Светлана за выгрузку по убыткам»$/);
    const view = await svc.getWeekView(key);
    expect(view.reports.find((r) => r.author === "reva")?.thanks).toBe("Спасибо @Логинова Светлана за выгрузку по убыткам и разбор");
    await expectRule(svc.saveThanks(reva, key, "x".repeat(301)), /не длиннее 300/);
    await svc.saveThanks(reva, key, "");
    expect((await svc.getWeekView(key)).reports.find((r) => r.author === "reva")?.thanks).toBeUndefined();
  });
});

describe("снимок недели", () => {
  it("закрытая неделя показывает итоги на момент закрытия, правка задачи после закрытия их не меняет, открытие снимок убирает", async () => {
    const W = weekKeyOf(moscowToday());
    const owner = await actor.owner();
    const t = (await tasks.createTask(owner, { title: "Срок на неделе", outcome: "Результат", owner: "reva", direction: "kasko", due: addDays(W, 6) })).task;
    const ids = [await id("reva")];
    await svc.ensureWeek(prisma, W);
    await svc.setWeekClosed(owner, W, true);
    await promises.takeWeekSnapshot(W);
    const closed = await promises.weekPromises(W, ids);
    expect(closed.snapshotAt).toBeTruthy();
    expect(closed.total).toMatchObject({ pending: 1, done: 0, total: 1 });
    await tasks.changeStatus(await actor.reva(), t.number, "done", "Готово");
    expect((await promises.weekPromises(W, ids)).total).toMatchObject({ pending: 1, done: 0 });
    await svc.setWeekClosed(owner, W, false);
    await promises.dropWeekSnapshot(W);
    const open = await promises.weekPromises(W, ids);
    expect(open.snapshotAt).toBeUndefined();
    expect(open.total).toMatchObject({ done: 1, pending: 0 });
  });

  it("закрытая неделя без снимка снимается при первом чтении, в снимке весь департамент", async () => {
    const W = weekKeyOf(moscowToday());
    const owner = await actor.owner();
    await tasks.createTask(owner, { title: "Задача Логиновой", outcome: "Результат", owner: "loginova", direction: "kasko", due: addDays(W, 6) });
    await svc.ensureWeek(prisma, W);
    await svc.setWeekClosed(owner, W, true);
    // Первым читает один человек: снимок всё равно по всем, отчёт CEO потом видит и Логинову
    await promises.weekPromises(W, [await id("reva")]);
    const all = await promises.weekPromises(W, [await id("reva"), await id("loginova")]);
    expect(all.people.map((p) => p.slug)).toEqual(["loginova"]);
  });
});

describe("личная статистика «обещал и сделал»", () => {
  it("включается после 6 недель с обещаниями, считает 8 недель", async () => {
    const revaId = await id("reva");
    const dirs = await prisma.dictionaryItem.findMany({ where: { OR: [{ kind: "DIRECTION", code: "osago" }, { kind: "WEEKLY_BLOCK", code: "product" }, { kind: "ENTRY_TYPE", code: "plan" }] } });
    const by = (kind: string) => dirs.find((d) => d.kind === kind)!.id;
    const weekWithPlan = async (k: WeekKey, result: "DONE" | "NOT_DONE") => {
      const prev = await svc.ensureWeek(prisma, shiftWeek(k, -1));
      const week = await svc.ensureWeek(prisma, k);
      const e = await prisma.weeklyEntry.create({ data: { weekId: prev.id, authorId: revaId, directionId: by("DIRECTION"), blockId: by("WEEKLY_BLOCK"), typeId: by("ENTRY_TYPE"), what: `План ${k}` } });
      await prisma.promiseReview.create({ data: { weekId: week.id, authorId: revaId, entryId: e.id, what: e.what, result, note: result === "DONE" ? null : "Не успели" } });
    };
    for (let i = 0; i < 5; i++) await weekWithPlan(shiftWeek(key, -i), i === 0 ? "NOT_DONE" : "DONE");
    let [h] = await promises.promiseHistory([revaId], key);
    expect(h).toMatchObject({ slug: "reva", active: 5, enabled: false });
    expect(h!.weeks).toHaveLength(8);
    await weekWithPlan(shiftWeek(key, -5), "DONE");
    [h] = await promises.promiseHistory([revaId], key);
    expect(h).toMatchObject({ active: 6, enabled: true });
    expect(h!.total).toMatchObject({ done: 5, notDone: 1, total: 6 });
  });
});
