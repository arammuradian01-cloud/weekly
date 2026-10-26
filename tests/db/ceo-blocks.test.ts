// Этап 66: weekly для CEO по смысловым блокам на настоящей базе. Автосборка из базы (цифры недели с ростом и падением,
// прогноз месяца из LRF с планом продаж, прошлый месяц из LRF и честное «нет данных» за прошлый год, новости рынка и
// конкурентов за неделю, отмеченные записи weekly по продуктам, задачи, цели), редактор (сохранение блоков, прежние
// разделы из блоков, конфликт двух устройств, журнал), отправка CEO в новой структуре (снимок, событие в «Мне»), CEO
// видит блоки, старые отчёты как раньше.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as weekly from "@/lib/weekly/service";
import * as report from "@/lib/ceo/report";
import { assembleCeoBlocks, blocksMeta } from "@/lib/weekly-blocks/sources";
import { saveCompetitors } from "@/lib/weekly-blocks/service";
import { COMPETITORS_KEY } from "@/lib/weekly-blocks/competitors";
import { planMonthOfWeek } from "@/lib/plan/brief";
import { addMonths } from "@/lib/forecast/codes";
import { quarterOf } from "@/lib/goals/parse";
import { listInbox } from "@/lib/inbox/service";
import { addDays } from "@/domain/dates";
import { dbDate } from "@/lib/tasks/dates";
import { shiftWeek } from "@/lib/weekly/weeks";
import { NUMBERS_HIDDEN_TEXT, type ReportBlock } from "@/lib/weekly-blocks/types";
import { NUMBERS_ACCESS_KEY } from "@/lib/plan/access";
import type { WeekKey } from "@/domain/types";

const actor = {
  owner: async (): Promise<tasks.Actor> => ({ ...(await tasks.actorFor("muradyan", "OWNER")), via: "PASSWORD" }),
  admin: async (): Promise<tasks.Actor> => ({ ...(await tasks.actorFor("golovkin", "ADMIN")), via: "PASSWORD" }),
  reva: async (): Promise<tasks.Actor> => ({ ...(await tasks.actorFor("reva")), via: "PASSWORD" }),
  ceo: async (): Promise<tasks.Actor> => ({ ...(await tasks.actorFor("ceo")), via: "PASSWORD" }),
  teamOwner: async (): Promise<tasks.Actor> => ({ ...(await tasks.actorFor("muradyan", "OWNER")), via: "TEAM" }),
};
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

let key: WeekKey;
const byKey = (blocks: ReportBlock[], k: string) => blocks.find((b) => b.key === k)!;
const dict = (kind: "DIRECTION" | "WEEKLY_BLOCK" | "ENTRY_TYPE", code: string) => prisma.dictionaryItem.findFirstOrThrow({ where: { kind, code } });
const personId = async (slug: string) => (await prisma.person.findUniqueOrThrow({ where: { slug } })).id;

async function clean() {
  await prisma.ceoReport.deleteMany();
  await prisma.inboxEvent.deleteMany();
  await prisma.newsItem.deleteMany();
  await prisma.newsSource.deleteMany({ where: { url: { startsWith: "https://test66." } } });
  await prisma.task.deleteMany({ where: { number: { gte: 66000, lt: 67000 } } });
  await prisma.goal.deleteMany({ where: { code: { startsWith: "T66" } } });
  await prisma.planLine.deleteMany();
  await prisma.numbersRow.deleteMany({ where: { key: { startsWith: "t66" } } });
  await prisma.setting.deleteMany({ where: { key: { in: ["numbers.metrics", "numbers.sourceId", COMPETITORS_KEY, NUMBERS_ACCESS_KEY] } } });
  await prisma.person.deleteMany({ where: { slug: "t66-reader" } });
  const week = await prisma.week.findUnique({ where: { start: dbDate(key) } });
  if (week) await prisma.weeklyEntry.deleteMany({ where: { weekId: week.id, importBatch: "t66" } });
}

beforeAll(async () => {
  key = await weekly.currentReportingKey();
  await clean();
  await prisma.person.update({ where: { slug: "ceo" }, data: { active: true } });
});
beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.person.update({ where: { slug: "ceo" }, data: { active: false } });
  await prisma.$disconnect();
});

async function seedSources() {
  const month = planMonthOfWeek(key);
  const prev = addMonths(month, -1);
  // Прогноз месяца из LRF: ОСАГО и КАСКО, прошлый месяц только у ОСАГО; прошлого года в LRF нет
  await prisma.planLine.createMany({
    data: [
      { month, version: "LBE", product: "osago", metric: "units", value: 41200 },
      { month, version: "LBE", product: "osago", metric: "revenue", value: 120.5 },
      { month, version: "BUDGET", product: "osago", metric: "units", value: 40000 },
      { month, version: "BUDGET", product: "osago", metric: "revenue", value: 118 },
      { month, version: "LBE", product: "kasko", metric: "units", value: 900 },
      { month, version: "LBE", product: "kasko", metric: "revenue", value: 30 },
      { month, version: "BUDGET", product: "kasko", metric: "units", value: 1000 },
      { month, version: "BUDGET", product: "kasko", metric: "revenue", value: 33 },
      { month: prev, version: "LBE", product: "osago", metric: "units", value: 40000 },
      { month: prev, version: "LBE", product: "osago", metric: "revenue", value: 110 },
    ],
  });
  // Цифры недели: трафик ОСАГО вырос, CR КАСКО упал
  await prisma.setting.createMany({
    data: [
      { key: "numbers.sourceId", value: "test-source" },
      { key: "numbers.metrics", value: [{ key: "t66-traffic", label: "Трафик ОСАГО", unit: "count" }, { key: "t66-cr", label: "CR КАСКО", unit: "pct" }] },
    ],
  });
  await prisma.numbersRow.createMany({
    data: [
      { key: "t66-traffic", article: "TRAFFIC", iface: "TOTAL", product: "OSAGO", mapping: "", comment: "", ord: 1, values: [{ week: key, value: 512000 }, { week: shiftWeek(key, -1), value: 504337 }] },
      { key: "t66-cr", article: "CR", iface: "TOTAL", product: "CASCO", mapping: "", comment: "", ord: 2, values: [{ week: key, value: 0.1 }, { week: shiftWeek(key, -1), value: 0.12 }] },
    ],
  });
  // Новости недели: рынок и конкурент
  const source = await prisma.newsSource.create({ data: { name: "Тестовая лента", url: "https://test66.example/rss" } });
  const at = new Date(`${addDays(key, 2)}T09:00:00+03:00`);
  await prisma.newsItem.createMany({
    data: [
      { sourceId: source.id, guid: "1", urlKey: "test66.example/1", url: "https://test66.example/1", title: "ЦБ изменил тарифный коридор ОСАГО", summary: "", publishedAt: at, directions: ["osago"] },
      { sourceId: source.id, guid: "2", urlKey: "test66.example/2", url: "https://test66.example/2", title: "Пампаду запустил КАСКО по подписке", summary: "", publishedAt: at, directions: ["kasko"] },
      // Неделей раньше: в отчёт не попадает
      { sourceId: source.id, guid: "3", urlKey: "test66.example/3", url: "https://test66.example/3", title: "Старая новость ОСАГО", summary: "", publishedAt: new Date(`${addDays(key, -3)}T09:00:00+03:00`), directions: ["osago"] },
    ],
  });
  // Weekly: отмеченная запись ОСАГО со ссылкой на артефакт и риск КАСКО; неотмеченная не попадает
  const week = await weekly.ensureWeek(prisma, key);
  const [osago, kasko, block, result, risk] = await Promise.all([dict("DIRECTION", "osago"), dict("DIRECTION", "kasko"), dict("WEEKLY_BLOCK", "key-changes"), dict("ENTRY_TYPE", "result"), dict("ENTRY_TYPE", "risk")]);
  const golovkin = await personId("golovkin");
  await prisma.weeklyEntry.createMany({
    data: [
      { weekId: week.id, authorId: golovkin, directionId: osago.id, blockId: block.id, typeId: result.id, what: "Конверсия ОСАГО выросла до 12%", ceo: true, importBatch: "t66", links: [{ title: "Дашборд конверсии", url: "https://docs.example/osago" }], next: "Раскатить на все СК" },
      { weekId: week.id, authorId: golovkin, directionId: kasko.id, blockId: block.id, typeId: risk.id, what: "Интеграция с СК сдвигается", ceo: true, importBatch: "t66" },
      { weekId: week.id, authorId: golovkin, directionId: osago.id, blockId: block.id, typeId: result.id, what: "Неотмеченная запись", ceo: false, importBatch: "t66" },
    ],
  });
  // Задачи команды: выполнена на неделе, под риском, срок на следующей неделе
  const top = { teamId: "top", whereUpdatedAt: dbDate(key), outcome: "Результат" };
  await prisma.task.createMany({
    data: [
      { ...top, number: 66001, title: "Запустить АБ-тест анкеты", directionId: osago.id, due: dbDate(key), status: "DONE", resolution: "Тест запущен", closedAt: new Date(`${addDays(key, 3)}T12:00:00+03:00`), ownerId: golovkin },
      { ...top, number: 66002, title: "Договор с СК по API", directionId: kasko.id, due: dbDate(addDays(key, 30)), state: "BLOCKED", blockedBy: "Ждём юристов СК", ownerId: golovkin },
      { ...top, number: 66003, title: "Отчёт по убыткам", directionId: osago.id, due: dbDate(addDays(key, 8)), priority: "HIGH", ownerId: golovkin },
    ],
  });
  await prisma.goal.create({ data: { quarter: quarterOf(addDays(key, 3)), code: "T66-1", title: "Маржа департамента", teamId: "top", atRisk: true, riskNote: "Отстаём от плана" } });
}

describe("автосборка weekly для CEO из базы", () => {
  it("блоки по порядку, каждая строка с продуктом, цифры с ростом и падением и ссылками, честное «нет данных»", async () => {
    await seedSources();
    const { blocks, hint } = await assembleCeoBlocks(await actor.owner(), key);
    expect(hint).toBeNull();
    expect(blocks.map((b) => b.key)).toEqual(["news", "wow", "month", "competitors", "products", "partners", "risks", "plan"]);
    expect(byKey(blocks, "news").lines).toEqual([{ product: "osago", text: "ЦБ изменил тарифный коридор ОСАГО", href: "https://test66.example/1", source: "Тестовая лента" }]);
    expect(byKey(blocks, "competitors")).toMatchObject({ hidden: false, lines: [{ product: "kasko", text: "Пампаду: Пампаду запустил КАСКО по подписке" }] });
    expect(byKey(blocks, "wow").lines.map((l) => l.text)).toEqual(["Трафик ОСАГО: 512 000, рост на 7 663 (+1,5%) к прошлой неделе", "CR КАСКО: 10%, падение на 2 п.п. к прошлой неделе"]);
    expect(byKey(blocks, "wow").lines[0]).toMatchObject({ product: "osago", href: `/forecast?tab=week&week=${key}`, source: "Цифры недели" });
    const month = byKey(blocks, "month").lines.map((l) => l.text);
    expect(month[0]).toBe("ОСАГО: продажи 41 200 полисов при плане 40 000, план выполняем (+3,0%); выручка 120,5 млн при бюджете 118 млн (+2,1%); продажи к прошлому месяцу +3,0%");
    expect(month[1]).toMatch(/^КАСКО: продажи 900 лидов при плане 1 000, план не выполняем \(-10,0%\)/);
    expect(month).toContain("Итого по продуктам: выручка 150,5 млн при бюджете 151 млн, план не выполняем (-0,3%); выручка к прошлому месяцу +36,8%");
    expect(month.at(-1)).toMatch(/^Продажи и выручка к прошлому году \(.+\): нет данных, в LRF этого месяца нет$/);
    // Строки с цифрами помечены уровнем доступа: при чтении их видят только те, кому открыты цифры
    expect(byKey(blocks, "wow").lines.every((l) => l.figures === "summary")).toBe(true);
    expect(byKey(blocks, "month").lines.every((l) => l.figures === "summary" || l.figures === "full")).toBe(true);
    expect(byKey(blocks, "products").lines.every((l) => !l.figures)).toBe(true);
    expect(byKey(blocks, "month").lines[0]!.href).toBe(`/forecast?month=${planMonthOfWeek(key)}`);
    expect(byKey(blocks, "products").lines).toEqual([
      { product: "osago", text: "Конверсия ОСАГО выросла до 12%", href: "https://docs.example/osago", source: "Дашборд конверсии" },
      { product: "osago", text: "Задача 66001 выполнена: Запустить АБ-тест анкеты", href: "/tasks/66001", source: "Задача 66001" },
    ]);
    expect(byKey(blocks, "risks").lines.map((l) => [l.product, l.text])).toEqual([
      ["kasko", "Интеграция с СК сдвигается"],
      ["kasko", "Задача 66002 заблокирована: Договор с СК по API. Ждём юристов СК"],
      ["department", "Цель T66-1 в риске: Маржа департамента. Отстаём от плана"],
    ]);
    // В базе бывают задачи из выгрузки Bord со сроком на следующей неделе (зависит от даты прогона): сверяем строки этого теста
    const due = `${addDays(key, 8).slice(8, 10)}.${addDays(key, 8).slice(5, 7)}`;
    const plan = byKey(blocks, "plan").lines.map((l) => l.text);
    expect(plan.filter((t) => t === "Раскатить на все СК" || t.startsWith("Отчёт по убыткам"))).toEqual(["Раскатить на все СК", `Отчёт по убыткам, срок ${due}`]);
    expect(byKey(blocks, "partners")).toMatchObject({ lines: [], note: "За неделю ничего нет" });
    for (const b of blocks) for (const l of b.lines) expect(l.product).not.toBeNull();
    // Неотмеченная запись не попала: отметки «В отчёт CEO» есть
    expect(JSON.stringify(blocks)).not.toMatch(/Неотмеченная запись/);
  });

  it("без отметок «В отчёт CEO» берутся все записи weekly команды; без цифр и LRF честно «нет данных»; без доступа к цифрам их нет", async () => {
    await seedSources();
    await prisma.weeklyEntry.updateMany({ where: { importBatch: "t66" }, data: { ceo: false } });
    await prisma.planLine.deleteMany();
    await prisma.setting.deleteMany({ where: { key: { in: ["numbers.metrics", "numbers.sourceId"] } } });
    const { blocks, hint } = await assembleCeoBlocks(await actor.owner(), key);
    expect(hint).toMatch(/Отметок «В отчёт руководителю» за неделю нет/);
    expect(byKey(blocks, "products").lines.map((l) => l.text)).toContain("Неотмеченная запись");
    expect(byKey(blocks, "wow")).toMatchObject({ lines: [], note: "Нет данных: недельный отчёт не подключён" });
    expect(byKey(blocks, "month")).toMatchObject({ lines: [], note: "Нет данных: прогноз месяца ещё не загружен из LRF" });
    // Список конкурентов пустой: блок скрыт
    await saveCompetitors(await actor.owner(), []);
    expect(byKey((await assembleCeoBlocks(await actor.owner(), key)).blocks, "competitors")).toMatchObject({ hidden: true, lines: [] });
  });

  it("список конкурентов меняет только владелец в режиме управления, правка в журнале", async () => {
    await expectRule(saveCompetitors(await actor.admin(), [{ name: "Х" }]), /владелец/);
    const saved = await saveCompetitors(await actor.owner(), [{ name: "Пампаду", keywords: "Пампаду, Pampadu" }]);
    expect(saved).toEqual([{ name: "Пампаду", keywords: ["Пампаду", "Pampadu"] }]);
    expect(await prisma.auditLog.findFirst({ where: { action: "ceo.competitors" }, orderBy: { id: "desc" } })).toMatchObject({ after: "Пампаду: Пампаду, Pampadu" });
  });
});

const BLOCKS: ReportBlock[] = [
  { key: "news", title: "Новости рынка и команды", hidden: false, note: null, lines: [{ product: "osago", text: "ЦБ изменил тарифный коридор", href: "https://cbr.ru/x", source: "Банк России" }] },
  { key: "competitors", title: "Конкуренты", hidden: true, note: null, lines: [] },
  { key: "products", title: "Продукты", hidden: false, note: null, lines: [{ product: "kasko", text: "Пилот такси — в ноябре", href: null, source: null }, { product: "osago", text: "Конверсия 12%", href: "/forecast?month=2026-10", source: "Прогноз" }] },
  { key: "risks", title: "Риски", hidden: false, note: null, lines: [{ product: "osago", text: "Задержка выгрузки", href: null, source: null }] },
  { key: "plan", title: "План на неделю", hidden: false, note: null, lines: [{ product: "kasko", text: "Итоги пилота", href: null, source: null }] },
];

describe("редактор отчёта CEO по блокам", () => {
  it("правят владелец и администраторы в режиме управления; блоки и прежние разделы из них; конфликт двух устройств; журнал", async () => {
    const startId = (await prisma.auditLog.findFirst({ orderBy: { id: "desc" } }))?.id ?? 0n;
    await expectRule(report.saveCeoBlocks(await actor.reva(), key, BLOCKS, [], null), /режиме управления/);
    const saved = await report.saveCeoBlocks(await actor.owner(), key, BLOCKS, [{ title: "Встреча с ВСК", text: "Договорились о планах." }], null);
    expect(saved.blocks!.map((b) => b.key)).toEqual(["news", "competitors", "products", "risks", "plan"]);
    expect(saved.blocks![2]!.lines[0]!.text).toBe("Пилот такси - в ноябре");
    const row = await prisma.ceoReport.findFirstOrThrow();
    expect(row).toMatchObject({
      main: "Новости рынка и команды:\n- ОСАГО. ЦБ изменил тарифный коридор\nПродукты:\n- ОСАГО. Конверсия 12%\n- КАСКО. Пилот такси - в ноябре",
      risks: "- ОСАГО. Задержка выгрузки",
      next: "- КАСКО. Итоги пилота",
    });
    const view = await weekly.getCeoReport(key);
    expect(view.blocks).toEqual(saved.blocks);
    expect(view.meetings).toEqual([{ title: "Встреча с ВСК", text: "Договорились о планах." }]);
    // Второе устройство со старым моментом сохранения: понятная ошибка
    await expectRule(report.saveCeoBlocks(await actor.admin(), key, BLOCKS, undefined, null), /уже сохранён с другого устройства/);
    // Администратор скрывает блок и меняет порядок: в журнале блок и порядок, встречи не тронуты
    const next = [BLOCKS[2]!, BLOCKS[0]!, { ...BLOCKS[3]!, hidden: true }, BLOCKS[4]!, BLOCKS[1]!];
    const again = await report.saveCeoBlocks(await actor.admin(), key, next, undefined, saved.updatedAt!);
    expect(again.meetings).toHaveLength(1);
    expect(again.sections!.risks).toBe("");
    const log = await prisma.auditLog.findMany({ where: { action: "ceo.save", entityId: key, id: { gt: startId } }, orderBy: { id: "asc" } });
    expect(log.map((l) => l.field)).toEqual(expect.arrayContaining(["Отчёт руководителю, блок «Продукты»", "Отчёт руководителю, мои встречи недели", "Отчёт руководителю, блок «Риски»", "Отчёт руководителю, порядок блоков"]));
    expect(log.find((l) => l.field === "Отчёт руководителю, блок «Риски»" && l.actorName === "Головкин Владислав")?.after).toMatch(/^Скрыт\. /);
    // Блок с неизвестным ключом и пустые строки не сохраняются; без блоков сохранить нельзя
    await expectRule(report.saveCeoBlocks(await actor.owner(), key, [{ key: "hack", lines: [] }], undefined, again.updatedAt!), /нет ни одного блока/);
  });

  it("старый отчёт (только разделы) остаётся как был; сохранение блоками переводит его, в журнале «переведён в блоки»; прежнее сохранение снимает блоки", async () => {
    const legacy = await weekly.saveCeoReport(await actor.owner(), key, { main: "- Старое главное", risks: "", next: "" });
    expect(legacy.blocks).toBeNull();
    expect((await weekly.getCeoReport(key)).blocks).toBeNull();
    const converted = await report.saveCeoBlocks(await actor.owner(), key, BLOCKS, undefined, legacy.updatedAt!);
    expect(await prisma.auditLog.findFirst({ where: { action: "ceo.save", field: "Отчёт руководителю, переведён в блоки" }, orderBy: { id: "desc" } })).toMatchObject({ before: "- Старое главное" });
    await weekly.saveCeoReport(await actor.owner(), key, { main: "- Снова по-старому", risks: "", next: "" }, undefined, converted.updatedAt!);
    expect((await weekly.getCeoReport(key)).blocks).toBeNull();
  });
});

describe("отправка CEO из отчёта по блокам", () => {
  it("владелец или администратор в режиме управления при личном входе; пустой не уходит; снимок блоков, событие CEO, CEO видит блоки", async () => {
    await expectRule(report.sendCeoReport(await actor.reva(), key, { blocks: BLOCKS, expected: null }), /режиме управления/);
    await expectRule(report.sendCeoReport(await actor.teamOwner(), key, { blocks: BLOCKS, expected: null }), /при личном входе/);
    await expectRule(report.sendCeoReport(await actor.owner(), key, { blocks: [{ ...BLOCKS[0]!, hidden: true }], expected: null }), /пустой/);
    const sent = await report.sendCeoReport(await actor.owner(), key, { blocks: BLOCKS, meetings: [{ title: "Встреча", text: "Текст." }], expected: null });
    expect(sent.sent).toMatchObject({ by: "Мурадян Арам", to: ["CEO"] });
    const row = await prisma.ceoReport.findFirstOrThrow();
    expect(row.sentAt!.getTime()).toBe(row.updatedAt.getTime());
    const snap = report.snapshotOf(row.sentSnapshot)!;
    // Скрытый блок «Конкуренты» в снимок не ушёл
    expect(snap.blocks!.map((b) => b.key)).toEqual(["news", "products", "risks", "plan"]);
    expect(snap.meetings).toEqual([{ title: "Встреча", text: "Текст." }]);
    expect(snap.next).toBe("- КАСКО. Итоги пилота");
    const ceo = await actor.ceo();
    const inbox = await listInbox(ceo.personId);
    expect(inbox.items.find((i) => i.subject === `ceo-report:${key}`)).toMatchObject({ kind: "MEETING", text: expect.stringMatching(/Мурадян Арам отправил отчёт руководителю за неделю \d+/) });
    expect(await prisma.auditLog.findFirst({ where: { action: "ceo.send" }, orderBy: { id: "desc" } })).toMatchObject({ after: "Отправлен в приложении: CEO" });

    const seen = await report.ceoSentReports(ceo, key);
    expect(seen?.current).toMatchObject({ sentBy: "Мурадян Арам", editedAfter: false });
    expect(seen?.current?.blocks?.find((b) => b.key === "products")?.lines.map((l) => l.text)).toEqual(["Пилот такси - в ноябре", "Конверсия 12%"]);
    expect(seen?.current?.labels.osago).toBe("ОСАГО");
    // Правка после отправки: CEO видит отправленный снимок и честную отметку
    await report.saveCeoBlocks(await actor.owner(), key, [{ ...BLOCKS[0]!, lines: [{ product: "osago", text: "Поправили после отправки", href: null, source: null }] }], undefined, sent.updatedAt!);
    const after = await report.ceoSentReports(ceo, key);
    expect(after?.current?.editedAfter).toBe(true);
    expect(JSON.stringify(after?.current?.blocks)).not.toMatch(/Поправили после отправки/);
  });

  it("старый отправленный отчёт (снимок разделов без блоков) CEO видит как раньше", async () => {
    const week = await weekly.ensureWeek(prisma, key);
    const owner = await personId("muradyan");
    await prisma.ceoReport.create({ data: { weekId: week.id, main: "- Главное по-старому", risks: "- Риск", next: "- Дальше", sentAt: new Date(), sentById: owner, sentTo: [{ id: await personId("ceo"), name: "CEO" }], sentSnapshot: { main: "- Главное по-старому", risks: "- Риск", next: "- Дальше", meetings: [] } } });
    const seen = await report.ceoSentReports(await actor.ceo(), key);
    expect(seen?.current).toMatchObject({ blocks: null, sections: { main: "- Главное по-старому", risks: "- Риск", next: "- Дальше" } });
  });

  it("цифры недели и месяца, которые не правили руками, уходят CEO свежими; поправленные руками уходят как есть", async () => {
    const stale: ReportBlock = { key: "wow", title: "Неделя к неделе", hidden: false, note: null, lines: [{ product: "osago", text: "Старая цифра недели", href: null, source: null }] };
    const mine: ReportBlock = { key: "month", title: "Месяц", hidden: false, note: null, edited: true, lines: [{ product: "osago", text: "Своими словами про месяц", href: null, source: null }] };
    await report.sendCeoReport(await actor.owner(), key, { blocks: [...BLOCKS, stale, mine], expected: null });
    const snap = report.snapshotOf((await prisma.ceoReport.findFirstOrThrow()).sentSnapshot)!;
    // Недельный отчёт не подключён: свежая сборка честно пустая, старая цифра не ушла
    expect(byKey(snap.blocks!, "wow")).toMatchObject({ lines: [], note: "Нет данных: недельный отчёт не подключён" });
    expect(byKey(snap.blocks!, "month")).toMatchObject({ edited: true, lines: [{ text: "Своими словами про месяц", figures: "summary" }] });
  });

  it("получатель без доступа к цифрам видит вместо них строку «Цифры видны только с доступом к цифрам», и в разделах их нет", async () => {
    const reader = await prisma.person.create({ data: { slug: "t66-reader", fullName: "Читалкин Тест", shortName: "Тест", role: "EMPLOYEE", zone: "Тест 66", active: true } });
    const week = await weekly.ensureWeek(prisma, key);
    const blocks: ReportBlock[] = [
      { key: "wow", title: "Неделя к неделе", hidden: false, note: null, lines: [{ product: "osago", text: "Трафик ОСАГО: 512 000", href: `/forecast?tab=week&week=${key}`, source: "Цифры недели", figures: "summary" }] },
      {
        key: "month",
        title: "Месяц",
        hidden: false,
        note: null,
        lines: [
          { product: "osago", text: "ОСАГО: продажи 41 200 полисов", href: "/forecast?month=2026-10", source: "Прогноз, октябрь 2026", figures: "summary" },
          { product: "osago", text: "ОСАГО по СК: факт 25 400", href: "/forecast?month=2026-10", source: "Хаб: ОСАГО по СК", figures: "full" },
        ],
      },
      BLOCKS[2]!,
    ];
    const snapshot = { main: "Неделя к неделе:\n- ОСАГО. Трафик ОСАГО: 512 000", risks: "", next: "", meetings: [], blocks };
    await prisma.ceoReport.create({ data: { weekId: week.id, main: snapshot.main, risks: "", next: "", blocks, sentAt: new Date(), sentById: await personId("muradyan"), sentTo: [{ id: reader.id, name: "Читалкин Тест" }], sentSnapshot: snapshot } });
    const who = { ...(await tasks.actorFor("t66-reader")), via: "PASSWORD" } as tasks.Actor;
    const none = await report.ceoSentReports(who, key);
    expect(none?.current?.ctx.level).toBe("none");
    expect(none?.current?.blocks?.map((b) => b.lines.map((l) => l.text))).toEqual([[NUMBERS_HIDDEN_TEXT], [NUMBERS_HIDDEN_TEXT], ["Пилот такси - в ноябре", NUMBERS_HIDDEN_TEXT]]);
    expect(JSON.stringify(none)).not.toMatch(/512 000|41 200|25 400|Конверсия 12%/);
    // Основные цифры: итог месяца и неделя видны, хаб ОСАГО по СК нет
    await prisma.setting.create({ data: { key: NUMBERS_ACCESS_KEY, value: { full: { units: [], people: [] }, summary: { topManagement: false, units: [], people: ["t66-reader"] } } } });
    const summary = await report.ceoSentReports(who, key);
    expect(summary?.current?.blocks?.find((b) => b.key === "month")?.lines.map((l) => l.text)).toEqual(["ОСАГО: продажи 41 200 полисов"]);
    expect(JSON.stringify(summary)).not.toMatch(/25 400/);
    // Под общим логином отчёт глазами получателя не открывается
    expect(await report.ceoSentReports({ ...who, via: "TEAM" }, key)).toBeNull();
  });

  it("живой блок «Конкуренты»: сохранённый пустым, при отправке появляется с новостью недели", async () => {
    const owner = await actor.owner();
    const { blocks } = await assembleCeoBlocks(owner, key);
    expect(byKey(blocks, "competitors")).toMatchObject({ hidden: true, lines: [] });
    const saved = await report.saveCeoBlocks(owner, key, blocks.map((b) => (b.key === "products" ? { ...b, lines: [{ product: "osago", text: "Строка для отправки", href: null, source: null }] } : b)), undefined, null);
    const source = await prisma.newsSource.create({ data: { name: "Тестовая лента 66", url: "https://test66.live.example/rss" } });
    await prisma.newsItem.create({ data: { sourceId: source.id, guid: "l1", urlKey: "test66.live.example/1", url: "https://test66.live.example/1", title: "Пампаду запустил КАСКО по подписке", summary: "", publishedAt: new Date(`${addDays(key, 1)}T09:00:00+03:00`), directions: ["kasko"] } });
    await report.sendCeoReport(owner, key, { blocks: saved.blocks, expected: saved.updatedAt! });
    const snap = report.snapshotOf((await prisma.ceoReport.findFirstOrThrow()).sentSnapshot)!;
    expect(byKey(snap.blocks!, "competitors")).toMatchObject({ hidden: false, lines: [{ product: "kasko", text: "Пампаду: Пампаду запустил КАСКО по подписке" }] });
  });

  it("новости ленты конкурента не уходят в «Конкуренты» из-за имени самой ленты", async () => {
    const source = await prisma.newsSource.create({ data: { name: "Банки.ру: новости", url: "https://test66.banki.example/rss" } });
    await prisma.newsItem.create({ data: { sourceId: source.id, guid: "b1", urlKey: "test66.banki.example/1", url: "https://test66.banki.example/1", title: "Банки.ру: ставки по вкладам снизились", summary: "", publishedAt: new Date(`${addDays(key, 1)}T09:00:00+03:00`), directions: ["deposits"] } });
    const { blocks } = await assembleCeoBlocks(await actor.owner(), key);
    expect(byKey(blocks, "competitors")).toMatchObject({ hidden: true, lines: [] });
    expect(byKey(blocks, "news").lines.map((l) => l.text)).toContain("Банки.ру: ставки по вкладам снизились");
  });

  it("подписи продуктов из справочника базы", async () => {
    const meta = await blocksMeta();
    expect(meta.labels.partners).toBe("Партнёрка");
    expect(meta.products.map((p) => p.code)).toContain("department");
  });
});
