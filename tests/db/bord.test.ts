// Забор задач из рабочего Bord на настоящей базе и имитации Google (решение Арама 06.10.2026: Bord главный, ресурс его только читает).
// Повторный забор тех же данных ничего не меняет; изменения Bord переносятся по полям; правка ресурса живёт, пока поле не поменяют в Bord;
// новые люди добавляются; задачи ресурса уходят на номера от 1001; битая строка не мешает остальным; поменявшийся формат ничего не трогает.
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import { importBordTasks, parseCsv } from "@/lib/tasks/bord-import";
import { isoFromDbDate, moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";
import { FakeSheets } from "@/lib/sheet/fake";
import type { Cell } from "@/lib/sheet/client";
import { PROD_SHEET_ID } from "@/lib/sheet/client";
import { BORD_ZONE, PULL_BATCH, RESOURCE_FIRST_NUMBER, pullBord, pullState, runPull } from "@/lib/bord/pull";
import * as bord from "@/lib/bord/service";
import { PULL_RETRY_MS, connection, imitationBord, pullDue, tick } from "@/lib/sheet/runner";
import * as sync from "@/lib/sheet/service";
import { taskRows, TASKS_TAB } from "@/lib/sheet/rows";

const FIXTURE = "data/bord/zadachi-2026-10-05.csv";
const owner = () => tasks.actorFor("muradyan", "OWNER");
let auditStart = BigInt(0);
const fresh = (where: object) => ({ ...where, id: { gt: auditStart } });

/** Имитация рабочего Bord: вкладка «Задачи» из выгрузки 05.10 */
function fakeBord(): FakeSheets {
  const fake = new FakeSheets();
  fake.addTab("Задачи", parseCsv(readFileSync(FIXTURE, "utf8")) as Cell[][], { rows: 400, cols: 10 });
  return fake;
}
const rowOf = (fake: FakeSheets, number: number) => fake.tab("Задачи").grid.find((r) => String(r[0]) === String(number))!;
const set = (fake: FakeSheets, number: number, col: number, value: Cell) => {
  rowOf(fake, number)[col] = value;
};
const task = (number: number) => prisma.task.findUniqueOrThrow({ where: { number }, include: { owner: true, coExecutors: { include: { person: true } }, transfers: true } });

beforeEach(async () => {
  delete process.env.SHEET_FAKE;
  await prisma.task.deleteMany();
  await prisma.person.deleteMany({ where: { zone: BORD_ZONE } });
  await prisma.setting.deleteMany({ where: { key: { startsWith: "bord." } } });
  await prisma.setting.upsert({ where: { key: "tasks.nextNumber" }, update: { value: 52 }, create: { key: "tasks.nextNumber", value: 52 } });
  await prisma.setting.deleteMany({ where: { key: "sheet.spreadsheetId" } });
  await importBordTasks(prisma, readFileSync(FIXTURE, "utf8"), { batch: "bord-2026-10-05" });
  auditStart = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
});
afterEach(() => {
  delete process.env.SHEET_FAKE;
});
// Другие файлы тестов идут на той же базе в любом порядке: забор не должен оставаться включённым после этого файла
afterAll(async () => {
  await prisma.task.deleteMany({ where: { OR: [{ owner: { zone: BORD_ZONE } }, { coExecutors: { some: { person: { zone: BORD_ZONE } } } }] } });
  await prisma.person.deleteMany({ where: { zone: BORD_ZONE } });
  await prisma.setting.deleteMany({ where: { key: { startsWith: "bord." } } });
  await prisma.setting.upsert({ where: { key: "tasks.nextNumber" }, update: { value: 52 }, create: { key: "tasks.nextNumber", value: 52 } });
  await prisma.$disconnect();
});

describe("забор задач из Bord", () => {
  it("тот же Bord, что уже загружен, ничего не меняет и в журнал не пишет", async () => {
    const report = await pullBord(fakeBord());
    expect(report).toMatchObject({ rows: 51, created: [], updated: [], fields: 0, renumbered: [], newPeople: [], problems: [], missing: [] });
    expect(await prisma.auditLog.count({ where: fresh({ entity: "task" }) })).toBe(0);
    // Повтор тоже ничего не меняет
    expect(await pullBord(fakeBord())).toMatchObject({ created: [], updated: [] });
  });

  it("изменения Bord переносятся по полям, новая задача и новый человек появляются, пропавшая задача остаётся", async () => {
    const fake = fakeBord();
    await pullBord(fake);
    set(fake, 5, 3, "Поделиться ссылкой на дашборд трафика");
    set(fake, 5, 5, "20.10.2026");
    set(fake, 5, 7, "06.10: ссылку отправили, ждём обратную связь");
    set(fake, 2, 6, "Выполнена");
    set(fake, 6, 2, "Логинова Светлана, Рева Тарас");
    const grid = fake.tab("Задачи").grid;
    grid.splice(grid.indexOf(rowOf(fake, 51)), 1);
    grid.push(["52", "06.10.2026", "Терехов Валерий", "Метрики устойчивости продуктов", "Согласовать метрики с CTO", "30.10.2026", "В работе", "", "В сроке"]);

    const report = (await pullBord(fake, { now: new Date("2026-10-06T15:00:00Z") }))!;
    expect(report.created).toEqual([52]);
    expect(report.updated.sort((a, b) => a - b)).toEqual([2, 5, 6]);
    expect(report.fields).toBe(5);
    expect(report.overwritten).toBe(0);
    expect(report.newPeople).toEqual(["Терехов Валерий"]);
    expect(report.missing).toEqual([51]);

    const t5 = await task(5);
    expect(t5.title).toBe("Поделиться ссылкой на дашборд трафика");
    expect(isoFromDbDate(t5.due)).toBe("2026-10-20");
    expect(t5.whereNow).toBe("06.10: ссылку отправили, ждём обратную связь");
    expect(isoFromDbDate(t5.whereUpdatedAt)).toBe("2026-10-06");
    // Срок из Bord: перенос с причиной, исходный срок не меняется
    expect(t5.transfers.map((x) => [x.fromDue && isoFromDbDate(x.fromDue), isoFromDbDate(x.toDue), x.reason])).toEqual([["2026-09-23", "2026-10-20", "Срок изменён в Bord"]]);
    expect(isoFromDbDate(t5.originalDue!)).toBe("2026-09-23");

    const t2 = await task(2);
    expect(t2.status).toBe("DONE");
    expect(t2.closedAt).not.toBeNull();
    expect(t2.resolution).toBe("Закрыта в Bord");

    const t6 = await task(6);
    expect(t6.owner?.fullName).toBe("Логинова Светлана");
    expect(t6.coExecutors.map((c) => c.person.fullName)).toEqual(["Рева Тарас"]);

    const t52 = await task(52);
    expect(t52).toMatchObject({ title: "Метрики устойчивости продуктов", importBatch: PULL_BATCH, status: "IN_PROGRESS" });
    expect(t52.owner).toMatchObject({ fullName: "Терехов Валерий", role: "LEADER", active: true, zone: BORD_ZONE });
    expect(await prisma.task.findUnique({ where: { number: 51 } })).not.toBeNull();

    const log = await prisma.auditLog.findMany({ where: fresh({ source: "SHEET", actorName: "Bord" }), orderBy: { id: "asc" } });
    expect(log.filter((l) => l.action === "task.bord").map((l) => [l.entityId, l.field])).toEqual(
      expect.arrayContaining([
        ["5", "Задача"],
        ["5", "Срок"],
        ["5", "Где сейчас"],
        ["2", "Статус"],
        ["6", "Ответственный"],
      ]),
    );
    expect(log.find((l) => l.action === "task.bord" && l.field === "Статус")).toMatchObject({ before: "В работе", after: "Выполнена" });
    expect(log.find((l) => l.action === "task.import")).toMatchObject({ entityId: "52" });
    expect(log.find((l) => l.action === "settings.person.create")).toMatchObject({ field: "Человек добавлен из Bord" });
  });

  it("номер, отданный в Bord новой задаче, не переписывает прежнюю: она уходит на номер ресурса, под номером новая задача", async () => {
    const fake = fakeBord();
    await tasks.addComment(await tasks.actorFor("muradyan", "OWNER"), 47, "Комментарий к прежней задаче");
    // Так в рабочем Bord 06.10: под номером 47 поставили другую задачу на встрече 06.10
    const row = rowOf(fake, 47);
    row[1] = "06.10.2026";
    row[2] = "Все лидеры";
    row[3] = "Новая задача под старым номером";
    row[6] = "Поставлена";
    const report = (await pullBord(fake))!;
    expect(report.reused).toEqual([{ number: 47, to: RESOURCE_FIRST_NUMBER }]);
    expect(report.created).toEqual([47]);
    expect(report.missing).toEqual([RESOURCE_FIRST_NUMBER]);
    expect(report.problems).toEqual([]);
    const fresh47 = await task(47);
    expect(fresh47).toMatchObject({ title: "Новая задача под старым номером", ownerAll: true, status: "IN_PROGRESS" });
    expect(fresh47.transfers).toHaveLength(0);
    const old = await prisma.task.findUniqueOrThrow({ where: { number: RESOURCE_FIRST_NUMBER }, include: { comments: true } });
    expect(old.title).not.toBe("Новая задача под старым номером");
    expect(old.comments.map((c) => c.text)).toEqual(["Комментарий к прежней задаче"]);
    // Повтор: новая задача уже на месте, ничего не меняется
    expect(await pullBord(fake)).toMatchObject({ reused: [], created: [], updated: [] });
  });

  it("правка в ресурсе живёт, пока это поле не поменяют в Bord; потом побеждает Bord", async () => {
    const fake = fakeBord();
    await pullBord(fake);
    await prisma.task.update({ where: { number: 3 }, data: { title: "Бюджет 2027: финал", whereNow: "Правка в ресурсе" } });
    expect(await pullBord(fake)).toMatchObject({ updated: [] });
    expect((await task(3)).title).toBe("Бюджет 2027: финал");

    set(fake, 3, 3, "Финальная версия бюджета 2027 и 2028");
    const report = (await pullBord(fake))!;
    expect(report).toMatchObject({ updated: [3], fields: 1, overwritten: 1 });
    const t3 = await task(3);
    expect(t3.title).toBe("Финальная версия бюджета 2027 и 2028");
    // Поле, которое в Bord не менялось, осталось с правкой ресурса
    expect(t3.whereNow).toBe("Правка в ресурсе");
  });

  it("задачи ресурса уходят на номера от 1001, следующая новая задача получает номер после них", async () => {
    const created = await tasks.createTask(await owner(), { title: "Задача из ресурса", outcome: "Готово", owner: "reva", direction: "product", due: addDays(moscowToday(), 7) });
    expect(created.task.number).toBe(52);
    const fake = fakeBord();
    fake.tab("Задачи").grid.push(["52", "06.10.2026", "Рева Тарас", "Задача из Bord под номером 52", "Сделать", "30.10.2026", "В работе", "", ""]);

    const report = (await pullBord(fake))!;
    expect(report.renumbered).toEqual([{ from: 52, to: RESOURCE_FIRST_NUMBER }]);
    expect(report.created).toEqual([52]);
    expect((await task(RESOURCE_FIRST_NUMBER)).title).toBe("Задача из ресурса");
    expect((await task(52)).title).toBe("Задача из Bord под номером 52");
    expect(await prisma.auditLog.findFirst({ where: fresh({ action: "task.renumber" }) })).toMatchObject({ entityId: String(RESOURCE_FIRST_NUMBER), before: "52", after: String(RESOURCE_FIRST_NUMBER) });

    const next = await tasks.createTask(await owner(), { title: "Ещё одна", outcome: "Готово", owner: "reva", direction: "product", due: addDays(moscowToday(), 7) });
    expect(next.task.number).toBe(RESOURCE_FIRST_NUMBER + 1);
    // Событие «Мне» о задаче ресурса переехало на её новый номер (Рева получил задачу от владельца)
    const events = await prisma.inboxEvent.findMany({ where: { task: { title: "Задача из ресурса" } } });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.subject === `task:${RESOURCE_FIRST_NUMBER}`)).toBe(true);
  });

  it("битая строка не мешает остальным и видна, пока её не поправят; «Евгений» не становится новым человеком", async () => {
    const fake = fakeBord();
    const grid = fake.tab("Задачи").grid;
    grid.push(["52", "06.10.2026", "Евгений", "Чей это Евгений", "Понять", "30.10.2026", "В работе", "", ""]);
    grid.push(["53", "06.10.2026", "Рева Тарас", "Без срока", "Сделать", "когда-нибудь", "В работе", "", ""]);
    grid.push(["54", "06.10.2026", "Рева Тарас", "Странный статус", "Сделать", "30.10.2026", "Почти готово", "", ""]);
    const first = (await pullBord(fake))!;
    expect(first.created.sort()).toEqual([52, 54]);
    expect(first.problems).toEqual([
      "задача 52: «Евгений» не сопоставить однозначно с человеком ресурса, ответственный не изменён. Напишите в Bord фамилию и имя полностью",
      "задача 53: срок не указан или не в формате ДД.ММ.ГГГГ, не перенесена",
      "задача 54: статус «Почти готово» не из справочника, перенесена со статусом «В работе»",
    ]);
    expect(first.newPeople).toEqual([]);
    expect((await task(52)).ownerId).toBeNull();

    const again = (await pullBord(fake))!;
    expect(again.problems).toHaveLength(3);

    rowOf(fake, 52)[2] = "Фатьянов Евгений";
    rowOf(fake, 53)[5] = "31.10.2026";
    rowOf(fake, 54)[6] = "В работе";
    const fixed = (await pullBord(fake))!;
    expect(fixed.problems).toEqual([]);
    expect(fixed.created).toEqual([53]);
    expect((await task(52)).owner?.fullName).toBe("Фатьянов Евгений");
  });

  it("проблема в одном поле не откатывает правки ресурса в других полях", async () => {
    const fake = fakeBord();
    fake.tab("Задачи").grid.push(["52", "06.10.2026", "Евгений", "Чей это Евгений", "Понять", "30.10.2026", "Почти готово", "", ""]);
    await pullBord(fake);
    await prisma.task.update({ where: { number: 52 }, data: { whereNow: "Обновили в ресурсе", due: new Date("2026-11-15T00:00:00Z") } });
    rowOf(fake, 5)[6] = "Почти готово";
    await prisma.task.update({ where: { number: 5 }, data: { whereNow: "Свежий статус из ресурса" } });
    const report = (await pullBord(fake))!;
    expect(report.problems).toHaveLength(3);
    expect(report.updated).toEqual([]);
    const t52 = await task(52);
    expect(t52.whereNow).toBe("Обновили в ресурсе");
    expect(isoFromDbDate(t52.due)).toBe("2026-11-15");
    expect(t52.transfers).toHaveLength(0);
    expect((await task(5)).whereNow).toBe("Свежий статус из ресурса");
  });

  it("номер от 1001 в Bord не трогает задачу ресурса, повтор номера не трогает задачу и не делает её пропавшей", async () => {
    await tasks.createTask(await owner(), { title: "Своя задача", outcome: "Готово", owner: "reva", direction: "product", due: addDays(moscowToday(), 7) });
    const fake = fakeBord();
    await pullBord(fake);
    const ownNumber = (await prisma.task.findFirstOrThrow({ where: { title: "Своя задача" } })).number;
    expect(ownNumber).toBe(RESOURCE_FIRST_NUMBER);
    const grid = fake.tab("Задачи").grid;
    grid.push([String(ownNumber), "06.10.2026", "Рева Тарас", "Опечатка в номере", "Сделать", "30.10.2026", "Выполнена", "", ""]);
    grid.push(["7", "06.10.2026", "Рева Тарас", "Копия строки 7", "Сделать", "30.10.2026", "Выполнена", "", ""]);
    const before7 = await task(7);
    const report = (await pullBord(fake))!;
    expect(report.problems).toEqual([
      expect.stringMatching(/^номер 7 повторяется в строках/),
      expect.stringMatching(new RegExp(`номер ${ownNumber} из номеров задач ресурса`)),
    ]);
    expect(report.missing).toEqual([]);
    expect(report.updated).toEqual([]);
    expect((await task(ownNumber)).title).toBe("Своя задача");
    expect((await task(7)).title).toBe(before7.title);
  });

  it("прошлые значения другого Bord не в счёт: первый забор нового Bord берёт из него всё", async () => {
    const fake = fakeBord();
    await pullBord(fake, { sourceId: "bord-a" });
    await prisma.task.update({ where: { number: 3 }, data: { title: "Правка в ресурсе" } });
    expect(await pullBord(fake, { sourceId: "bord-a" })).toMatchObject({ updated: [] });
    expect(await pullBord(fake, { sourceId: "bord-b" })).toMatchObject({ updated: [3] });
  });

  it("поменявшийся формат вкладки и недоступный Google ничего не меняют, ошибка видна, повтор через 15 минут", async () => {
    const fake = fakeBord();
    fake.tab("Задачи").grid[0]![2] = "Исполнитель";
    const now = new Date("2026-10-06T15:00:00Z");
    const result = await runPull(fake, "auto", { now });
    expect(result?.error).toMatch(/Колонка 3 во вкладке «Задачи» называется «Исполнитель»/);
    const state = await pullState();
    expect(state).toMatchObject({ ok: false, lastOkAt: null, history: [{ ok: false, how: "auto" }] });
    expect(await prisma.auditLog.count({ where: fresh({ source: "SHEET" }) })).toBe(0);

    await prisma.setting.create({ data: { key: "bord.sourceId", value: PROD_SHEET_ID } });
    expect(await pullDue(new Date(now.getTime() + 5 * 60_000))).toBe(false);
    expect(await pullDue(new Date(now.getTime() + PULL_RETRY_MS))).toBe(true);

    const down = fakeBord();
    down.down = true;
    expect((await runPull(down, "manual", { now }))?.error).toMatch(/Google/);
  });

  it("второй процесс не забирает одновременно с первым", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('bord.pull'))`;
      expect(await pullBord(fakeBord())).toBeNull();
    });
  });

  it("в таблице для просмотра у задач из Bord пометка в колонке «Источник»", async () => {
    await tasks.createTask(await owner(), { title: "Из ресурса", outcome: "Готово", owner: "reva", direction: "product", due: addDays(moscowToday(), 7) });
    const rows = await taskRows(null);
    const col = TASKS_TAB.columns.findIndex((c) => c.header === "Источник");
    expect(rows.get("1")![col]).toBe("Встреча (Bord)");
    expect(rows.get("52")![col]).not.toMatch(/Bord/);
  });
});

describe("подключение Bord владельцем", () => {
  it("подключает и выключает только владелец, рабочий Bord можно, таблицу для просмотра нельзя, смена в журнале", async () => {
    process.env.SHEET_FAKE = "1";
    await expect(bord.setBordSource(await tasks.actorFor("golovkin", "ADMIN"), PROD_SHEET_ID)).rejects.toThrow(/только владелец/);
    await prisma.setting.create({ data: { key: "sheet.spreadsheetId", value: "1ViewSheetForWeeklyTests_abcdefghij" } });
    await expect(bord.setBordSource(await owner(), "https://docs.google.com/spreadsheets/d/1ViewSheetForWeeklyTests_abcdefghij/edit")).rejects.toThrow(/таблица для просмотра/);
    expect(() => bord.parseBordSource("не ссылка")).toThrow(/Не похоже/);

    const res = await bord.setBordSource(await owner(), `https://docs.google.com/spreadsheets/d/${PROD_SHEET_ID}/edit#gid=1`);
    expect(res).toEqual({ id: PROD_SHEET_ID, access: "ok" });
    expect(await prisma.auditLog.findFirst({ where: fresh({ action: "sync.bord" }) })).toMatchObject({ before: "забор выключен", after: PROD_SHEET_ID });

    // «Забрать сейчас» в имитации читает выгрузку 05.10: в ресурсе те же задачи
    const report = await bord.pullBordNow(await owner());
    expect(report).toMatchObject({ rows: 51, created: [], updated: [] });
    expect((await bord.bordStatus()).state).toMatchObject({ ok: true, history: [{ how: "manual", ok: true }] });

    // Другой Bord: прошлые значения полей сбрасываются
    await bord.setBordSource(await owner(), "1OtherBordCopyForTests_0123456789ab");
    expect(await prisma.setting.findUnique({ where: { key: "bord.snapshot" } })).toBeNull();
    // Зеркало не пишет в таблицу, из которой забираем задачи
    await expect(sync.setSpreadsheet(await owner(), "1OtherBordCopyForTests_0123456789ab")).rejects.toThrow(/забирает задачи и в неё не пишет/);
    await prisma.setting.update({ where: { key: "sheet.spreadsheetId" }, data: { value: "1OtherBordCopyForTests_0123456789ab" } });
    expect(await connection()).toBeNull();
    await bord.setBordSource(await owner(), "");
    expect((await bord.bordStatus()).connected).toBe(false);
    await expect(bord.pullBordNow(await owner())).rejects.toThrow(/Сначала вставьте ссылку на Bord/);
  });

  it("фоновый цикл забирает по расписанию, даже если таблица для просмотра не подключена", async () => {
    process.env.SHEET_FAKE = "1";
    imitationBord();
    await prisma.setting.create({ data: { key: "bord.sourceId", value: PROD_SHEET_ID } });
    await prisma.task.delete({ where: { number: 51 } });
    await tick(new Date());
    expect(await prisma.task.findUnique({ where: { number: 51 } })).toMatchObject({ importBatch: PULL_BATCH });
    expect((await pullState()).history).toHaveLength(1);
    // Через минуту рано: следующий забор через 5 минут
    await tick(new Date(Date.now() + 60_000));
    expect((await pullState()).history).toHaveLength(1);
  });
});
