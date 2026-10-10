// Этап 35б: партнёрский канал в прогнозе месяца. Загрузка партнёров и бюджета канала вместе с LBE, корректировка
// драйверов партнёра командой канала, проверка прогноза, события и сводка
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as plan from "@/lib/plan/service";
import * as proc from "@/lib/plan/processes";
import { derivePartner, type PartnerValues } from "@/lib/plan/partners";
import { addMonths } from "@/lib/forecast/codes";

const actor = {
  owner: () => tasks.actorFor("muradyan", "OWNER"),
  golovkin: () => tasks.actorFor("golovkin"),
  sakhibullina: () => tasks.actorFor("sakhibullina"),
  afanasyev: () => tasks.actorFor("afanasyev"),
  team: async (): Promise<tasks.Actor> => ({ ...(await tasks.actorFor("sakhibullina")), via: "TEAM" }),
  observer: () => tasks.actorFor("ceo"),
};
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

const month = plan.currentMonth();

const clean = async () => {
  await prisma.inboxEvent.deleteMany({ where: { kind: "PLAN" } });
  await prisma.planPartnerAdjustment.deleteMany();
  await prisma.planPartnerTotal.deleteMany();
  await prisma.planPartner.deleteMany();
  await prisma.planCheck.deleteMany();
  await prisma.planPull.deleteMany();
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
const view = async (who?: tasks.Actor) => plan.monthPlan(who ?? (await actor.sakhibullina()), month);
const line = async (label: string, product = "osago") => (await view()).partners!.lines.find((l) => l.label === label && l.product === product)!;
const adjustPartner = async (who: tasks.Actor, label: string, metric: string, value: number | null, extra: { seen?: number | null; reason?: string; comment?: string; product?: string } = {}) => {
  const l = await line(label, extra.product);
  const seen = extra.seen !== undefined ? extra.seen : (l.drivers[metric as keyof typeof l.drivers] ?? derivePartner(l.lbe)[metric as keyof PartnerValues] ?? null);
  return proc.adjustPartner(who, { month, partner: l.code, metric, value, seen, reason: extra.reason ?? "partner-sk", comment: extra.comment ?? "Партнёр подтвердил объём на октябрь" });
};
/** Убрать вкладку из имитации на время теста и вернуть обратно */
const withoutTab = async (title: string, fn: () => Promise<void>) => {
  const fake = plan.imitationLrf();
  const tab = fake.tabs.get(title)!;
  fake.tabs.delete(title);
  try {
    await fn();
  } finally {
    fake.tabs.set(title, tab);
  }
};

describe("загрузка партнёрского канала вместе с LBE", () => {
  it("проверка показывает партнёров и бюджет канала; загрузка пишет партнёров, бюджет и LBE канала", async () => {
    const preview = await plan.previewPull(await actor.owner(), month);
    expect(preview.ready).toBe(true);
    expect(preview.partners).toMatchObject({ found: true, ready: true, problems: [], warnings: [], lines: 12, before: 0 });
    expect(preview.partners.revenue.budget).toBeCloseTo(41 + 2.12 + 18 + 3.2, 6);
    await load();
    expect(await prisma.planPartner.count({ where: { month } })).toBe(12);
    expect(await prisma.planPartnerTotal.count({ where: { month, version: "BUDGET" } })).toBeGreaterThan(0);
    const v = await view();
    expect(v.partners!.lines).toHaveLength(12);
    expect(v.partners!.owners.map((o) => o.name)).toEqual(["Сахибуллина Алсу", "Афанасьев Павел"]);
    expect(v.partners!.canAdjust).toBe(true);
    expect(v.partners!.review?.state).toBe("waiting");
    expect(v.canAdjustAny).toBe(true);
    // Головкин не в команде канала: видит, но не корректирует
    const g = await view(await actor.golovkin());
    expect(g.partners!.canAdjust).toBe(false);
    const audit = await prisma.auditLog.findFirst({ where: { action: "plan.pull" }, orderBy: { at: "desc" } });
    expect(audit!.after).toMatch(/партнёрский канал, партнёров: 12/);
  });

  it("листов b2b в источнике нет: продукты загружаются, партнёров нет, в проверке сказано почему", async () => {
    const fake = plan.imitationLrf();
    const titles = [...fake.tabs.keys()].filter((t) => t.startsWith("B2B. "));
    const saved = titles.map((t) => [t, fake.tabs.get(t)!] as const);
    for (const t of titles) fake.tabs.delete(t);
    try {
      const preview = await plan.previewPull(await actor.owner(), month);
      expect(preview.ready).toBe(true);
      expect(preview.partners).toMatchObject({ found: false, ready: false, lines: 0 });
      await load();
      expect((await view()).partners).toBeNull();
      expect(await prisma.inboxEvent.count({ where: { kind: "PLAN", recipient: { slug: "sakhibullina" } } })).toBe(0);
    } finally {
      for (const [t, tab] of saved) fake.tabs.set(t, tab);
    }
  });

  it("листы b2b с проблемой: продукты загружаются, прежние партнёры остаются и не просят проверки заново", async () => {
    await load();
    await adjustPartner(await actor.sakhibullina(), "Банк Север", "policies", 22_000);
    await withoutTab("B2B. AGENTS RED LRF", async () => {
      const preview = await plan.previewPull(await actor.owner(), month);
      expect(preview.ready).toBe(true);
      expect(preview.partners.ready).toBe(false);
      expect(preview.partners.problems).toEqual(["Нет листа «B2B. AGENTS RED LRF»"]);
      expect(preview.partners.before).toBe(12);
      await load();
    });
    expect(await prisma.planPartner.count({ where: { month } })).toBe(12);
    expect((await line("Банк Север")).drivers.policies).toBe(22_000);
    // Партнёры прежние: канал проверен корректировкой после их загрузки, событий команде канала по новой загрузке нет
    const v = await view();
    expect(v.partners!.review?.state).toBe("adjusted");
    expect((await proc.planBrief(await actor.owner(), month))!.waiting.map((w) => w.product)).not.toContain("Партнёрский канал");
  });

  it("без бюджета канала в P&L партнёры загружаются, бюджет пустой", async () => {
    await withoutTab("B2B. PnL_b2b", async () => {
      const preview = await plan.previewPull(await actor.owner(), month);
      expect(preview.partners).toMatchObject({ ready: true, problems: [], warnings: ["Нет листа «B2B. PnL_b2b»: бюджета канала не будет"] });
      expect(preview.partners.revenue.budget).toBeNull();
      await load();
    });
    expect(await prisma.planPartner.count({ where: { month } })).toBe(12);
    expect(await prisma.planPartnerTotal.count({ where: { month } })).toBe(0);
  });

  it("повторная загрузка: коды партнёров те же, корректировки команды остаются", async () => {
    await load();
    const before = (await view()).partners!.lines.map((l) => l.code);
    await adjustPartner(await actor.sakhibullina(), "Банк Север", "policies", 22_000);
    await load();
    const after = (await view()).partners!;
    expect(after.lines.map((l) => l.code)).toEqual(before);
    expect(after.lines.find((l) => l.label === "Банк Север" && l.product === "osago")!.drivers).toEqual({ policies: 22_000 });
    // Следующий месяц загружается отдельно и своих партнёров не трогает
    await plan.applyPull(await actor.owner(), addMonths(month, 1));
    expect(await prisma.planPartner.count({ where: { month } })).toBe(12);
    expect(await prisma.planPartner.count({ where: { month: addMonths(month, 1) } })).toBe(12);
  });
});

describe("корректировка драйвера партнёра", () => {
  it("команда канала меняет полисы: прогноз, история, журнал, проверка и события", async () => {
    await load();
    const v = await adjustPartner(await actor.sakhibullina(), "Банк Север", "policies", 22_000);
    const l = v.partners!.lines.find((x) => x.label === "Банк Север" && x.product === "osago")!;
    expect(l.drivers).toEqual({ policies: 22_000 });
    expect(l.last.policies).toMatchObject({ value: 22_000, previous: 20_000, reason: "partner-sk", reasonLabel: "Партнёр или СК", author: { name: "Сахибуллина Алсу" } });
    expect(v.partners!.history[0]).toMatchObject({ partnerLabel: "Банк Север", metricLabel: "Полисы через Сравни", product: "osago", channel: "cpa" });
    expect(v.partners!.review?.state).toBe("adjusted");
    const audit = await prisma.auditLog.findFirst({ where: { action: "plan.partner" }, orderBy: { at: "desc" } });
    expect(audit!.field).toMatch(/^Партнёрский канал, CPA и отказной, ОСАГО, Банк Север, Полисы через Сравни/);
    expect(audit!.before).toBe("20 000");
    expect(audit!.after).toMatch(/^22 000\. Партнёр или СК: Партнёр подтвердил объём/);
    // У Сахибуллиной и Афанасьева других продуктов нет: «Проверьте прогноз» разобрано у обоих
    const open = await prisma.inboxEvent.findMany({ where: { kind: "PLAN", doneAt: null }, include: { recipient: { select: { slug: true } } } });
    expect(open.map((e) => e.recipient.slug)).not.toContain("sakhibullina");
    expect(open.map((e) => e.recipient.slug)).not.toContain("afanasyev");
  });

  it("комиссия в процентах, возврат к LBE, ноль в LBE у партнёра без продаж", async () => {
    await load();
    const who = await actor.afanasyev();
    await adjustPartner(who, "Агент API Один", "commission", 0.9);
    expect((await line("Агент API Один")).drivers.commission).toBe(0.9);
    await adjustPartner(who, "Агент API Один", "commission", null, { comment: "Комиссия осталась прежней" });
    expect((await line("Агент API Один")).drivers).toEqual({});
    await expectRule(adjustPartner(who, "Агент API Один", "commission", null), /и так как в LBE/);
    // Банк Юг ещё не продаёт: выручки на полис в LBE нет, команда задаёт её
    await adjustPartner(who, "Банк Юг", "rpu", 1_000, { seen: null });
    await adjustPartner(who, "Банк Юг", "policies", 1_000);
    expect((await line("Банк Юг")).drivers).toEqual({ rpu: 1_000, policies: 1_000 });
  });

  it("правила: команда канала, личный вход, наблюдатель, прошлый месяц, драйверы, свежесть, границы", async () => {
    await load();
    await expectRule(adjustPartner(await actor.golovkin(), "Банк Север", "policies", 21_000), /корректирует его команда/);
    await expectRule(adjustPartner(await actor.team(), "Банк Север", "policies", 21_000), /при личном входе/);
    await expectRule(adjustPartner(await actor.observer(), "Банк Север", "policies", 21_000), /Наблюдатель/);
    await expectRule(adjustPartner(await actor.sakhibullina(), "Банк Север", "revenue", 30), /пересчитывается сам/);
    await expectRule(adjustPartner(await actor.sakhibullina(), "Банк Север", "policies", 21_000, { seen: 1 }), /уже поменяли/);
    await expectRule(adjustPartner(await actor.sakhibullina(), "Банк Север", "policies", 20_000_000), /вне разумных границ/);
    await expectRule(adjustPartner(await actor.sakhibullina(), "Банк Север", "commission", 3), /вне разумных границ/);
    await expectRule(adjustPartner(await actor.sakhibullina(), "Банк Север", "policies", 21_000, { comment: "ок" }), /одной фразой/);
    await expectRule(adjustPartner(await actor.sakhibullina(), "Банк Север", "policies", 21_000, { reason: "нет такой" }), /причину/);
    // Конверсии в кросс у ипотеки нет в LRF: это не драйвер
    await expectRule(adjustPartner(await actor.sakhibullina(), "Агенты", "crUpsale", 0.1, { product: "red-mortgage", seen: null }), /нет в LBE партнёра/);
    await expectRule(proc.adjustPartner(await actor.sakhibullina(), { month, partner: "нет-такого", metric: "policies", value: 1, seen: null, reason: "partner-sk", comment: "Партнёр подтвердил объём" }), /Партнёра нет в загрузке/);
    await expectRule(proc.adjustPartner(await actor.sakhibullina(), { month: addMonths(month, -1), partner: "x", metric: "policies", value: 1, seen: null, reason: "partner-sk", comment: "Партнёр подтвердил объём" }), /закрыт/);
    expect(await prisma.planPartnerAdjustment.count()).toBe(0);
  });
});

describe("корректировки, которые перестали действовать", () => {
  it("драйвер пропал из LBE (ёмкость у агентов): корректировка не влияет и не считается, но её можно снять", async () => {
    await load();
    const agents = await line("Агенты");
    await prisma.planPartnerAdjustment.create({ data: { month, partner: agents.code, metric: "capacity", value: 60_000, previous: null, reason: "PARTNER_SK", comment: "Старая правка ёмкости", authorId: (await prisma.person.findUniqueOrThrow({ where: { slug: "sakhibullina" } })).id } });
    const v = await view();
    const l = v.partners!.lines.find((x) => x.code === agents.code)!;
    expect(l.drivers).toEqual({ capacity: 60_000 });
    expect((await proc.planBrief(await actor.owner(), month))!.partnerReasons).toEqual([]);
    await expectRule(adjustPartner(await actor.sakhibullina(), "Агенты", "capacity", 70_000, { seen: 60_000 }), /нет в LBE партнёра/);
    await adjustPartner(await actor.sakhibullina(), "Агенты", "capacity", null, { seen: 60_000, comment: "Снять старую правку ёмкости" });
    expect((await line("Агенты")).drivers).toEqual({});
  });

  it("в сводке три свежие корректировки партнёров и число остальных партнёров с корректировками", async () => {
    await load();
    const who = await actor.sakhibullina();
    await adjustPartner(who, "Сервис штрафов", "rpu", 900);
    await adjustPartner(who, "Банк Север", "policies", 22_000);
    await adjustPartner(who, "Банк Север", "commission", 0.75);
    await adjustPartner(who, "Агент API Один", "policies", 6_000);
    const brief = (await proc.planBrief(await actor.owner(), month))!;
    expect(brief.partnerReasons.map((r) => r.product)).toEqual(["Агент API Один, ОСАГО", "Банк Север, ОСАГО", "Банк Север, ОСАГО"]);
    expect(brief.partnersMore).toBe(1);
    expect(proc.planBriefText(brief)).toContain("Ещё партнёров с корректировками: 1");
  });
});

describe("команда канала, проверка и сводка", () => {
  it("команду канала меняет владелец; «Прогноз проверен» отмечает команда, повтор и после корректировки нельзя", async () => {
    await load();
    await plan.setOwners(await actor.owner(), "b2b", ["afanasyev"]);
    expect((await view()).partners!.canAdjust).toBe(false);
    await expectRule(proc.checkPlan(await actor.sakhibullina(), month, "b2b"), /проверяет его команда/);
    const v = await proc.checkPlan(await actor.afanasyev(), month, "b2b");
    expect(v.partners!.review).toMatchObject({ state: "checked", by: "Афанасьев Павел" });
    await expectRule(proc.checkPlan(await actor.afanasyev(), month, "b2b"), /уже отмечен проверенным/);
    await adjustPartner(await actor.afanasyev(), "Сервис штрафов", "policies", 13_000);
    expect((await view()).partners!.review?.state).toBe("adjusted");
  });

  it("сводка для отчёта CEO: выручка и маржа канала, корректировки партнёров, канал в ждущих проверки", async () => {
    await load();
    let brief = (await proc.planBrief(await actor.owner(), month))!;
    expect(brief.partners).toMatchObject({ partners: 12, adjusted: 0 });
    expect(brief.waiting.map((w) => w.product)).toContain("Партнёрский канал");
    await adjustPartner(await actor.sakhibullina(), "Банк Север", "policies", 22_000);
    brief = (await proc.planBrief(await actor.owner(), month))!;
    expect(brief.partners!.revenue.forecast! - brief.partners!.revenue.lbe!).toBeCloseTo(2.16, 6);
    // Корректировки партнёров отдельным списком: причины продуктов они не вытесняют
    expect(brief.partnerReasons[0]).toMatchObject({ product: "Банк Север, ОСАГО", metric: "Полисы через Сравни", value: "22 000", lbe: "20 000" });
    expect(brief.reasons.some((r) => r.product.includes("Банк Север"))).toBe(false);
    expect(brief.waiting.map((w) => w.product)).not.toContain("Партнёрский канал");
    const text = proc.planBriefText(brief);
    expect(text.some((t) => t.startsWith("Партнёрский канал, внутри продуктов: выручка прогноз"))).toBe(true);
    expect(text).toContain("Корректировки партнёрского канала:");
    expect(text.some((t) => t.startsWith("- Банк Север, ОСАГО, полисы через Сравни: 22 000 вместо 20 000 по LBE"))).toBe(true);
  });
});
