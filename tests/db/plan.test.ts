// Этап 32: прогноз месяца по драйверам. Загрузка бюджета и LBE из LRF в имитации, корректировки драйверов командой
// продукта с причиной и обоснованием, пересчёт выручки и маржи, права, проверки, журнал и повторная загрузка
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as plan from "@/lib/plan/service";
import { addMonths } from "@/lib/forecast/codes";
import { derive } from "@/lib/plan/model";
import type { Values } from "@/lib/plan/lrf";
import { PROD_SHEET_ID } from "@/lib/sheet/client";

const actor = {
  owner: () => tasks.actorFor("muradyan", "OWNER"),
  admin: () => tasks.actorFor("golovkin", "ADMIN"),
  golovkin: () => tasks.actorFor("golovkin"),
  reva: () => tasks.actorFor("reva"),
  loginova: () => tasks.actorFor("loginova"),
  observer: () => tasks.actorFor("ceo"),
  team: async (): Promise<tasks.Actor> => ({ ...(await tasks.actorFor("golovkin")), via: "TEAM" }),
};
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

const month = plan.currentMonth();
const lbeOf = (view: plan.MonthPlanView, code: string) => derive(view.products.find((p) => p.code === code)!.lbe as Values);

const clean = async () => {
  // Этап 35: загрузка пишет снимок и события командам продуктов
  await prisma.inboxEvent.deleteMany({ where: { kind: "PLAN" } });
  await prisma.planCheck.deleteMany();
  await prisma.planFact.deleteMany();
  await prisma.planPull.deleteMany();
  await prisma.planPartnerAdjustment.deleteMany();
  await prisma.planPartnerTotal.deleteMany();
  await prisma.planPartner.deleteMany();
  await prisma.planAdjustment.deleteMany();
  await prisma.planLine.deleteMany();
  await prisma.setting.deleteMany({ where: { key: { startsWith: "plan." } } });
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
const adjust = async (who: tasks.Actor, input: Partial<plan.AdjustInput> & { metric: string }) => {
  const view = await plan.monthPlan(who, month);
  const product = input.product ?? "osago";
  const p = view.products.find((x) => x.code === product)!;
  const seen = "seen" in input ? input.seen! : (p.drivers[input.metric as keyof typeof p.drivers] ?? derive(p.lbe as Values)[input.metric as keyof Values] ?? null);
  return plan.adjust(who, { month, product, reason: "conversion", comment: "Конверсия первой недели выше плана", value: null, ...input, seen });
};

describe("загрузка бюджета и LBE из LRF", () => {
  it("до загрузки прогноза нет; проверка и загрузка только в режиме управления", async () => {
    const empty = await plan.monthPlan(await actor.reva(), month);
    expect(empty.empty).toBe(true);
    expect(empty.canPull).toBe(false);
    await expectRule(plan.previewPull(await actor.reva(), month), /режиме управления/);
    await expectRule(plan.applyPull(await actor.golovkin(), month), /режиме управления/);
    const preview = await plan.previewPull(await actor.owner(), month);
    expect(preview.ready).toBe(true);
    expect(preview.problems).toEqual([]);
    expect(preview.products.map((p) => p.code)).toEqual(["osago", "kasko", "red-mortgage", "red-travel", "red-accident", "red-property", "red-tick", "deposits"]);
    expect(preview.products[0]!.revenue).toEqual({ lbe: 450, budget: 440, before: null });
    // Проверка ничего не пишет
    expect(await prisma.planLine.count()).toBe(0);
  });

  it("загрузка пишет версии месяца, журнал и время; без корректировок прогноз совпадает с LBE", async () => {
    const res = await load();
    expect(res.lines).toBeGreaterThan(100);
    const view = await plan.monthPlan(await actor.reva(), month);
    expect(view.empty).toBe(false);
    expect(view.month).toBe(month);
    expect(view.products).toHaveLength(8);
    expect(view.groups.map((g) => g.code)).toEqual(["red"]);
    expect(view.source.pulledAt).not.toBeNull();
    expect(view.source.pulledBy).toMatch(/Мурадян/);
    const s = plan.planSummary(view);
    for (const t of s.top) expect(t.revenue.forecast, t.code).toBeCloseTo(t.revenue.lbe!, 9);
    expect(s.total.revenue.forecast).toBeCloseTo(s.total.revenue.lbe!, 9);
    // У КАСКО и продуктов RED нет строки прямой маржи: итог без КАСКО, RED считается по группе
    expect(s.total.directMargin.without).toEqual(["КАСКО"]);
    const audit = await prisma.auditLog.findFirst({ where: { action: "plan.pull", entityId: month }, orderBy: { at: "desc" } });
    expect(audit?.after).toMatch(/LBE .* млн, бюджет .* млн/);
  });

  it("связь с LRF ещё не открыта: понятная подсказка, что нажать", async () => {
    const tab = [...plan.imitationLrf().tabs.values()].find((t) => t.title === "CASCO LRF")!;
    const saved = tab.grid;
    tab.grid = [["#REF!"]];
    try {
      await expectRule(plan.previewPull(await actor.owner(), month), /«CASCO LRF» ещё не получил цифры из LRF.*Открыть доступ/);
      await expectRule(plan.applyPull(await actor.owner(), month), /Открыть доступ/);
    } finally {
      tab.grid = saved;
    }
  });

  it("месяц, которого нет в LRF: загрузить нельзя, понятная причина", async () => {
    const far = addMonths(month, 5);
    const preview = await plan.previewPull(await actor.owner(), far);
    expect(preview.ready).toBe(false);
    expect(preview.problems.join(" ")).toMatch(/Нет колонки LBE/);
    await expectRule(plan.applyPull(await actor.owner(), far), /Не загружено/);
    await expectRule(plan.applyPull(await actor.owner(), "2026-13"), /Неверный месяц/);
  });
});

describe("корректировки драйверов", () => {
  it("команда продукта меняет конверсию: выручка и маржа пересчитаны, журнал и аудит записаны", async () => {
    await load();
    const view = await adjust(await actor.golovkin(), { metric: "crWeb", value: 0.12, reason: "conversion", comment: "Новая форма оплаты подняла конверсию" });
    const p = view.products.find((x) => x.code === "osago")!;
    expect(p.drivers).toEqual({ crWeb: 0.12 });
    expect(p.last.crWeb?.previous).toBe(0.1);
    expect(p.last.crWeb?.author.name).toMatch(/Головкин/);
    const s = plan.planSummary(view);
    const osago = s.products.find((x) => x.code === "osago")!;
    expect(osago.units.forecast).toBeCloseTo(405_000, 6);
    expect(osago.revenue.forecast).toBeCloseTo(420 * (405 / 375) + 30, 6);
    expect(s.total.revenue.forecast! - s.total.revenue.lbe!).toBeCloseTo(osago.revenue.forecast! - 450, 6);
    expect(view.history).toHaveLength(1);
    expect(view.history[0]).toMatchObject({ product: "osago", metric: "crWeb", value: 0.12, previous: 0.1, reason: "conversion", comment: "Новая форма оплаты подняла конверсию" });
    const audit = await prisma.auditLog.findFirst({ where: { action: "plan.adjust" }, orderBy: { at: "desc" } });
    expect(audit?.field).toMatch(/ОСАГО, Конверсия сайта/);
    expect(audit?.before).toBe("10,0%");
    expect(audit?.after).toMatch(/^12,0%\. Конверсия: Новая форма/);
  });

  it("права: чужой продукт, общий логин и наблюдатель не корректируют; режим управления может всё", async () => {
    await load();
    await expectRule(adjust(await actor.loginova(), { metric: "crWeb", value: 0.12 }), /корректирует его команда/);
    await expectRule(adjust(await actor.team(), { metric: "crWeb", value: 0.12 }), /личном входе/);
    await expectRule(adjust(await actor.observer(), { metric: "crWeb", value: 0.12 }), /Наблюдатель/);
    // Свой продукт: RED у Логиновой
    await adjust(await actor.loginova(), { product: "red-travel", metric: "rpu", value: 1_000, reason: "check-kv", comment: "Страховая подняла комиссию" });
    await adjust(await actor.owner(), { product: "deposits", metric: "units", value: 60_000, reason: "traffic", comment: "Акция банка-партнёра" });
    // Общий логин с режимом владельца: пароль владельца личный, автор виден. Пароль администраторов общий: нельзя
    await adjust({ ...(await actor.owner()), via: "TEAM" }, { product: "kasko", metric: "rpu", value: 700, reason: "check-kv", comment: "Страховая подняла вознаграждение" });
    await expectRule(adjust({ ...(await actor.admin()), via: "TEAM" }, { product: "kasko", metric: "rpu", value: 710, reason: "check-kv", comment: "Под общим логином" }), /личном входе/);
    const view = await plan.monthPlan(await actor.loginova(), month);
    expect(view.products.find((p) => p.code === "red-travel")!.canAdjust).toBe(true);
    expect(view.products.find((p) => p.code === "osago")!.canAdjust).toBe(false);
    expect((await plan.monthPlan(await actor.team(), month)).adjustHint).toMatch(/общим логином/);
    // Итог RED: LBE группы плюс изменение ВЗР
    const s = plan.planSummary(view);
    const red = s.top.find((t) => t.code === "red")!;
    const travel = s.products.find((p) => p.code === "red-travel")!;
    expect(red.revenue.forecast! - red.revenue.lbe!).toBeCloseTo(travel.revenue.forecast! - travel.revenue.lbe!, 9);
    expect(red.adjusted).toBe(1);
  });

  it("проверки: обоснование, причина, результат вместо драйвера, единицы, границы", async () => {
    await load();
    const golovkin = await actor.golovkin();
    await expectRule(adjust(golovkin, { metric: "crWeb", value: 0.12, comment: "ок" }), /почему меняется/);
    await expectRule(adjust(golovkin, { metric: "crWeb", value: 0.12, comment: "x".repeat(301) }), /не длиннее 300/);
    await expectRule(adjust(golovkin, { metric: "crWeb", value: 0.12, reason: "погода" }), /причину/);
    await expectRule(adjust(golovkin, { metric: "revenue", value: 500, seen: 450 }), /пересчитывается сам/);
    await expectRule(adjust(golovkin, { metric: "crWeb", value: 12 }), /вне разумных границ.*в процентах/);
    await expectRule(adjust(golovkin, { metric: "trafficWeb", value: -5 }), /вне разумных границ/);
    await expectRule(adjust(golovkin, { metric: "crWeb", value: Number.NaN }), /числом/);
    await expectRule(adjust(golovkin, { product: "nope", metric: "crWeb", value: 0.12, seen: 0.1 }), /Нет такого продукта/);
    await expectRule(adjust(golovkin, { metric: "crWeb", value: 0.1 }), /и так как в LBE/);
    // С точностью поля ввода: 1 500 000,3 при LBE 1 500 000 это то же значение
    await expectRule(adjust(golovkin, { metric: "trafficWeb", value: 1_500_000.3 }), /и так как в LBE/);
    // Эмодзи считаются одним символом, как в базе
    await expectRule(adjust(golovkin, { metric: "crWeb", value: 0.12, comment: "👍👍" }), /почему меняется/);
    expect(await prisma.planAdjustment.count()).toBe(0);
  });

  it("возврат к LBE, то же значение и значение как в LBE", async () => {
    await load();
    const g = await actor.golovkin();
    await adjust(g, { metric: "rpu", value: 1_210, reason: "check-kv", comment: "Средний чек вырос" });
    await expectRule(adjust(g, { metric: "rpu", value: 1_210 }), /не изменилось/);
    // Значение как в LBE записывается возвратом
    let view = await adjust(g, { metric: "rpu", value: 1_100, reason: "check-kv", comment: "Чек вернулся к плану" });
    expect(view.products.find((p) => p.code === "osago")!.drivers).toEqual({});
    expect(view.history[0]).toMatchObject({ value: null, previous: 1_210 });
    await adjust(g, { metric: "rpu", value: 1_300, reason: "check-kv", comment: "Средний чек вырос снова" });
    view = await adjust(g, { metric: "rpu", value: null, reason: "other", comment: "Решили держать LBE" });
    expect(view.products.find((p) => p.code === "osago")!.drivers).toEqual({});
    expect(view.history.map((h) => h.value)).toEqual([null, 1_300, null, 1_210]);
    await expectRule(adjust(g, { metric: "rpu", value: null }), /и так как в LBE/);
  });

  it("цифру поменяли, пока человек правил: правка не проходит; две правки сразу проходят по очереди", async () => {
    await load();
    const g = await actor.golovkin();
    const owner = await actor.owner();
    await adjust(g, { metric: "trafficApp", value: 320_000, reason: "traffic", comment: "Рост приложения" });
    await expectRule(adjust(owner, { metric: "trafficApp", value: 330_000, seen: 300_000, reason: "traffic", comment: "Устаревший экран" }), /уже поменяли/);
    const both = await Promise.allSettled([
      adjust(g, { metric: "trafficWeb", value: 1_600_000, seen: 1_500_000, reason: "traffic", comment: "Первая правка" }),
      adjust(owner, { metric: "trafficWeb", value: 1_700_000, seen: 1_500_000, reason: "traffic", comment: "Вторая правка" }),
    ]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(both.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await prisma.planAdjustment.count({ where: { metric: "trafficWeb" } })).toBe(1);
  });

  it("повторная загрузка заменяет версии и оставляет корректировки", async () => {
    await load();
    await adjust(await actor.golovkin(), { metric: "unitsB2b", value: 160_000, reason: "partner-sk", comment: "Новый партнёр с 15 числа" });
    const before = await prisma.planLine.count({ where: { month } });
    await load();
    expect(await prisma.planLine.count({ where: { month } })).toBe(before);
    const view = await plan.monthPlan(await actor.reva(), month);
    expect(view.products.find((p) => p.code === "osago")!.drivers).toEqual({ unitsB2b: 160_000 });
    expect(lbeOf(view, "osago").unitsB2b).toBe(150_000);
    const preview = await plan.previewPull(await actor.owner(), month);
    expect(preview.adjustments).toBe(1);
    expect(preview.products[0]!.revenue.before).toBe(450);
  });
});

describe("повторная загрузка и закрытые месяцы", () => {
  it("строка пропала из LRF: загрузить нельзя, видно какая", async () => {
    const tab = [...plan.imitationLrf().tabs.values()].find((t) => t.title === "DEPOSITS_KEY METRICS")!;
    const saved = tab.grid;
    tab.grid = saved.filter((row) => row[1] !== "REVENUE PER CLICK (RUB)");
    try {
      const preview = await plan.previewPull(await actor.owner(), month);
      expect(preview.ready).toBe(false);
      expect(preview.problems).toContain("Вклады: в LRF не найдены строки: выручка на клик, руб.");
    } finally {
      tab.grid = saved;
    }
  });

  it("у корректировки поменялся LBE: проверка загрузки показывает это", async () => {
    await load();
    await adjust(await actor.golovkin(), { metric: "trafficWeb", value: 1_600_000, reason: "traffic", comment: "Рост SEO" });
    const tab = [...plan.imitationLrf().tabs.values()].find((t) => t.title === "OSAGO_KEY METRICS")!;
    const row = tab.grid.find((r) => r[1] === "TOTAL OSAGO Web (MAU)")!;
    const saved = row[3];
    row[3] = 1_700_000;
    try {
      const preview = await plan.previewPull(await actor.owner(), month);
      expect(preview.adjustments).toBe(1);
      expect(preview.changed).toEqual([{ product: "ОСАГО", metric: "Трафик сайта, MAU", value: "1 600 000", lbeBefore: "1 500 000", lbeAfter: "1 700 000" }]);
    } finally {
      row[3] = saved;
    }
  });

  it("драйвера больше нет в LBE: корректировку можно снять, но не поставить новую", async () => {
    await load();
    const g = await actor.golovkin();
    await adjust(g, { metric: "rpu", value: 1_210, reason: "check-kv", comment: "Средний чек вырос" });
    await prisma.planLine.deleteMany({ where: { month, product: "osago", metric: "rpu", version: "LBE" } });
    await expectRule(adjust(g, { metric: "rpu", value: 1_300, seen: 1_210, reason: "check-kv", comment: "Ещё выше" }), /нет этого показателя/);
    const view = await adjust(g, { metric: "rpu", value: null, seen: 1_210, reason: "other", comment: "Строки больше нет в LRF" });
    expect(view.products.find((p) => p.code === "osago")!.drivers).toEqual({});
  });

  it("прошлый месяц закрыт: прогноз виден, корректировать нельзя", async () => {
    const prev = addMonths(month, -1);
    await plan.applyPull(await actor.owner(), prev);
    const view = await plan.monthPlan(await actor.golovkin(), prev);
    expect(view.closed).toBe(true);
    expect(view.products.every((p) => !p.canAdjust)).toBe(true);
    expect(view.adjustHint).toMatch(/закрыт/);
    const lbe = derive(view.products.find((p) => p.code === "osago")!.lbe as Values);
    await expectRule(plan.adjust(await actor.golovkin(), { month: prev, product: "osago", metric: "crWeb", value: 0.12, seen: lbe.crWeb ?? null, reason: "conversion", comment: "Задним числом" }), /закрыт/);
  });

  it("ссылку на источник и служебный аккаунт видят только те, кто загружает", async () => {
    await load();
    const leader = await plan.monthPlan(await actor.golovkin(), month);
    expect(leader.source.sourceId).toBe("");
    expect(leader.source.serviceEmail).toBeNull();
    const owner = await plan.monthPlan(await actor.owner(), month);
    expect(owner.source.sourceId).toBe(plan.LRF_MIRROR_ID);
    expect(owner.canSource).toBe(true);
  });
});

describe("команда продукта", () => {
  it("владелец меняет, кто корректирует продукт; чужие и неизвестные люди не проходят", async () => {
    await load();
    await expectRule(plan.setOwners(await actor.reva(), "osago", ["loginova"]), /режиме управления/);
    await expectRule(plan.setOwners(await actor.owner(), "osago", ["nobody"]), /Нет такого сотрудника/);
    await expectRule(plan.setOwners(await actor.owner(), "nope", ["loginova"]), /Нет такого продукта/);
    const owners = await plan.setOwners(await actor.admin(), "osago", ["loginova", "loginova"]);
    expect(owners.map((o) => o.slug)).toEqual(["loginova"]);
    await expectRule(adjust(await actor.golovkin(), { metric: "crWeb", value: 0.12 }), /корректирует его команда/);
    await adjust(await actor.loginova(), { metric: "crWeb", value: 0.12, comment: "Теперь ОСАГО ведёт другая команда" });
    const view = await plan.monthPlan(await actor.loginova(), month);
    expect(view.products.find((p) => p.code === "osago")!.owners.map((o) => o.slug)).toEqual(["loginova"]);
    const audit = await prisma.auditLog.findFirst({ where: { action: "plan.owners" }, orderBy: { at: "desc" } });
    expect(audit?.before).toMatch(/Головкин/);
    expect(audit?.after).toMatch(/Логинова/);
  });

  it("источник LRF меняет только владелец, рабочий Bord источником быть не может", async () => {
    await expectRule(plan.setPlanSource(await actor.admin(), plan.LRF_SHEET_ID), /владелец/);
    await expectRule(plan.setPlanSource(await actor.owner(), "не ссылка"), /ссылку/);
    await expectRule(plan.setPlanSource(await actor.owner(), `https://docs.google.com/spreadsheets/d/${PROD_SHEET_ID}/edit`), /рабочий Bord/);
    expect(await plan.setPlanSource(await actor.owner(), "https://docs.google.com/spreadsheets/d/1d6Dbxr7qg9-2d4FgIxLawGEAcMcTR_kMbWh7uPD1uQc/edit#gid=0")).toBe("1d6Dbxr7qg9-2d4FgIxLawGEAcMcTR_kMbWh7uPD1uQc");
  });
});
