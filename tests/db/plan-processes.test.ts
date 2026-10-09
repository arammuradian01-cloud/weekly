// Этап 35: прогноз месяца в процессах. Снимки загрузок LBE и событие командам продуктов, «Прогноз проверен», факт по
// дням, сравнение двух любых версий месяца, сводка для отчёта CEO и встречи, выгрузка в Excel
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as plan from "@/lib/plan/service";
import * as proc from "@/lib/plan/processes";
import { buildPlanExport } from "@/lib/plan/export";
import { listInbox } from "@/lib/inbox/service";
import { derive } from "@/lib/plan/model";
import type { Values } from "@/lib/plan/lrf";
import { moscowToday } from "@/lib/tasks/dates";
import { TOP_TEAM } from "@/lib/org/scope";

const actor = {
  owner: () => tasks.actorFor("muradyan", "OWNER"),
  admin: () => tasks.actorFor("golovkin", "ADMIN"),
  golovkin: () => tasks.actorFor("golovkin"),
  reva: () => tasks.actorFor("reva"),
  fatyanov: () => tasks.actorFor("fatyanov"),
  loginova: () => tasks.actorFor("loginova"),
  sakhibullina: () => tasks.actorFor("sakhibullina"),
  team: async (): Promise<tasks.Actor> => ({ ...(await tasks.actorFor("fatyanov")), via: "TEAM" }),
};
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

const month = plan.currentMonth();
const today = moscowToday();
const DAY = 24 * 60 * 60 * 1000;

const clean = async () => {
  await prisma.inboxEvent.deleteMany({ where: { kind: "PLAN" } });
  await prisma.planFact.deleteMany();
  await prisma.planCheck.deleteMany();
  await prisma.planPull.deleteMany();
  await prisma.planAdjustment.deleteMany();
  await prisma.planLine.deleteMany();
  await prisma.setting.deleteMany({ where: { key: { startsWith: "plan." } } });
  await prisma.teamMember.deleteMany({ where: { team: { name: { startsWith: "Тест этапа 35" } } } });
  await prisma.team.deleteMany({ where: { name: { startsWith: "Тест этапа 35" } } });
};

beforeAll(async () => {
  process.env.SHEET_FAKE = "1";
  await clean();
});
beforeEach(clean);
afterAll(async () => {
  await clean();
  delete process.env.SHEET_FAKE;
  await prisma.$disconnect();
});

const load = async () => plan.applyPull(await actor.owner(), month);
const view = async (who?: tasks.Actor) => plan.monthPlan(who ?? (await actor.reva()), month);
const adjust = async (who: tasks.Actor, product: string, metric: string, value: number) => {
  const v = await view(who);
  const p = v.products.find((x) => x.code === product)!;
  const seen = p.drivers[metric as keyof typeof p.drivers] ?? derive(p.lbe as Values)[metric as keyof Values] ?? null;
  return plan.adjust(who, { month, product, metric, value, seen, reason: "conversion", comment: "Конверсия первой недели ниже плана" });
};
const personId = async (slug: string) => (await prisma.person.findUniqueOrThrow({ where: { slug } })).id;

describe("загрузка LBE: снимок и событие командам продуктов", () => {
  it("каждая загрузка оставляет снимок; командам продуктов событие в «Мне» со своими продуктами, загрузившему нет", async () => {
    await load();
    const pulls = await prisma.planPull.findMany({ where: { month } });
    expect(pulls).toHaveLength(1);
    expect(pulls[0]!.byName).toMatch(/Мурадян/);
    expect((pulls[0]!.lines as unknown[]).length).toBe(await prisma.planLine.count({ where: { month } }));
    const events = await prisma.inboxEvent.findMany({ where: { kind: "PLAN" }, include: { recipient: { select: { slug: true } } } });
    const bySlug = Object.fromEntries(events.map((e) => [e.recipient.slug, e.text]));
    expect(Object.keys(bySlug).sort()).toEqual(["cheychenets", "fatyanov", "golovkin", "loginova", "reva"]);
    expect(bySlug.golovkin).toMatch(/Проверьте прогноз: ОСАГО\. Скорректируйте/);
    expect(bySlug.fatyanov).toMatch(/КАСКО/);
    expect(bySlug.reva).toMatch(/ОСАГО, КАСКО, Ипотечное страхование, ВЗР, Несчастный случай, Имущество, Клещ, Вклады/);
    expect(events.every((e) => e.subject === `plan:${month}`)).toBe(true);
    await load();
    expect(await prisma.planPull.count({ where: { month } })).toBe(2);
    // В «Мне» одна строка на месяц, сколько бы загрузок ни было
    const inbox = await listInbox(await personId("golovkin"));
    expect(inbox.items.filter((i) => i.subject === `plan:${month}`)).toHaveLength(1);
    // Общему логину без режима управления событие не показывается: корректируют при личном входе
    const shared = await listInbox(await personId("golovkin"), new Date(), { id: await personId("golovkin"), role: "ADMIN", limited: true, shared: true });
    expect(shared.items.some((i) => i.subject.startsWith("plan:"))).toBe(false);
  });
});

describe("«Прогноз проверен»", () => {
  it("после загрузки все продукты ждут проверки; корректировка и отметка снимают ожидание", async () => {
    await load();
    let v = await view();
    expect(v.products.every((p) => p.review?.state === "waiting")).toBe(true);
    await adjust(await actor.golovkin(), "osago", "crWeb", 0.05);
    v = await proc.checkPlan(await actor.fatyanov(), month, "kasko");
    expect(v.products.find((p) => p.code === "osago")!.review).toMatchObject({ state: "adjusted", by: "Головкин Владислав" });
    expect(v.products.find((p) => p.code === "kasko")!.review).toMatchObject({ state: "checked", by: "Фатьянов Евгений" });
    expect(v.products.find((p) => p.code === "deposits")!.review?.state).toBe("waiting");
    const audit = await prisma.auditLog.findFirst({ where: { action: "plan.check" }, orderBy: { at: "desc" } });
    expect(audit).toMatchObject({ entityId: `${month}:kasko`, actorName: "Фатьянов Евгений" });
  });

  it("кто может и повторы: команда продукта при личном входе, один раз после загрузки", async () => {
    await load();
    await adjust(await actor.golovkin(), "osago", "crWeb", 0.05);
    await expectRule(proc.checkPlan(await actor.reva(), month, "osago"), /уже скорректирован: Головкин Владислав/);
    await expectRule(proc.checkPlan(await actor.loginova(), month, "kasko"), /проверяет его команда/);
    await expectRule(proc.checkPlan(await actor.team(), month, "kasko"), /при личном входе/);
    await expectRule(proc.checkPlan(await actor.fatyanov(), month, "нет-такого"), /Нет такого продукта/);
    await proc.checkPlan(await actor.fatyanov(), month, "kasko");
    await expectRule(proc.checkPlan(await actor.reva(), month, "kasko"), /уже отмечен проверенным: Фатьянов Евгений/);
    await expectRule(proc.checkPlan(await actor.fatyanov(), month, "kasko"), /уже отмечен/);
  });

  it("новая загрузка LBE снова просит проверить, прежние отметки остаются в истории", async () => {
    await load();
    await proc.checkPlan(await actor.fatyanov(), month, "kasko");
    // Отметка раньше второй загрузки
    await prisma.planCheck.updateMany({ data: { at: new Date(Date.now() - 60_000) } });
    await prisma.planPull.updateMany({ data: { at: new Date(Date.now() - 120_000) } });
    await load();
    const v = await view();
    expect(v.products.find((p) => p.code === "kasko")!.review?.state).toBe("waiting");
    expect(await prisma.planCheck.count()).toBe(1);
    await proc.checkPlan(await actor.fatyanov(), month, "kasko");
    expect(await prisma.planCheck.count()).toBe(2);
  });

  it("месяц загружен до этапа 35 без снимка: время берётся из отметки загрузки", async () => {
    await load();
    await prisma.planPull.deleteMany();
    const v = await view();
    expect(v.products[0]!.review?.state).toBe("waiting");
    await prisma.setting.deleteMany({ where: { key: "plan.pulled" } });
    expect((await view()).products[0]!.review).toBeNull();
    await expectRule(proc.checkPlan(await actor.fatyanov(), month, "kasko"), /Неизвестно, когда загружен LBE/);
  });
});

describe("факт по дням", () => {
  const first = `${month}-01`.split("-").reverse().join(".");
  const second = `${month}-02`.split("-").reverse().join(".");
  const text = (rows: string[]) => ["Дата\tПродукт\tПродажи\tВыручка, млн\tПромо-маржа, млн", ...rows].join("\n");

  it("проверка и загрузка только в режиме управления; повторная загрузка дня заменяет значение", async () => {
    await load();
    await expectRule(proc.previewFacts(await actor.golovkin(), text([`${first}\tОСАГО\t100\t15\t5`])), /режиме управления/);
    await expectRule(proc.applyFacts(await actor.reva(), text([`${first}\tОСАГО\t100\t15\t5`])), /режиме управления/);
    const preview = await proc.previewFacts(await actor.admin(), text([`${first}\tОСАГО\t100\t15\t5`, `${first}\tКАСКО\t20\t3\t1`]));
    expect(preview).toMatchObject({ ready: true, rows: 2, values: 6, replaced: 0 });
    expect(preview.products.map((p) => [p.code, p.days, p.totals.revenue])).toEqual([
      ["osago", 1, 15],
      ["kasko", 1, 3],
    ]);
    expect(await prisma.planFact.count()).toBe(0);
    expect(await proc.applyFacts(await actor.admin(), text([`${first}\tОСАГО\t100\t15\t5`, `${first}\tКАСКО\t20\t3\t1`]))).toEqual({ saved: 6, replaced: 0 });
    const again = text([`${first}\tОСАГО\t110\t16\t5,5`]);
    expect((await proc.previewFacts(await actor.owner(), again)).replaced).toBe(3);
    expect(await proc.applyFacts(await actor.owner(), again)).toEqual({ saved: 3, replaced: 3 });
    const v = await view();
    const osago = v.products.find((p) => p.code === "osago")!;
    expect(osago.facts?.daily.revenue).toEqual([{ day: `${month}-01`, value: 16 }]);
    expect(osago.facts?.loadedBy).toBe("Мурадян Арам");
    expect(v.products.find((p) => p.code === "kasko")!.facts?.daily.units).toEqual([{ day: `${month}-01`, value: 20 }]);
    const audit = await prisma.auditLog.findFirst({ where: { action: "plan.facts" }, orderBy: { at: "desc" } });
    expect(audit).toMatchObject({ before: "заменено значений: 3", after: expect.stringMatching(/^значений 3, с /) });
  });

  it("с ошибкой в любой строке не пишется ничего", async () => {
    if (today < `${month}-02`) return;
    await expectRule(proc.applyFacts(await actor.owner(), text([`${first}\tОСАГО\t100\t15\t5`, `${second}\tНет такого\t1\t1\t1`])), /Не загружено: Строка 3: продукт/);
    expect(await prisma.planFact.count()).toBe(0);
  });
});

describe("сравнение версий месяца", () => {
  it("бюджет, LBE и прогноз сейчас совпадают со сводкой экрана", async () => {
    await load();
    await adjust(await actor.golovkin(), "osago", "crWeb", 0.05);
    const v = await view();
    const s = plan.planSummary(v);
    const cmp = (await proc.compareVersions(month, "budget", "forecast"))!;
    expect(cmp.a.label).toBe("Бюджет");
    expect(cmp.b.label).toBe("Прогноз сейчас");
    const osago = cmp.rows.find((r) => r.code === "osago")!;
    const so = s.products.find((p) => p.code === "osago")!;
    expect(osago.a.revenue).toBeCloseTo(so.revenue.budget!, 9);
    expect(osago.b.revenue).toBeCloseTo(so.revenue.forecast!, 9);
    expect(osago.b.units).toBeCloseTo(so.units.forecast!, 6);
    expect(cmp.rows.find((r) => r.code === "total")!.b.revenue).toBeCloseTo(s.total.revenue.forecast!, 9);
    expect(cmp.rows.map((r) => r.kind)).toContain("group");
    // Неизвестные версии: бюджет против прогноза сейчас
    const def = (await proc.compareVersions(month, "что-то", null))!;
    expect([def.a.id, def.b.id]).toEqual(["budget", "forecast"]);
    expect(await proc.compareVersions("2020-01")).toBeNull();
  });

  it("LBE прежней загрузки и прогноз на конец прошлого дня", async () => {
    await load();
    // Первая загрузка была вчера, и выручка ОСАГО в ней другая
    const [firstPull] = await prisma.planPull.findMany();
    const lines = (firstPull!.lines as { version: string; product: string; metric: string; value: number | null }[]).map((l) => (l.version === "LBE" && l.product === "osago" && l.metric === "revenue" ? { ...l, value: (l.value ?? 0) - 50 } : l));
    await prisma.planPull.update({ where: { id: firstPull!.id }, data: { at: new Date(Date.now() - 2 * DAY), lines } });
    await load();
    // Корректировка вчера и корректировка сегодня
    await adjust(await actor.golovkin(), "osago", "crWeb", 0.05);
    await prisma.planAdjustment.updateMany({ data: { createdAt: new Date(Date.now() - DAY) } });
    await adjust(await actor.golovkin(), "osago", "crWeb", 0.06);
    const base = (await proc.compareVersions(month, "lbe", "forecast"))!;
    const pullOption = base.options.find((o) => o.id.startsWith("pull:"))!;
    expect(pullOption.group).toBe("Загрузки LBE");
    const days = base.options.filter((o) => o.group === "Прогноз на дату");
    expect(days.length).toBeGreaterThanOrEqual(1);
    const cmp = (await proc.compareVersions(month, pullOption.id, "lbe"))!;
    const osago = cmp.rows.find((r) => r.code === "osago")!;
    expect(osago.b.revenue! - osago.a.revenue!).toBeCloseTo(50, 6);
    // Прогноз на конец вчерашнего дня: LBE второй загрузки (она позже вчера? нет: вторая загрузка сегодня) поэтому LBE первой
    // загрузки и вчерашняя корректировка 5%, без сегодняшней 6%
    const yesterday = new Date(Date.now() - DAY + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dayOption = days.find((o) => o.id === `day:${yesterday}`)!;
    expect(dayOption.label).toMatch(/^Прогноз на конец \d{2}\.\d{2}$/);
    const atDay = (await proc.compareVersions(month, dayOption.id, "forecast"))!;
    const o = atDay.rows.find((r) => r.code === "osago")!;
    expect(o.a.revenue).not.toBeCloseTo(o.b.revenue!, 3);
    // Та же версия против себя даёт ноль разницы
    const same = (await proc.compareVersions(month, dayOption.id, dayOption.id))!;
    expect(same.rows.find((r) => r.code === "osago")!.a.revenue).toBeCloseTo(same.rows.find((r) => r.code === "osago")!.b.revenue!, 9);
  });

  it("день до первого снимка: берётся LBE последней загрузки и это видно в пояснении", async () => {
    await load();
    await prisma.planPull.updateMany({ data: { at: new Date() } });
    await adjust(await actor.golovkin(), "osago", "crWeb", 0.05);
    await prisma.planAdjustment.updateMany({ data: { createdAt: new Date(Date.now() - 3 * DAY) } });
    const day = new Date(Date.now() - 3 * DAY + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const cmp = (await proc.compareVersions(month, `day:${day}`, "forecast"))!;
    expect(cmp.notes[0]).toMatch(/Снимков загрузки LBE до \d{2}\.\d{2} нет/);
  });
});

describe("сводка для отчёта CEO и встречи", () => {
  it("итог, причины корректировок и кто ждёт проверки", async () => {
    await load();
    await adjust(await actor.golovkin(), "osago", "crWeb", 0.05);
    const brief = (await proc.planBrief(await actor.owner(), month))!;
    expect(brief.month).toBe(month);
    expect(brief.reasons).toEqual([expect.objectContaining({ product: "ОСАГО", metric: "Конверсия сайта", value: "5,00%", reason: "Конверсия", author: "Головкин Владислав" })]);
    expect(brief.waiting.map((w) => w.product)).toEqual(["КАСКО", "Ипотечное страхование", "ВЗР", "Несчастный случай", "Имущество", "Клещ", "Вклады"]);
    expect(brief.waiting[0]!.owners).toEqual(["Фатьянов Евгений", "Рева Тарас"]);
    expect(brief.rows.find((r) => r.code === "red")!.kind).toBe("group");
    const text = proc.planBriefText(brief);
    expect(text[1]).toMatch(/^Выручка: прогноз /);
    expect(text.some((t) => t.startsWith("- ОСАГО, конверсия сайта: 5,00% вместо"))).toBe(true);
    expect(await proc.planBrief(await actor.owner(), "2020-01")).toBeNull();
  });

  it("на встрече: у топ-команды и у команд с кем-то из команд продуктов", async () => {
    await load();
    expect(await proc.planForTeam(await actor.owner(), TOP_TEAM, month)).not.toBeNull();
    const sales = await prisma.team.create({ data: { name: "Тест этапа 35: партнёры", leaderId: await personId("sakhibullina") } });
    expect(await proc.planForTeam(await actor.owner(), sales.id, month)).toBeNull();
    const kasko = await prisma.team.create({ data: { name: "Тест этапа 35: КАСКО", leaderId: await personId("sakhibullina"), members: { create: [{ personId: await personId("fatyanov") }] } } });
    expect(await proc.planForTeam(await actor.owner(), kasko.id, month)).not.toBeNull();
    expect(await proc.planForTeam(await actor.owner(), "нет-такой", month)).toBeNull();
  });
});

describe("выгрузка в Excel", () => {
  it("кто берёт: управление и команды продуктов при личном входе", async () => {
    const owners = await plan.ownersMap();
    expect(plan.canExportPlan(await actor.owner(), owners)).toBe(true);
    expect(plan.canExportPlan(await actor.golovkin(), owners)).toBe(true);
    expect(plan.canExportPlan(await actor.reva(), owners)).toBe(true);
    expect(plan.canExportPlan(await actor.sakhibullina(), owners)).toBe(false);
    expect(plan.canExportPlan(await actor.team(), owners)).toBe(false);
    expect(plan.canExportPlan(await tasks.actorFor("ceo"), owners)).toBe(false);
  });

  it("листы: сводка, драйверы, корректировки, факт, темп и загрузки", async () => {
    await load();
    await adjust(await actor.golovkin(), "osago", "crWeb", 0.05);
    await proc.applyFacts(await actor.owner(), ["Дата\tПродукт\tВыручка, млн", `${`${month}-01`.split("-").reverse().join(".")}\tОСАГО\t15`].join("\n"));
    const v = await view(await actor.owner());
    const { buffer, file } = await buildPlanExport(v);
    expect(file).toBe(`prognoz-${month}.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Сводка", "Драйверы", "Корректировки", "Факт по дням", "Темп к прогнозу", "Загрузки LBE"]);
    const summary = wb.getWorksheet("Сводка")!;
    const total = summary.getRows(2, summary.rowCount - 1)!.find((r) => r.getCell(1).value === "Итого по продуктам" && r.getCell(3).value === "Выручка, млн руб.")!;
    expect(total.getCell(6).value).toBeCloseTo(plan.planSummary(v).total.revenue.forecast!, 6);
    const adj = wb.getWorksheet("Корректировки")!;
    expect(adj.rowCount).toBe(2);
    expect(adj.getRow(2).getCell(9).value).toBe("Конверсия первой недели ниже плана");
    expect(wb.getWorksheet("Факт по дням")!.getRow(2).getCell(4).value).toBe(15);
  });
});
