// Зеркало в Google-таблицу на настоящей базе и имитации Google (раздел 5 ТЗ, критерии приёмки этапа 6):
// правка уходит в таблицу за один проход цикла, ручная правка возвращается сверкой, час недоступности Google
// не теряет изменений, после выгрузки и сверки расхождений ноль.
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as weekly from "@/lib/weekly/service";
import { importBordTasks } from "@/lib/tasks/bord-import";
import { importBordWeekly } from "@/lib/weekly/bord-import";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";
import { journalEvents } from "@/lib/journal";
import { FakeSheets } from "@/lib/sheet/fake";
import type { Cell } from "@/lib/sheet/client";
import { COMMENTS_TAB, ID_HEADER, TASKS_TAB, WEEKLY_TAB, commentRows, taskRows, weeklyRows } from "@/lib/sheet/rows";
import { ARCHIVE_SUFFIX, LAYOUT_VERSION, PROD_SHEET_ID, SUMMARY_MARKER, SheetBusyError, ensureLayout, pushChanges, rebuild, reconcile } from "@/lib/sheet/sync";
import { connection, imitation, reconcileDue, tick, FAKE_SERVICE_EMAIL } from "@/lib/sheet/runner";
import * as sync from "@/lib/sheet/service";

const COPY_ID = "1CopyOfBordForWeeklyTests_abcdefghijk";
const EMAIL = "weekly-sync@test.iam.gserviceaccount.com";
const opts = { serviceEmail: EMAIL };
const owner = () => tasks.actorFor("muradyan", "OWNER");
const due = addDays(moscowToday(), 10);
const col = (header: string) => TASKS_TAB.columns.findIndex((c) => c.header === header);

/** Строки вкладки без шапки, по служебному ID */
function rowsOf(fake: FakeSheets, title: string): Map<string, Cell[]> {
  const grid = fake.tab(title).grid;
  const idAt = grid[0]!.indexOf(ID_HEADER);
  const out = new Map<string, Cell[]>();
  for (const row of grid.slice(1)) if (row[idAt] !== undefined && row[idAt] !== "") out.set(String(row[idAt]), row);
  return out;
}
const dataRows = (fake: FakeSheets, title: string) => fake.tab(title).grid.slice(1).filter((r) => r.some((v) => v !== "" && v !== undefined));
const outboxSize = () => prisma.sheetOutbox.count();
let auditStart = BigInt(0);
const fresh = (where: object) => ({ ...where, id: { gt: auditStart } });

beforeEach(async () => {
  delete process.env.SHEET_FAKE;
  await prisma.task.deleteMany();
  await prisma.weeklyEntry.deleteMany();
  await prisma.weeklyReport.deleteMany();
  await prisma.week.deleteMany();
  // Журнал только дописывается: смотрим записи после этой отметки
  auditStart = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
  await prisma.person.update({ where: { slug: "reva" }, data: { fullName: "Рева Тарас" } }).catch(() => undefined);
  await prisma.setting.deleteMany({ where: { key: { in: ["sheet.layout", "sheet.synced", "sheet.lock"] } } });
  await prisma.setting.upsert({ where: { key: "sheet.spreadsheetId" }, update: { value: COPY_ID }, create: { key: "sheet.spreadsheetId", value: COPY_ID } });
  await importBordTasks(prisma, readFileSync("data/bord/zadachi-2026-10-05.csv", "utf8"), { batch: "bord-2026-10-05" });
  await importBordWeekly(prisma, readFileSync("data/bord/weekly-ceo-2026-10-05.csv", "utf8"), { batch: "bord-2026-10-05" });
  await prisma.sheetOutbox.deleteMany();
  await prisma.sheetRun.deleteMany();
});
afterEach(() => {
  delete process.env.SHEET_FAKE;
});
afterAll(() => prisma.$disconnect());

describe("очередь заполняют триггеры базы", () => {
  it("задача, комментарий, перенос, соисполнители и запись weekly попадают в очередь в той же транзакции", async () => {
    const a = await owner();
    const t = (await tasks.createTask(a, { title: "Проверить выгрузку", outcome: "Строка в таблице", owner: "reva", direction: "osago", due })).task;
    await tasks.addComment(a, t.number, "Первый комментарий");
    await tasks.transferDue(a, t.number, addDays(due, 7), "Ждём партнёра");
    await tasks.setCoExecutors(a, t.number, ["golovkin"]);
    const rows = await prisma.sheetOutbox.findMany({ orderBy: { id: "asc" } });
    expect(rows.filter((r) => r.kind === "task").every((r) => r.key === String(t.number))).toBe(true);
    expect(rows.filter((r) => r.kind === "comment")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "task").length).toBeGreaterThanOrEqual(4);

    await prisma.sheetOutbox.deleteMany();
    const reva = await tasks.actorFor("reva");
    const rk = await weekly.currentReportingKey();
    const e = await weekly.saveEntry(reva, { week: rk, direction: "kasko", block: "product", type: "event", what: "Запуск нового партнёра" });
    expect(await prisma.sheetOutbox.findMany({ where: { kind: "entry" } })).toHaveLength(1);

    // Задача из записи: у записи в таблице появляется номер задачи
    await prisma.sheetOutbox.deleteMany();
    await tasks.createTask(a, { title: "Из weekly", outcome: "Сделано", owner: "reva", direction: "kasko", due, weeklyEntryId: e.id });
    expect((await prisma.sheetOutbox.findMany({ where: { kind: "entry" } })).map((r) => r.key)).toEqual([e.id]);

    // Новое название задачи меняет строки её комментариев
    await prisma.sheetOutbox.deleteMany();
    await tasks.editTask(a, t.number, { title: "Проверить выгрузку в таблицу" });
    expect(await prisma.sheetOutbox.count({ where: { kind: "comment" } })).toBe(1);
  });

  it("новое имя человека и новое название в справочнике ставят в очередь полную выгрузку", async () => {
    // Правим базу напрямую: журнал настроек проверяют свои тесты, здесь важен только триггер
    await prisma.person.update({ where: { slug: "reva" }, data: { fullName: "Рева Тарас Иванович" } });
    expect(await prisma.sheetOutbox.count({ where: { kind: "all" } })).toBe(1);
    await prisma.person.update({ where: { slug: "reva" }, data: { zone: "Продукт и CJM по всем линиям" } });
    expect(await prisma.sheetOutbox.count({ where: { kind: "all" } })).toBe(1);
    await prisma.sheetOutbox.deleteMany();
    await prisma.dictionaryItem.update({ where: { kind_code: { kind: "DIRECTION", code: "osago" } }, data: { label: "ОСАГО и e-ОСАГО" } });
    expect(await prisma.sheetOutbox.count({ where: { kind: "all" } })).toBe(1);
    await prisma.dictionaryItem.update({ where: { kind_code: { kind: "DIRECTION", code: "osago" } }, data: { label: "ОСАГО" } });
  });
});

describe("первая выгрузка", () => {
  it("заводит вкладки, пишет все строки, прячет ID, защищает вкладки, после неё сверка не находит расхождений", async () => {
    const fake = new FakeSheets(["Лист1"]);
    const res = await pushChanges(fake, opts);
    expect(res.full).toBe(true);
    expect([...fake.tabs.keys()].sort()).toEqual(["Weekly", "Журнал выгрузки", "Задачи", "Комментарии к задачам", "Лист1", "Сводка"].sort());

    const tasksNow = await taskRows(null);
    expect(fake.tab("Задачи").grid[0]).toEqual(TASKS_TAB.columns.map((c) => c.header));
    expect(dataRows(fake, "Задачи")).toHaveLength(tasksNow.size);
    expect(dataRows(fake, "Weekly")).toHaveLength((await weeklyRows(null)).size);
    expect(rowsOf(fake, "Задачи")).toEqual(tasksNow);

    // Колонка ID скрыта, даты с форматом, правило «просрочено» одно, защита на каждой вкладке ресурса только для служебного аккаунта
    const hidden = fake.requests.filter((r) => JSON.stringify(r).includes("hiddenByUser"));
    expect(hidden).toHaveLength(3);
    expect(fake.tab("Задачи").conditionalFormats).toBe(1);
    // Строки данных обычным шрифтом и сверху ячейки на каждой вкладке, ссылка на задачу не переносится
    const dataFormat = fake.requests.filter((r) => JSON.stringify(r).includes('"verticalAlignment":"TOP"'));
    expect(dataFormat).toHaveLength(5);
    expect(fake.requests.filter((r) => JSON.stringify(r).includes('"wrapStrategy":"CLIP"'))).toHaveLength(1);
    for (const title of ["Задачи", "Комментарии к задачам", "Weekly", "Журнал выгрузки", "Сводка"]) expect(fake.tab(title).protectedRanges).toHaveLength(1);
    expect(fake.requests.filter((r) => r.addProtectedRange).every((r) => JSON.stringify(r).includes(EMAIL))).toBe(true);
    expect(await prisma.setting.findUnique({ where: { key: "sheet.layout" } })).toMatchObject({ value: { spreadsheet: COPY_ID, version: LAYOUT_VERSION } });

    // Формулы без разделителей аргументов: работают и в русской, и в английской таблице
    const summary = fake.tab("Сводка").grid;
    expect(summary[0]).toContain(SUMMARY_MARKER);
    const formulas = summary.slice(1).flatMap((r) => r.slice(1, 5)).map(String);
    expect(formulas.length).toBeGreaterThan(0);
    expect(formulas.every((f) => f.startsWith("=SUMPRODUCT(") && !/[;,]/.test(f))).toBe(true);
    // Имена людей и шапка пишутся как есть, с разбором уходят только формулы
    expect(fake.formulaCells.length).toBe(formulas.length);
    expect(fake.formulaCells.every((c) => String(c).startsWith("=SUMPRODUCT("))).toBe(true);
    const rule = JSON.stringify(fake.requests.find((r) => r.addConditionalFormatRule));
    expect(rule).not.toMatch(/AND\(|;/);

    const check = await reconcile(fake, opts);
    expect(check.details.diffs).toEqual([]);
    expect(check.details.removed).toEqual([]);
    expect(check.details.restored).toEqual([]);
    expect(await outboxSize()).toBe(0);
  });

  it("чужие вкладки с теми же именами уходят в архив целиком, пустая вкладка берётся себе, остальные не трогаем", async () => {
    const old = [["Сводка по лидерам"], [], ["№", "Задача", "Ответственный"], [1, "Старая задача", "Рева"]];
    const fake = new FakeSheets();
    // Чужая вкладка узкая: читать её шапку за пределами сетки Google не дал бы
    fake.addTab("Задачи", old.map((r) => [...r]), { cols: 5 });
    fake.addTab("Цели", [["Цель"], ["Рост"]]);
    fake.addTab("weekly");
    const weeklyId = fake.tab("weekly").sheetId;
    await pushChanges(fake, opts);
    expect(fake.tab(`Задачи${ARCHIVE_SUFFIX}`).grid).toEqual(old);
    expect(fake.tab("Цели").grid).toEqual([["Цель"], ["Рост"]]);
    // Пустая «weekly» взята себе и названа точно: Google не различает регистр в именах вкладок
    expect(fake.tab("Weekly").sheetId).toBe(weeklyId);
    expect(fake.tab("Задачи").grid[0]![0]).toBe("№");
    // Второй запуск не плодит архивов
    await prisma.setting.deleteMany({ where: { key: { in: ["sheet.layout", "sheet.synced", "sheet.lock"] } } });
    await pushChanges(fake, opts);
    expect([...fake.tabs.keys()].filter((t) => t.includes(ARCHIVE_SUFFIX))).toEqual([`Задачи${ARCHIVE_SUFFIX}`]);
  });

  it("смена версии разметки или служебного аккаунта переоформляет вкладки без дублей защиты и правил", async () => {
    const fake = new FakeSheets();
    await pushChanges(fake, opts);
    await prisma.setting.update({ where: { key: "sheet.layout" }, data: { value: { spreadsheet: COPY_ID, version: LAYOUT_VERSION - 1, email: EMAIL } } });
    await ensureLayout(fake, opts);
    expect(fake.tab("Задачи").conditionalFormats).toBe(1);
    for (const title of ["Задачи", "Weekly", "Сводка"]) expect(fake.tab(title).protectedRanges).toHaveLength(1);
    const before = fake.requests.filter((r) => r.addProtectedRange).length;
    await ensureLayout(fake, { serviceEmail: "new-sync@test.iam.gserviceaccount.com" });
    const added = fake.requests.filter((r) => r.addProtectedRange).slice(before);
    expect(added).toHaveLength(5);
    expect(added.every((r) => JSON.stringify(r).includes("new-sync@"))).toBe(true);
    for (const title of ["Задачи", "Weekly", "Сводка"]) expect(fake.tab(title).protectedRanges).toHaveLength(1);
  });

  it("сбой посреди первой полной выгрузки: следующий проход дописывает всё, хотя очередь пуста", async () => {
    const fake = new FakeSheets();
    const append = fake.append.bind(fake);
    let left = 1;
    fake.append = async (sheet, values) => {
      if (sheet === WEEKLY_TAB.title && left-- > 0) throw new Error("Google ответил 429");
      return append(sheet, values);
    };
    await expect(pushChanges(fake, opts)).rejects.toThrow(/429/);
    expect(await outboxSize()).toBe(0);
    const res = await pushChanges(fake, opts);
    expect(res.full).toBe(true);
    expect(rowsOf(fake, WEEKLY_TAB.title)).toEqual(await weeklyRows(null));
    expect((await pushChanges(fake, opts)).items).toBe(0);
    const check = await reconcile(fake, opts);
    expect([check.details.diffs, check.details.removed, check.details.restored]).toEqual([[], [], []]);
  });

  it("отметки пишутся для той таблицы, в которую шла выгрузка, даже если ссылку сменили посередине", async () => {
    const fake = new FakeSheets();
    await prisma.setting.update({ where: { key: "sheet.spreadsheetId" }, data: { value: "1SwitchedMeanwhile_abcdefghijklmnop" } });
    await pushChanges(fake, { ...opts, spreadsheetId: COPY_ID });
    expect(await prisma.setting.findUnique({ where: { key: "sheet.synced" } })).toMatchObject({ value: { spreadsheet: COPY_ID } });
  });
});

describe("выгрузка изменений", () => {
  it("правки задачи, комментарий и weekly уходят одним проходом, трогаются только их строки", async () => {
    const fake = new FakeSheets();
    await pushChanges(fake, opts);
    const a = await owner();
    const [first, second] = [...(await taskRows(null)).keys()].map(Number);
    await tasks.changeStatus(a, first!, "clarify");
    await tasks.updateWhere(a, first!, "Ждём ответа партнёра");
    await tasks.changeState(a, second!, "blocked", "Нет доступа к данным, поможет Головкин");
    await tasks.addComment(a, second!, "Напомнил партнёру");
    const reva = await tasks.actorFor("reva");
    const rk = await weekly.currentReportingKey();
    const e = await weekly.saveEntry(reva, { week: rk, direction: "kasko", block: "product", type: "result", what: "Конверсия выросла", fact: "+12%" });

    const before = fake.calls;
    const res = await pushChanges(fake, opts);
    expect(res.full).toBe(false);
    expect(fake.calls - before).toBeLessThan(20);
    const row1 = rowsOf(fake, "Задачи").get(String(first))!;
    expect(row1[col("Статус")]).toBe("Требует уточнений");
    expect(row1[col("Где сейчас")]).toBe("Ждём ответа партнёра");
    const row2 = rowsOf(fake, "Задачи").get(String(second))!;
    expect([row2[col("Состояние")], row2[col("Чем заблокирована")]]).toEqual(["Заблокирована", "Нет доступа к данным, поможет Головкин"]);
    expect(String(row2[col("Последний комментарий")])).toMatch(/Напомнил партнёру$/);
    expect(String(row2[col("Обновлено")])).toMatch(/^Мурадян Арам, \d\d\.\d\d\.\d{4} \d\d:\d\d$/);
    const comment = [...rowsOf(fake, COMMENTS_TAB.title).values()].find((r) => r[4] === "Напомнил партнёру");
    expect(comment?.[0]).toBe(second);
    expect(rowsOf(fake, WEEKLY_TAB.title).get(e.id)?.[9]).toBe("+12%");
    expect(await outboxSize()).toBe(0);

    // Удалённая запись weekly исчезает из таблицы
    await weekly.deleteEntry(reva, e.id);
    await pushChanges(fake, opts);
    expect(rowsOf(fake, WEEKLY_TAB.title).has(e.id)).toBe(false);
    expect((await reconcile(fake, opts)).details.diffs).toEqual([]);
  });

  it("задача в архиве уходит из вкладки вместе с комментариями и возвращается из архива", async () => {
    const fake = new FakeSheets();
    const a = await owner();
    const n = Number([...(await taskRows(null)).keys()][0]);
    await tasks.addComment(a, n, "Комментарий до архива");
    await pushChanges(fake, opts);
    await tasks.archiveTask(a, n);
    await pushChanges(fake, opts);
    expect(rowsOf(fake, "Задачи").has(String(n))).toBe(false);
    expect([...rowsOf(fake, COMMENTS_TAB.title).values()].some((r) => r[0] === n)).toBe(false);
    await tasks.archiveTask(a, n, false);
    await pushChanges(fake, opts);
    expect(rowsOf(fake, "Задачи").has(String(n))).toBe(true);
    expect([...rowsOf(fake, COMMENTS_TAB.title).values()].some((r) => r[0] === n)).toBe(true);
    const check = await reconcile(fake, opts);
    expect([check.details.diffs, check.details.removed, check.details.restored]).toEqual([[], [], []]);
  });

  it("новое имя человека переписывает все его строки и сводку", async () => {
    const fake = new FakeSheets();
    await pushChanges(fake, opts);
    await prisma.person.update({ where: { slug: "reva" }, data: { fullName: "Рева Тарас Иванович" } });
    const res = await pushChanges(fake, opts);
    expect(res.full).toBe(true);
    const owners = [...rowsOf(fake, "Задачи").values()].map((r) => r[col("Ответственный")]);
    expect(owners).toContain("Рева Тарас Иванович");
    expect(owners).not.toContain("Рева Тарас");
    expect(fake.tab("Сводка").grid.map((r) => r[0])).toContain("Рева Тарас Иванович");
  });

  it("колонка «Команда» после «Ответственного»: у задач до команд «Топ-команда» (этап 14)", async () => {
    const fake = new FakeSheets();
    await pushChanges(fake, opts);
    expect(col("Команда")).toBe(col("Ответственный") + 1);
    const teams = new Set([...rowsOf(fake, "Задачи").values()].map((r) => r[col("Команда")]));
    expect([...teams]).toEqual(["Топ-команда"]);
  });
});

describe("сверка", () => {
  it("возвращает ручные правки, убирает лишние и пустые строки, дописывает пропавшие, чинит шапку и пишет всё в журнал", async () => {
    const fake = new FakeSheets();
    await pushChanges(fake, opts);
    const grid = fake.tab("Задачи").grid;
    const statusAt = col("Статус");
    const victim = String(grid[1]![col(ID_HEADER)]);
    const wasStatus = grid[1]![statusAt];
    const typed = wasStatus === "Выполнена" ? "Отменена" : "Выполнена";
    fake.edit("Задачи", 1, statusAt, typed);
    fake.edit("Задачи", 0, 2, "Название");
    const lost = String(grid[3]![col(ID_HEADER)]);
    grid.splice(3, 1);
    grid.splice(5, 0, ["", "", ""]);
    grid.push([999, "", "Задача, которую дописали руками"]);
    grid.push([...grid[2]!]);

    const res = await reconcile(fake, opts);
    expect(res.details.diffs).toEqual(
      expect.arrayContaining([
        { tab: "Задачи", id: victim, field: "Статус", before: typed, after: String(wasStatus) },
        expect.objectContaining({ tab: "Задачи", id: "шапка", field: "Шапка вкладки" }),
      ]),
    );
    expect(res.details.removed).toHaveLength(2);
    expect(res.details.restored).toEqual([{ tab: "Задачи", id: lost }]);
    expect(rowsOf(fake, "Задачи")).toEqual(await taskRows(null));
    expect(dataRows(fake, "Задачи")).toHaveLength(fake.tab("Задачи").grid.length - 1);

    const audit = await prisma.auditLog.findFirst({ where: fresh({ action: "sync.revert", entityId: `Задачи/${victim}` }) });
    expect([audit?.source, audit?.actorName, audit?.field, audit?.before, audit?.after]).toEqual(["SYSTEM", "Сверка с таблицей", "Задачи: Статус", typed, String(wasStatus)]);
    const page = await journalEvents({ kind: "sync" });
    expect(page.events.some((e) => e.object === `Google-таблица, вкладка «Задачи»: задача ${victim}` && e.by === "system" && e.source === "system")).toBe(true);
    expect(String(fake.tab("Журнал выгрузки").grid.at(-1)![3])).toMatch(/исправлено ячеек/);

    const again = await reconcile(fake, opts);
    expect([again.details.diffs, again.details.removed, again.details.restored]).toEqual([[], [], []]);
    expect(String(fake.tab("Журнал выгрузки").grid.at(-1)![3])).toBe("расхождений нет");
  });
});

describe("недоступность Google", () => {
  it("час без Google: очередь копится, ошибки видны в истории запусков, потом всё уходит без потерь и дублей", async () => {
    const fake = new FakeSheets();
    await pushChanges(fake, opts);
    const a = await owner();
    const reva = await tasks.actorFor("reva");
    const rk = await weekly.currentReportingKey();
    const numbers = [...(await taskRows(null)).keys()].map(Number).slice(0, 6);
    fake.down = true;
    // 120 попыток за час раз в 30 секунд: каждая падает, очередь не теряется
    const created: number[] = [];
    for (let minute = 0; minute < 60; minute += 5) {
      const n = numbers[minute % numbers.length]!;
      await tasks.updateWhere(a, n, `Статус на ${minute} минуте`);
      if (minute % 15 === 0) await tasks.addComment(a, n, `Комментарий на ${minute} минуте`);
      if (minute % 20 === 0) await weekly.saveEntry(reva, { week: rk, direction: "kasko", block: "product", type: "event", what: `Событие ${minute}` });
      if (minute === 30) created.push((await tasks.createTask(a, { title: "Новая во время сбоя", outcome: "Видна в таблице", owner: "reva", direction: "osago", due })).task.number);
      if (minute === 40) await tasks.archiveTask(a, numbers[5]!);
      await expect(pushChanges(fake, opts)).rejects.toThrow(/недоступен/);
    }
    const queued = await outboxSize();
    expect(queued).toBeGreaterThan(20);
    const failed = await prisma.sheetRun.findMany({ where: { kind: "push", ok: false } });
    expect(failed).toHaveLength(12);
    expect(failed[0]!.error).toMatch(/недоступен/);

    fake.down = false;
    const res = await pushChanges(fake, opts);
    expect(res.queued).toBe(queued);
    expect(await outboxSize()).toBe(0);
    expect(rowsOf(fake, "Задачи")).toEqual(await taskRows(null));
    expect(rowsOf(fake, "Задачи").has(String(created[0]))).toBe(true);
    expect(rowsOf(fake, "Задачи").has(String(numbers[5]))).toBe(false);
    expect(rowsOf(fake, COMMENTS_TAB.title)).toEqual(await commentRows(null));
    expect(rowsOf(fake, WEEKLY_TAB.title)).toEqual(await weeklyRows(null));
    const check = await reconcile(fake, opts);
    expect([check.details.diffs, check.details.removed, check.details.restored]).toEqual([[], [], []]);
  });

  it("сбой посреди выгрузки: повтор доводит до конца без дублей строк", async () => {
    const fake = new FakeSheets();
    await pushChanges(fake, opts);
    const a = await owner();
    await tasks.createTask(a, { title: "Первая новая", outcome: "Есть", owner: "reva", direction: "osago", due });
    const n = Number([...(await taskRows(null)).keys()][0]);
    await tasks.addComment(a, n, "Комментарий в сбойной выгрузке");
    // Строки задач записались, а на комментариях Google упал
    const append = fake.append.bind(fake);
    let left = 1;
    fake.append = async (sheet, values) => {
      if (sheet === COMMENTS_TAB.title && left-- > 0) throw new Error("Google ответил 503");
      return append(sheet, values);
    };
    await expect(pushChanges(fake, opts)).rejects.toThrow(/503/);
    expect(await outboxSize()).toBeGreaterThan(0);
    await pushChanges(fake, opts);
    expect(await outboxSize()).toBe(0);
    expect(dataRows(fake, "Задачи")).toHaveLength((await taskRows(null)).size);
    expect(dataRows(fake, COMMENTS_TAB.title)).toHaveLength((await commentRows(null)).size);
    const check = await reconcile(fake, opts);
    expect([check.details.diffs, check.details.removed, check.details.restored]).toEqual([[], [], []]);
  });
});

describe("пересборка", () => {
  it("переписывает вкладки целиком по порядку, убирает хвост, чистит очередь и пишет в журнал", async () => {
    const fake = new FakeSheets();
    await pushChanges(fake, opts);
    const grid = fake.tab("Задачи").grid;
    grid.reverse();
    grid.push(["лишнее"], [], ["ещё лишнее"]);
    const a = await owner();
    await tasks.updateWhere(a, Number([...(await taskRows(null)).keys()][0]), "Перед пересборкой");
    const res = await rebuild(fake, { ...opts, actor: { id: a.personId, name: a.fullName } });
    const want = await taskRows(null);
    expect(fake.tab("Задачи").grid).toEqual([TASKS_TAB.columns.map((c) => c.header), ...want.values()]);
    expect(res.items).toBeGreaterThan(want.size);
    expect(await outboxSize()).toBe(0);
    expect(await prisma.auditLog.count({ where: fresh({ action: "sync.rebuild", actorId: a.personId }) })).toBe(1);

    // Когда задач не осталось совсем, строки только очищаются: Google не даёт удалить все строки под шапкой
    await prisma.task.deleteMany();
    await rebuild(fake, opts);
    expect(dataRows(fake, "Задачи")).toEqual([]);
    expect(fake.tab("Задачи").grid[0]).toEqual(TASKS_TAB.columns.map((c) => c.header));
  });
});

describe("подключение таблицы и права", () => {
  it("рабочую таблицу подключить нельзя ни ссылкой, ни через базу", async () => {
    process.env.SHEET_FAKE = "1";
    expect(() => sync.parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${PROD_SHEET_ID}/edit#gid=1`)).toThrow(/Ресурс в него не пишет/);
    await expect(sync.setSpreadsheet(await owner(), PROD_SHEET_ID)).rejects.toThrow(/Ресурс в него не пишет/);
    await prisma.setting.update({ where: { key: "sheet.spreadsheetId" }, data: { value: PROD_SHEET_ID } });
    expect(await connection()).toBeNull();
  });

  it("ссылку на копию меняет только владелец, смена в журнале, доступ проверяется сразу", async () => {
    process.env.SHEET_FAKE = "1";
    await expect(sync.setSpreadsheet(await tasks.actorFor("golovkin", "ADMIN"), COPY_ID)).rejects.toThrow(/только владелец/);
    await expect(sync.setSpreadsheet(await tasks.actorFor("muradyan"), COPY_ID)).rejects.toThrow(/только владелец/);
    expect(() => sync.parseSpreadsheetId("просто текст")).toThrow(/Не похоже/);
    const other = "1AnotherCopyOfBord_0123456789abcdef";
    const res = await sync.setSpreadsheet(await owner(), `https://docs.google.com/spreadsheets/d/${other}/edit?gid=0#gid=0`);
    expect(res).toEqual({ id: other, access: "ok" });
    const log = await prisma.auditLog.findFirst({ where: { action: "sync.settings" }, orderBy: { id: "desc" } });
    expect([log?.before, log?.after]).toEqual([COPY_ID, other]);
    expect((await connection())?.serviceEmail).toBe(FAKE_SERVICE_EMAIL);
    // Отключить: пустая ссылка
    expect((await sync.setSpreadsheet(await owner(), "")).id).toBeNull();
    expect(await connection()).toBeNull();
    await expect(sync.pushNow(await owner())).rejects.toThrow(/укажите ссылку/);
  });

  it("без ключа служебного аккаунта таблица не подключается", async () => {
    const saved = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    expect(await connection()).toBeNull();
    expect((await sync.setSpreadsheet(await owner(), COPY_ID)).access).toBe("no-key");
    await expect(sync.pushNow(await owner())).rejects.toThrow(/Ключ служебного аккаунта/);
    if (saved !== undefined) process.env.GOOGLE_SERVICE_ACCOUNT_JSON = saved;
  });
});

describe("фоновый цикл", () => {
  it("проход цикла выгружает очередь, сверка раз в сутки после 03:30 по Москве", async () => {
    process.env.SHEET_FAKE = "1";
    const fake = imitation();
    fake.tabs.clear();
    const night = new Date("2026-10-06T00:00:00Z"); // 03:00 по Москве
    expect(await reconcileDue(night)).toBe(false);
    await tick(night);
    expect(dataRows(fake, "Задачи")).toHaveLength((await taskRows(null)).size);
    expect(await prisma.sheetRun.count({ where: { kind: "reconcile" } })).toBe(0);

    const after = new Date("2026-10-06T00:31:00Z"); // 03:31
    expect(await reconcileDue(after)).toBe(true);
    await tick(after);
    expect(await prisma.sheetRun.count({ where: { kind: "reconcile", ok: true } })).toBe(1);
    expect(await reconcileDue(new Date("2026-10-06T12:00:00Z"))).toBe(false);
    expect(await reconcileDue(new Date("2026-10-07T00:40:00Z"))).toBe(true);
  });
});

describe("защита от ложных срабатываний и гонок", () => {
  it("сверка сначала выгружает очередь: правка ресурса, которая ещё не ушла, не попадает в журнал как ручная", async () => {
    const fake = new FakeSheets();
    await pushChanges(fake, opts);
    const n = Number([...(await taskRows(null)).keys()][0]);
    await tasks.updateWhere(await owner(), n, "Свежая правка до сверки");
    const res = await reconcile(fake, opts);
    expect([res.details.diffs, res.details.removed, res.details.restored]).toEqual([[], [], []]);
    expect(rowsOf(fake, "Задачи").get(String(n))?.[col("Где сейчас")]).toBe("Свежая правка до сверки");
    expect(await prisma.auditLog.count({ where: fresh({ action: "sync.revert" }) })).toBe(0);
  });

  it("пока запись держит другой процесс сервера, второй не пишет; просроченная аренда не мешает", async () => {
    const fake = new FakeSheets();
    await prisma.$executeRaw`INSERT INTO "settings" ("key", "value", "updatedAt") VALUES ('sheet.lock', jsonb_build_object('owner', 'other-container', 'until', now() + interval '5 minutes'), now())`;
    await expect(pushChanges(fake, opts)).rejects.toBeInstanceOf(SheetBusyError);
    expect(fake.calls).toBe(0);
    await prisma.$executeRaw`UPDATE "settings" SET "value" = jsonb_build_object('owner', 'other-container', 'until', now() - interval '1 minute') WHERE "key" = 'sheet.lock'`;
    expect((await pushChanges(fake, opts)).full).toBe(true);
    // После выгрузки аренда отпущена
    const lock = await prisma.setting.findUnique({ where: { key: "sheet.lock" } });
    expect((lock?.value as { owner: string }).owner).toBe("");
  });

  it("сетка без запаса строк: удаление всех строк под шапкой и пересборка не упираются в пределы Google", async () => {
    const fake = new FakeSheets();
    await pushChanges(fake, opts);
    // Кто-то удалил пустые строки внизу: сетка кончается на последней строке данных
    const t = fake.tab("Задачи");
    t.rows = t.grid.length;
    await prisma.task.updateMany({ data: { archivedAt: new Date() } });
    await pushChanges(fake, opts);
    expect(dataRows(fake, "Задачи")).toEqual([]);
    await prisma.task.updateMany({ data: { archivedAt: null } });
    const w = fake.tab("Weekly");
    w.rows = 3;
    w.grid.splice(3);
    await rebuild(fake, opts);
    expect(rowsOf(fake, "Задачи")).toEqual(await taskRows(null));
    expect(rowsOf(fake, WEEKLY_TAB.title)).toEqual(await weeklyRows(null));
  });

  it("новый человек или выключение меняют только «Сводку», без полной выгрузки", async () => {
    const fake = new FakeSheets();
    await pushChanges(fake, opts);
    await prisma.person.update({ where: { slug: "fatyanov" }, data: { active: false } });
    expect(await prisma.sheetOutbox.count({ where: { kind: "summary" } })).toBe(1);
    const res = await pushChanges(fake, opts);
    expect(res.full).toBe(false);
    const fatyanov = await prisma.person.findUniqueOrThrow({ where: { slug: "fatyanov" } });
    expect(fake.tab("Сводка").grid.map((r) => r[0])).not.toContain(fatyanov.fullName);
    await prisma.person.update({ where: { slug: "fatyanov" }, data: { active: true } });
  });

  it("после неудачной сверки следующая попытка не раньше чем через 15 минут", async () => {
    const now = new Date("2026-10-06T07:00:00Z");
    await prisma.sheetRun.create({ data: { kind: "reconcile", ok: false, startedAt: new Date(now.getTime() - 5 * 60_000), finishedAt: now, error: "Google ответил 429" } });
    expect(await reconcileDue(now)).toBe(false);
    expect(await reconcileDue(new Date(now.getTime() + 11 * 60_000))).toBe(true);
  });
});
