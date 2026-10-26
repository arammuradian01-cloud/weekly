// Этап 81: факт к плану по неделям на настоящей базе, таблица недель в имитации. Права на загрузку и смену источников,
// проверка и загрузка плана, чтение факта, защита от обрезанного листа, фиксация недели и уточнение, журнал, данные
// экрана
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as svc from "@/lib/weekplan/service";
import { WEEKPLAN_SHEET_ID, WEEKPLAN_TABS } from "@/lib/weekplan/contract";
import { IMITATION_FACT_IDS, IMITATION_LINES } from "@/lib/weekplan/imitation";
import { figure, fkey } from "@/lib/weekplan/view";
import { LRF_SHEET_ID } from "@/lib/plan/lrf";

const actor = {
  owner: () => tasks.actorFor("muradyan", "OWNER"),
  admin: () => tasks.actorFor("golovkin", "ADMIN"),
  golovkin: () => tasks.actorFor("golovkin"),
};
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

// Понедельник 26.10.2026, 15:00 по Москве: фиксация прошла по неделю 12.10 включительно (неделя 19.10 зафиксируется в 18:00)
const NOW = new Date("2026-10-26T12:00:00Z");
const fake = () => svc.imitationWeekPlan(NOW);
const factGrid = () => fake().tab(WEEKPLAN_TABS.appFact).grid;

const clean = async () => {
  delete (globalThis as { __weekPlanFake?: unknown }).__weekPlanFake;
  await prisma.weekFactFix.deleteMany();
  await prisma.weekFact.deleteMany();
  await prisma.weekPlanValue.deleteMany();
  await prisma.weekPlanLine.deleteMany();
  await prisma.setting.deleteMany({ where: { key: { startsWith: "weekplan." } } });
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

describe("загрузка плана", () => {
  it("грузят владелец и администратор в режиме управления, остальные нет", async () => {
    await expectRule(svc.previewPlan(await actor.golovkin(), NOW), /владелец и администраторы/);
    await expectRule(svc.applyPlan(await actor.golovkin(), NOW), /владелец и администраторы/);
    await expectRule(svc.pullFactNow(await actor.golovkin(), NOW), /владелец и администраторы/);
    const p = await svc.previewPlan(await actor.admin(), NOW);
    expect(p.ready).toBe(true);
  });

  it("проверка ничего не пишет; загрузка пишет справочник, план, факт, фиксацию и журнал", async () => {
    const owner = await actor.owner();
    const p = await svc.previewPlan(owner, NOW);
    expect(p.problems).toEqual([]);
    expect(p.info).toMatchObject({ lines: IMITATION_LINES.length, weeks: 66, first: "2026-09-28", last: "2027-12-27", replaces: false });
    expect(p.info!.sums.map((s) => s.label)).toContain("Выручка от продаж всех продуктов");
    expect(await prisma.weekPlanLine.count()).toBe(0);

    const r = await svc.applyPlan(owner, NOW);
    expect(r.lines).toBe(IMITATION_LINES.length);
    expect(await prisma.weekPlanValue.count()).toBe(r.rows);
    // Факт прочитан сразу: 10 строк × 4 закрытые недели
    expect(r.fact).toMatchObject({ ok: true, rows: IMITATION_FACT_IDS.length * 4, latestWeek: "2026-10-19" });
    // Зафиксированы недели до 12.10: три недели по 10 строк, версия 1 «предварительно»
    const fixes = await prisma.weekFactFix.findMany();
    expect(fixes).toHaveLength(IMITATION_FACT_IDS.length * 3);
    expect(new Set(fixes.map((f) => f.status))).toEqual(new Set(["предварительно"]));
    expect(fixes.some((f) => f.week === "2026-10-19")).toBe(false);
    const log = await prisma.auditLog.findFirst({ where: { action: "weekplan.plan" }, orderBy: { at: "desc" } });
    expect(String(log?.after)).toMatch(/строк справочника 34/);
    expect(log?.actorName).toBe(owner.fullName);

    const again = await svc.previewPlan(owner, NOW);
    expect(again.info!.replaces).toBe(true);
  });

  it("сверка «не ок» в листе плана: загрузка отказывает, прежний план остаётся", async () => {
    const owner = await actor.owner();
    await svc.applyPlan(owner, NOW);
    const rows = await prisma.weekPlanValue.count();
    fake().tab(WEEKPLAN_TABS.plan).grid[2]![5] = "не ок";
    const p = await svc.previewPlan(owner, NOW);
    expect(p.ready).toBe(false);
    await expectRule(svc.applyPlan(owner, NOW), /«не ок»/);
    expect(await prisma.weekPlanValue.count()).toBe(rows);
  });
});

describe("факт и фиксация", () => {
  it("источник дозаполнил зафиксированную неделю: новая версия «уточнено» с разницей, первая не меняется", async () => {
    const owner = await actor.owner();
    await svc.applyPlan(owner, NOW);
    const g = factGrid();
    const row = g.findIndex((r) => r[0] === "OS.TOT.S" && r[1] === "2026-10-12");
    const was = Number(g[row]![2]);
    g[row]![2] = was + 500;
    await svc.pullFactNow(owner, new Date(NOW.getTime() + 60_000));
    const fixes = await prisma.weekFactFix.findMany({ where: { lineId: "OS.TOT.S", week: "2026-10-12" }, orderBy: { version: "asc" } });
    expect(fixes.map((f) => [f.version, f.status, f.value])).toEqual([
      [1, "предварительно", was],
      [2, "уточнено", was + 500],
    ]);
    expect(fixes[1]!.delta).toBeCloseTo(500, 6);
    const wf = await svc.weekFix("2026-10-12");
    expect(wf.status).toBe("уточнено");
    expect(wf.refined).toEqual([{ lineId: "OS.TOT.S", version: 2, delta: 500 }]);
    expect((await svc.weekFix("2026-10-05")).status).toBe("предварительно");
    expect((await svc.weekFix("2026-10-19")).status).toBe("до фиксации");
  });

  it("понедельник 18:00: прошлая неделя фиксируется из минутного цикла, повтор не плодит версий", async () => {
    await svc.applyPlan(await actor.owner(), NOW);
    expect(await prisma.weekFactFix.count({ where: { week: "2026-10-19" } })).toBe(0);
    // 18:05 по Москве: факт читать ещё рано (час не прошёл), но фиксация наступила
    const evening = new Date("2026-10-26T15:05:00Z");
    await svc.pullFactIfDue(evening);
    expect(await prisma.weekFactFix.count({ where: { week: "2026-10-19" } })).toBe(IMITATION_FACT_IDS.length);
    await svc.pullFactIfDue(new Date("2026-10-26T15:06:00Z"));
    await svc.fixPass(new Date("2026-10-26T15:07:00Z"));
    expect(await prisma.weekFactFix.count()).toBe(IMITATION_FACT_IDS.length * 4);
  });

  it("лист факта обрезан: факт не заменяется, ошибка в состоянии; чтение по расписанию не бросает", async () => {
    const owner = await actor.owner();
    await svc.applyPlan(owner, NOW);
    const before = await prisma.weekFact.count();
    const tab = fake().tab(WEEKPLAN_TABS.appFact);
    tab.grid = tab.grid.slice(0, 40);
    await expectRule(svc.pullFactNow(owner, NOW), /стало \d+ против \d+/);
    expect(await prisma.weekFact.count()).toBe(before);
    const state = await svc.factState();
    expect(state.ok).toBe(false);
    // Через 10 минут после ошибки цикл пробует снова и снова пишет ошибку, не роняя цикл
    await expect(svc.pullFactIfDue(new Date(NOW.getTime() + 11 * 60_000))).resolves.toBeUndefined();
    expect((await svc.factState()).lastAttemptAt).toBe(new Date(NOW.getTime() + 11 * 60_000).toISOString());
  });

  it("без плана факт не читается", async () => {
    const conn = (await svc.weekPlanConnection(NOW))!;
    const s = await svc.pullFact(conn, "manual", NOW);
    expect(s).toMatchObject({ ok: false, error: expect.stringMatching(/План по неделям ещё не загружен/) });
    await svc.pullFactIfDue(NOW);
    expect(await prisma.weekFact.count()).toBe(0);
  });
});

describe("источники и экран", () => {
  it("источники меняет только владелец; боевой LRF не принимается; журнал", async () => {
    await expectRule(svc.setWeekPlanSources(await actor.admin(), { fact: WEEKPLAN_SHEET_ID }), /владелец/);
    const owner = await actor.owner();
    await expectRule(svc.setWeekPlanSources(owner, { plan: LRF_SHEET_ID }), /боевой LRF/);
    await expectRule(svc.setWeekPlanSources(owner, { fact: "не ссылка" }), /не похоже на ссылку/);
    const BI = "1BiFactAbcdefghijklmnopqrstuvwxyz0123456789";
    const s = await svc.setWeekPlanSources(owner, { fact: `https://docs.google.com/spreadsheets/d/${BI}/edit`, factTab: WEEKPLAN_TABS.biFact });
    expect(s).toEqual({ planId: WEEKPLAN_SHEET_ID, factId: BI, factTab: WEEKPLAN_TABS.biFact });
    const log = await prisma.auditLog.findFirst({ where: { action: "weekplan.sources" }, orderBy: { at: "desc" } });
    expect(String(log?.after)).toContain(BI);
    // Пустые поля возвращают таблицу недель и вкладку Weekly
    expect(await svc.setWeekPlanSources(owner, {})).toEqual({ planId: WEEKPLAN_SHEET_ID, factId: WEEKPLAN_SHEET_ID, factTab: WEEKPLAN_TABS.appFact });
  });

  it("данные экрана: план и факт из базы считаются так же, как из листов", async () => {
    await svc.applyPlan(await actor.owner(), NOW);
    const data = (await svc.planData((lines) => lines.filter((l) => l.cut === "итог").map((l) => l.id)))!;
    expect(data.weeks).toHaveLength(66);
    expect(data.first).toBe("2026-10-01");
    expect(data.last).toBe("2027-12-31");
    expect(data.lines).toHaveLength(IMITATION_LINES.length);
    const fact = await prisma.weekFact.findUnique({ where: { lineId_week: { lineId: "OS.TOT.S", week: "2026-10-12" } } });
    const parts = await prisma.weekPlanValue.findMany({ where: { lineId: "OS.TOT.S", version: "BUD", week: "2026-10-12" } });
    const f = figure(data, ["OS.TOT.S"], "2026-10-12", "BUD");
    expect(f.fact).toBe(fact!.value);
    expect(f.plan).toBeCloseTo(parts.reduce((s, p) => s + p.value, 0), 6);
    expect(data.fact.has(fkey("OS.SK.ALFA.S", "2026-10-12"))).toBe(false);
    const status = await svc.weekPlanStatus(await actor.golovkin());
    expect(status).toMatchObject({ canLoad: false, canSource: false, mode: "imitation" });
    expect(status.plan?.lines).toBe(IMITATION_LINES.length);
  });
});
