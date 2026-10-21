// Этап 58: единая воронка, шаг 1. Хаб «Единая воронка: данные» в имитации: проверка и загрузка снимка «Все СК» на день и
// плана ОСАГО по СК, ранрейт по СК в карточке ОСАГО, кто видит выручку и КВ по СК, права на загрузку и смену хаба, журнал.
// Правки по проверке: сломанный лист плана не затирает план, неполный «Все СК» не проходит молча, повторы, снимок хранит
// только текущий и прошлый месяц, факт по вчерашний день (решение владельца), выручка с апсейлом, общий логин, названия СК,
// загрузка двумя независимыми частями
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as plan from "@/lib/plan/service";
import * as hub from "@/lib/plan/hub-service";
import { planBrief } from "@/lib/plan/processes";
import { NUMBERS_ACCESS_KEY, NUMBERS_CLOSED_TEXT, NUMBERS_SUMMARY_TEXT, briefFor, numbersLevel } from "@/lib/plan/access";
import { HUB_FAKE_SK } from "@/lib/plan/hub-imitation";
import { HUB_LIMITS, HUB_SHEETS, daysIn } from "@/lib/plan/hub";
import { LRF_MIRROR_ID, LRF_SHEET_ID } from "@/lib/plan/lrf";
import { addMonths } from "@/lib/forecast/codes";
import { moscowToday } from "@/lib/tasks/dates";
import { PROD_SHEET_ID } from "@/lib/sheet/client";
import * as actions from "@/app/(app)/forecast/actions";

// Действия экрана вызываются напрямую: вход и кеш страниц подменены, человек задаётся тестом
const runner = vi.hoisted(() => ({ actor: null as tasks.Actor | null, settingReads: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/action-runner", async () => {
  const { TaskRuleError } = await import("@/lib/tasks/service");
  return {
    currentActor: async () => runner.actor!,
    runAction: async <T,>(_what: string, fn: (a: tasks.Actor) => Promise<T>) => {
      try {
        return { ok: true as const, value: await fn(runner.actor!) };
      } catch (error) {
        if (error instanceof TaskRuleError) return { ok: false as const, error: error.message };
        throw error;
      }
    },
  };
});
// Настройки читаются как есть, тест только считает, какие ключи читались
vi.mock("@/lib/settings", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/settings")>();
  return {
    ...real,
    getSetting: async <T,>(key: string, fallback: T): Promise<T> => {
      runner.settingReads.push(key);
      return real.getSetting(key, fallback);
    },
  };
});

const actor = {
  owner: () => tasks.actorFor("muradyan", "OWNER"),
  admin: () => tasks.actorFor("golovkin", "ADMIN"),
  golovkin: () => tasks.actorFor("golovkin"),
  fatyanov: () => tasks.actorFor("fatyanov"),
  sakhibullina: () => tasks.actorFor("sakhibullina"),
  observer: () => tasks.actorFor("ceo"),
};
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

const month = plan.currentMonth();
const prevMonth = addMonths(month, -1);
const nextMonth = addMonths(month, 1);
const today = moscowToday();
// Дни текущего месяца в полдень по Москве: тесты не зависят от того, какое сегодня число
const [Y, M] = month.split("-").map(Number) as [number, number];
const at = (d: number, monthOffset = 0) => new Date(Date.UTC(Y, M - 1 + monthOffset, d, 9));
const dayOf = (d: number, monthOffset = 0) => moscowToday(at(d, monthOffset));
const NOW = at(22);
const TODAY = dayOf(22);
const HUB_ID = "1HubTestAbcdefghijklmnopqrstuvwxyz0123456789";
const LINK = `https://docs.google.com/spreadsheets/d/${HUB_ID}/edit`;

/** Листы имитации на день now: тест портит их, как человек портит хаб */
const grids = (now = NOW) => {
  const fake = hub.imitationHub(now);
  return { vse: fake.tab(HUB_SHEETS.vseSk), plan: fake.tab(HUB_SHEETS.skPlan) };
};
// Колонки имитации «Все СК» и плана
const V = { month: 0, sk: 1, pool: 2, pol: 4, rev: 7, upsRev: 10 };
const P = { sk: 0, code: 4, prev: 6, month: 7, fy: 8 };

const clean = async () => {
  delete (globalThis as { __hubFake?: unknown }).__hubFake;
  runner.settingReads = [];
  await prisma.inboxEvent.deleteMany({ where: { kind: "PLAN" } });
  await prisma.planSkSnapshot.deleteMany();
  await prisma.planSkLine.deleteMany();
  await prisma.planFact.deleteMany();
  await prisma.planCheck.deleteMany();
  await prisma.planPull.deleteMany();
  await prisma.planPartnerAdjustment.deleteMany();
  await prisma.planPartnerTotal.deleteMany();
  await prisma.planPartner.deleteMany();
  await prisma.planAdjustment.deleteMany();
  await prisma.planLine.deleteMany();
  await prisma.setting.deleteMany({ where: { key: { startsWith: "plan." } } });
  await prisma.setting.deleteMany({ where: { key: { in: [NUMBERS_ACCESS_KEY, "bord.sourceId", "sheet.spreadsheetId", "numbers.sourceId"] } } });
  await prisma.person.deleteMany({ where: { slug: { startsWith: "hub-test-" } } });
  await prisma.person.update({ where: { slug: "ceo" }, data: { active: false } });
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

const totalMonthly = HUB_FAKE_SK.reduce((s, x) => s + x.monthly, 0);
const lastJournal = async () => String((await prisma.auditLog.findFirst({ where: { action: "plan.hub" }, orderBy: { at: "desc" } }))?.after ?? "");

describe("проверка и загрузка из хаба", () => {
  it("проверка читает оба листа, ничего не пишет; загрузка пишет снимок на сегодня и план по СК, журнал и отметку", async () => {
    const owner = await actor.owner();
    const preview = await hub.previewHub(owner, NOW);
    expect(preview.fact.problems).toEqual([]);
    expect(preview.plan.problems).toEqual([]);
    expect(preview.warnings).toEqual([]);
    expect(preview.ready).toBe(true);
    expect(preview.day).toBe(TODAY);
    expect(preview.factDay).toBe(dayOf(21));
    expect(preview.fact.info?.replaces).toBe(false);
    expect(preview.fact.info?.companies).toBe(HUB_FAKE_SK.length);
    expect(preview.fact.info?.stored).toEqual([prevMonth, month]);
    expect(preview.plan.info?.companies).toBe(HUB_FAKE_SK.length);
    expect(preview.plan.info?.planUnits).toBe(HUB_FAKE_SK.reduce((s, x) => s + Math.round(x.monthly * 1.05), 0));
    expect(await prisma.planSkSnapshot.count()).toBe(0);

    const r = await hub.applyHub(owner, NOW);
    expect(r.day).toBe(TODAY);
    // Два месяца, четыре СК, пул и без пула
    expect(r.fact).toMatchObject({ loaded: true, rows: 2 * HUB_FAKE_SK.length * 2, months: [prevMonth, month], problem: null });
    expect(r.plan.loaded).toBe(true);
    expect(await prisma.planSkSnapshot.count({ where: { month } })).toBe(HUB_FAKE_SK.length * 2);
    expect(r.plan.rows).toBeGreaterThan(0);
    expect(await prisma.planSkLine.count({ where: { period: month, metric: "pol" } })).toBe(HUB_FAKE_SK.length + 1);
    const log = await prisma.auditLog.findFirst({ where: { action: "plan.hub" }, orderBy: { at: "desc" } });
    expect(log?.actorName).toBe(owner.fullName);
    expect(String(log?.after)).toContain(`снимок ${TODAY}: 16 строк за ${prevMonth}, ${month}`);
    expect(String(log?.after)).toContain("план по СК:");
    const again = await hub.previewHub(owner, NOW);
    expect(again.fact.info?.replaces).toBe(true);
  });

  it("повторная загрузка в тот же день заменяет снимок, а не удваивает его; строки плана заменяются целиком", async () => {
    const owner = await actor.owner();
    await hub.applyHub(owner, NOW);
    await prisma.planSkLine.create({ data: { period: "2020-01", sk: "Старая СК", metric: "pol", value: 1 } });
    await hub.applyHub(owner, NOW);
    expect(await prisma.planSkSnapshot.count({ where: { month } })).toBe(HUB_FAKE_SK.length * 2);
    expect(await prisma.planSkLine.count({ where: { sk: "Старая СК" } })).toBe(0);
  });

  it("загружают владелец и администраторы в режиме управления: лидер и наблюдатель получают отказ", async () => {
    await expectRule(hub.previewHub(await actor.golovkin()), /владелец и администраторы/);
    await expectRule(hub.applyHub(await actor.observer()), /владелец и администраторы/);
    await expect(hub.applyHub(await actor.admin())).resolves.toMatchObject({ day: today });
  });

  it("хаб задаёт только владелец: ссылка разбирается, рабочий Bord не принимается, смена попадает в журнал", async () => {
    const owner = await actor.owner();
    await expectRule(hub.setHubSource(await actor.admin(), LINK), /владелец/);
    await expectRule(hub.setHubSource(owner, "не ссылка"), /ссылку/);
    await expectRule(hub.setHubSource(owner, `https://docs.google.com/spreadsheets/d/${PROD_SHEET_ID}/edit`), /Bord/);
    const id = await hub.setHubSource(owner, `${LINK}#gid=5`);
    expect(id).toBe(HUB_ID);
    const log = await prisma.auditLog.findFirst({ where: { action: "plan.hubSource" }, orderBy: { at: "desc" } });
    expect(log?.after).toBe(id);
    const view = await plan.monthPlan(owner, month);
    expect(view.hubSource.sourceId).toBe(id);
    expect(view.hubSource.mode).toBe("imitation");
  });

  it("боевые таблицы из настроек ресурса хабом стать не могут: Bord задач, зеркало, LRF (и по умолчанию), цифры недели", async () => {
    const owner = await actor.owner();
    const ids = { bord: "1BordSourceAbcdefghijklmnopqrstuvwxyz012345", mirror: "1MirrorSheetAbcdefghijklmnopqrstuvwxyz01234", numbers: "1NumbersSrcAbcdefghijklmnopqrstuvwxyz012345", lrf: "1LrfCustomAbcdefghijklmnopqrstuvwxyz0123456" };
    await prisma.setting.createMany({
      data: [
        { key: "bord.sourceId", value: ids.bord },
        { key: "sheet.spreadsheetId", value: ids.mirror },
        { key: "numbers.sourceId", value: ids.numbers },
      ],
    });
    const journal = await prisma.auditLog.count({ where: { action: "plan.hubSource" } });
    await expectRule(hub.setHubSource(owner, ids.bord), /забирает задачи Bord/);
    await expectRule(hub.setHubSource(owner, ids.mirror), /просмотра задач/);
    await expectRule(hub.setHubSource(owner, ids.numbers), /цифр недели/);
    // LRF: пока владелец не задал свой, источник это таблица-связка по умолчанию; боевой LRF не принимается никогда
    await expectRule(hub.setHubSource(owner, LRF_MIRROR_ID), /источник LRF/);
    await expectRule(hub.setHubSource(owner, LRF_SHEET_ID), /боевой LRF/);
    await prisma.setting.create({ data: { key: "plan.sourceId", value: ids.lrf } });
    await expectRule(hub.setHubSource(owner, ids.lrf), /источник LRF/);
    expect(await prisma.setting.findUnique({ where: { key: "plan.hubId" } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "plan.hubSource" } })).toBe(journal);
    await expect(hub.setHubSource(owner, LINK)).resolves.toBe(HUB_ID);
  });
});

describe("сломанные листы: загрузка двумя частями", () => {
  it("лист плана с подписями на месте и значениями #REF! не затирает план: превью называет СК, грузится только снимок, журнал это видит", async () => {
    const owner = await actor.owner();
    await hub.applyHub(owner, NOW);
    const before = await prisma.planSkLine.findMany({ orderBy: [{ period: "asc" }, { sk: "asc" }, { metric: "asc" }], select: { period: true, sk: true, metric: true, value: true } });
    expect(before.length).toBeGreaterThan(0);
    const { plan: sheet } = grids();
    for (const row of sheet.grid.slice(3)) for (const j of [P.prev, P.month, P.fy]) row[j] = row[P.code] === "pol" ? "#N/A" : "#REF!";
    const preview = await hub.previewHub(owner, NOW);
    expect(preview.plan.ready).toBe(false);
    expect(preview.plan.problems.join(" ")).toMatch(/ошибки в ячейках у СК АльфаСтрахование, Ингосстрах/);
    expect(preview.plan.problems.join(" ")).toMatch(new RegExp(`у полисов за ${month} нет ни одного числа`));
    expect(preview.fact.ready).toBe(true);
    expect(preview.ready).toBe(true);

    const r = await hub.applyHub(owner, NOW);
    expect(r.fact.loaded).toBe(true);
    expect(r.plan).toMatchObject({ loaded: false, rows: 0 });
    expect(r.plan.problem).toMatch(/ошибки в ячейках/);
    const after = await prisma.planSkLine.findMany({ orderBy: [{ period: "asc" }, { sk: "asc" }, { metric: "asc" }], select: { period: true, sk: true, metric: true, value: true } });
    expect(after).toEqual(before);
    const journal = await lastJournal();
    expect(journal).toContain(`снимок ${TODAY}: 16 строк`);
    expect(journal).toContain("план по СК не загружен: Лист «План ОСАГО по СК»: ошибки в ячейках");
  });

  it("пропала колонка текущего месяца или у полисов за месяц пусто: план не грузится, причина понятна", async () => {
    const owner = await actor.owner();
    const { plan: sheet } = grids();
    sheet.grid[2]![P.month] = "Комментарий";
    expect((await hub.previewHub(owner, NOW)).plan.problems[0]).toMatch(new RegExp(`нет колонки текущего месяца ${month}`));
    delete (globalThis as { __hubFake?: unknown }).__hubFake;
    const fresh = grids();
    for (const row of fresh.plan.grid.slice(3)) if (row[P.code] === "pol") row[P.month] = "";
    const preview = await hub.previewHub(owner, NOW);
    expect(preview.plan.problems).toEqual([`Лист «${HUB_SHEETS.skPlan}»: у полисов за ${month} нет ни одного числа`]);
    expect(preview.fact.ready).toBe(true);
  });

  it("строка «Все СК» с нечитаемым POLICIES_CNT блокирует снимок, но не план; снимок не пишется", async () => {
    const owner = await actor.owner();
    const { vse } = grids();
    const row = vse.grid.findIndex((r) => r[V.sk] === "Ингосстрах" && r[V.pool] === "False");
    vse.grid[row]![V.pol] = "";
    const preview = await hub.previewHub(owner, NOW);
    expect(preview.fact.ready).toBe(false);
    expect(preview.fact.problems.join(" ")).toMatch(/не прочитаны строки у СК Ингосстрах/);
    expect(preview.plan.ready).toBe(true);
    const r = await hub.applyHub(owner, NOW);
    expect(r.fact).toMatchObject({ loaded: false, rows: 0 });
    expect(r.plan.loaded).toBe(true);
    expect(await prisma.planSkSnapshot.count()).toBe(0);
    expect(await prisma.planSkLine.count()).toBeGreaterThan(0);
    expect(await lastJournal()).toContain(`снимок ${TODAY} не загружен: Лист «${HUB_SHEETS.vseSk}»: не прочитаны строки у СК Ингосстрах`);
  });

  it("лист «Все СК» длиннее лимита строк не обрезается молча: снимок не грузится; шире лимита колонок: предупреждение", async () => {
    const owner = await actor.owner();
    const { vse } = grids();
    vse.rows = HUB_LIMITS.vseSkRows + 1;
    vse.cols = HUB_LIMITS.cols + 5;
    const preview = await hub.previewHub(owner, NOW);
    expect(preview.fact.ready).toBe(false);
    expect(preview.fact.problems[0]).toMatch(/больше 5\s000 строк \(в листе 5\s001\)/);
    expect(preview.fact.warnings.join(" ")).toMatch(/шире 60 колонок/);
    expect(preview.plan.ready).toBe(true);
  });

  it("обе части сломаны: загрузка отказывает с причинами обеих и ничего не пишет", async () => {
    const owner = await actor.owner();
    const { vse, plan: sheet } = grids();
    vse.grid[1]![V.pol] = "#REF!";
    sheet.grid[2]![P.month] = "";
    const preview = await hub.previewHub(owner, NOW);
    expect(preview.ready).toBe(false);
    const journal = await prisma.auditLog.count({ where: { action: "plan.hub" } });
    await expectRule(hub.applyHub(owner, NOW), /Не загружено: Лист «src\.Все СК data_runrate»: ошибки в ячейках.*; Лист «План ОСАГО по СК»: нет колонки/);
    expect(await prisma.planSkSnapshot.count()).toBe(0);
    expect(await prisma.planSkLine.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "plan.hub" } })).toBe(journal);
    expect(await prisma.setting.findUnique({ where: { key: "plan.hubPulled" } })).toBeNull();
  });

  it("повтор ключа в «Все СК» складывается и не роняет загрузку ошибкой уникальности", async () => {
    const owner = await actor.owner();
    const { vse } = grids();
    const i = vse.grid.findIndex((r, k) => k > 0 && r[V.sk] === "Росгосстрах" && r[V.pool] === "False" && r[V.month] === vse.grid[vse.grid.length - 1]![V.month]);
    const copy = [...vse.grid[i]!];
    copy[V.sk] = "  росгосстрах ";
    vse.grid.push(copy);
    const preview = await hub.previewHub(owner, NOW);
    expect(preview.fact.ready).toBe(true);
    await hub.applyHub(owner, NOW);
    const row = await prisma.planSkSnapshot.findFirstOrThrow({ where: { month, sk: "Росгосстрах", pool: false } });
    expect(row.policies).toBe(2 * Number(vse.grid[i]![V.pol]));
    expect(await prisma.planSkSnapshot.count({ where: { month } })).toBe(HUB_FAKE_SK.length * 2);
  });

  it("повтор строки СК в плане это проблема с названием СК, снимок при этом грузится", async () => {
    const owner = await actor.owner();
    const { plan: sheet } = grids();
    const dup = sheet.grid.find((r) => r[P.sk] === "Ингосстрах" && r[P.code] === "pol")!;
    sheet.grid.push(["ИНГОССТРАХ", ...dup.slice(1)]);
    const preview = await hub.previewHub(owner, NOW);
    expect(preview.plan.problems[0]).toMatch(/строка повторяется у СК ИНГОССТРАХ \(например, ИНГОССТРАХ: pol, строки/);
    const r = await hub.applyHub(owner, NOW);
    expect(r.fact.loaded).toBe(true);
    expect(r.plan.loaded).toBe(false);
  });
});

describe("снимок дня: месяцы, закрытие, предупреждения", () => {
  it("снимок хранит только текущий и прошлый месяц, старые месяцы листа не копятся", async () => {
    const owner = await actor.owner();
    const { vse } = grids();
    const old = vse.grid.slice(1, 3).map((r) => [...r]);
    for (const offset of [-2, -5]) {
      for (const r of old) vse.grid.push([`${addMonths(month, offset)}-01`, ...r.slice(1)]);
    }
    const preview = await hub.previewHub(owner, NOW);
    expect(preview.fact.info?.months).toEqual([addMonths(month, -5), addMonths(month, -2), prevMonth, month]);
    expect(preview.fact.info?.stored).toEqual([prevMonth, month]);
    await hub.applyHub(owner, NOW);
    const months = (await prisma.planSkSnapshot.findMany({ distinct: ["month"], select: { month: true }, orderBy: { month: "asc" } })).map((r) => r.month);
    expect(months).toEqual([prevMonth, month]);
  });

  it("закрытие месяца: снимок 1-го числа даёт итог прошлого месяца, подпись и счётчик дней в его пределах; текущий месяц 1-го без факта", async () => {
    const owner = await actor.owner();
    await hub.applyHub(owner, at(22));
    const first = at(1, 1);
    // В листе 1-го числа уже есть строки нового месяца: по правилу владельца они в снимок не идут
    const { vse } = grids(first);
    for (const r of vse.grid.slice(1, 3)) vse.grid.push([`${nextMonth}-01`, ...r.slice(1)]);
    const preview = await hub.previewHub(owner, first);
    expect(preview.fact.info?.stored).toEqual([month]);
    expect(preview.factDay).toBe(`${month}-${String(daysIn(month)).padStart(2, "0")}`);
    expect(preview.fact.ready).toBe(true);
    expect(preview.fact.warnings.join(" ")).toMatch(/появится завтра/);
    await hub.applyHub(owner, first);
    // Снимок 1-го числа хранит только закрываемый месяц
    expect((await prisma.planSkSnapshot.findMany({ where: { day: new Date(`${dayOf(1, 1)}T00:00:00Z`) }, distinct: ["month"], select: { month: true } })).map((r) => r.month)).toEqual([month]);

    const closed = (await hub.skView(owner, month, first))!;
    expect(closed.day).toBe(`${month}-${daysIn(month)}`);
    expect(closed.loadDay).toBe(dayOf(1, 1));
    expect(closed.elapsed).toBe(daysIn(month));
    expect(closed.factTomorrow).toBe(false);
    expect(closed.stale).toBe(false);
    expect(closed.total.linear).toBe(closed.total.mtd);
    expect(closed.total.mtd! / totalMonthly).toBeCloseTo(1, 3);

    const fresh = (await hub.skView(owner, nextMonth, first))!;
    expect(fresh.factTomorrow).toBe(true);
    expect(fresh.day).toBeNull();
    expect(fresh.rows.length).toBe(HUB_FAKE_SK.length);
    expect(fresh.rows.every((r) => r.mtd === null && r.forecast === null && r.plan !== null)).toBe(true);
    expect(fresh.total.forecast).toBeNull();
  });

  it("1-го числа без строк прошлого месяца снимок не грузится: закрывать нечем", async () => {
    const owner = await actor.owner();
    const first = at(1, 1);
    const { vse } = grids(first);
    for (const r of vse.grid.slice(1)) r[V.month] = `${nextMonth}-01`;
    const preview = await hub.previewHub(owner, first);
    expect(preview.fact.ready).toBe(false);
    expect(preview.fact.problems[0]).toMatch(/закрывает прошлый месяц, а закрывать нечем/);
    expect(preview.plan.ready).toBe(true);
  });

  it("2-го числа факт текущего месяца за 1-е, день 1 из N; снимок 1-го в текущий месяц не попадает", async () => {
    const owner = await actor.owner();
    await hub.applyHub(owner, at(1));
    await hub.applyHub(owner, at(2));
    const sk = (await hub.skView(owner, month, at(2)))!;
    expect(sk.day).toBe(dayOf(1));
    expect(sk.loadDay).toBe(dayOf(2));
    expect(sk.elapsed).toBe(1);
    expect(sk.factTomorrow).toBe(false);
    expect(sk.profileDays).toBe(0);
  });

  it("в «Все СК» нет строк за текущий месяц: предупреждение говорит, что обновится только прошлый месяц, и так и происходит", async () => {
    const owner = await actor.owner();
    const { vse } = grids();
    const current = vse.grid[vse.grid.length - 1]![V.month];
    vse.grid = vse.grid.filter((r, k) => k === 0 || r[V.month] !== current);
    const preview = await hub.previewHub(owner, NOW);
    expect(preview.fact.ready).toBe(true);
    expect(preview.fact.warnings.join(" ")).toMatch(/обновит только .*, факт текущего месяца не появится/);
    expect(preview.fact.warnings.join(" ")).not.toMatch(/не будет сделан/);
    const r = await hub.applyHub(owner, NOW);
    expect(r.fact.months).toEqual([prevMonth]);
  });

  it("ни текущего, ни прошлого месяца в «Все СК»: снимок не из чего делать, план грузится", async () => {
    const owner = await actor.owner();
    const { vse } = grids();
    for (const r of vse.grid.slice(1)) r[V.month] = `${addMonths(month, -4)}-01`;
    const preview = await hub.previewHub(owner, NOW);
    expect(preview.fact.problems[0]).toMatch(/нет строк ни за/);
    expect(preview.plan.ready).toBe(true);
  });

  it("СК из прошлого снимка нет сегодня: предупреждение, не блок", async () => {
    const owner = await actor.owner();
    await hub.applyHub(owner, at(21));
    const { vse } = grids(at(22));
    vse.grid = vse.grid.filter((r) => r[V.sk] !== "СберСтрахование");
    const preview = await hub.previewHub(owner, at(22));
    expect(preview.fact.ready).toBe(true);
    expect(preview.fact.warnings.join(" ")).toMatch(new RegExp(`нет СК, которые были в снимке на ${dayOf(21).split("-").reverse().join("\\.")}: СберСтрахование`));
  });

  it("выручка-факт с апсейлом; без колонки апсейла предупреждение и выручка без апсейла", async () => {
    const owner = await actor.owner();
    await hub.applyHub(owner, NOW);
    const pool = await prisma.planSkSnapshot.findFirstOrThrow({ where: { month, sk: "АльфаСтрахование", pool: true } });
    // В имитации у строк пула выручка полисов 0, вся выручка из апсейла
    expect(pool.revenue).toBeCloseTo((pool.policies * 700) / 1.22, 2);
    const plain = await prisma.planSkSnapshot.findFirstOrThrow({ where: { month, sk: "АльфаСтрахование", pool: false } });
    expect(plain.revenue).toBeCloseTo((plain.policies * 7000 * 0.15) / 1.22, 2);

    const { vse } = grids();
    vse.grid[0]![V.upsRev] = "UPSALE_OTHER";
    const preview = await hub.previewHub(owner, NOW);
    expect(preview.fact.ready).toBe(true);
    expect(preview.fact.warnings.join(" ")).toMatch(/нет колонки UPSALE_REVENUE_WO_VAT, выручка-факт по СК без выручки апсейла/);
    await hub.applyHub(owner, NOW);
    expect((await prisma.planSkSnapshot.findFirstOrThrow({ where: { month, sk: "АльфаСтрахование", pool: true } })).revenue).toBe(0);
  });
});

describe("ОСАГО по СК в карточке", () => {
  it("до загрузки хаба раздела нет; после загрузки: план из модели, факт по вчерашний день, ранрейт линейный и итог", async () => {
    const owner = await actor.owner();
    await plan.applyPull(owner, month);
    expect((await plan.monthPlan(owner, month, NOW)).sk).toBeNull();
    await hub.applyHub(owner, NOW);
    const view = await plan.monthPlan(owner, month, NOW);
    const sk = view.sk!;
    expect(sk.day).toBe(dayOf(21));
    expect(sk.loadDay).toBe(TODAY);
    expect(sk.elapsed).toBe(21);
    expect(sk.factTomorrow).toBe(false);
    expect(sk.rows.map((r) => r.sk).sort()).toEqual(HUB_FAKE_SK.map((x) => x.sk).sort());
    const alfa = sk.rows.find((r) => r.sk === "АльфаСтрахование")!;
    const spec = HUB_FAKE_SK.find((x) => x.sk === "АльфаСтрахование")!;
    expect(alfa.plan).toBe(Math.round(spec.monthly * 1.05));
    // Имитация: факт пропорционален дням факта, значит линейный ранрейт попадает в месяц
    expect(alfa.mtd).toBeGreaterThan(0);
    expect(alfa.linear! / spec.monthly).toBeCloseTo(1, 2);
    expect(alfa.profile).toBeNull();
    expect(alfa.forecast).toBe(alfa.linear);
    expect(alfa.poolShare).toBeCloseTo(spec.pool, 1);
    expect(alfa.vsPlan).toBeCloseTo(1 / 1.05, 1);
    expect(sk.total.plan).toBe(HUB_FAKE_SK.reduce((s, x) => s + Math.round(x.monthly * 1.05), 0));
    expect(sk.total.mtd).toBe(sk.rows.reduce((s, r) => s + r.mtd!, 0));
    expect(sk.total.linear! / totalMonthly).toBeCloseTo(1, 2);
    expect(sk.lbeUnits).not.toBeNull();
    expect(sk.stale).toBe(false);
    expect(sk.profileDays).toBe(0);
    expect(sk.canPull).toBe(true);
    expect(sk.canSource).toBe(true);
    // Карточке ОСАГО раздел нужен только в этом продукте: в представлении он один на месяц
    expect(view.products.some((p) => p.code === "osago")).toBe(true);
  });

  it("представление месяца читает источник хаба один раз и отдаёт его разделу по СК", async () => {
    const owner = await actor.owner();
    await hub.applyHub(owner, NOW);
    runner.settingReads = [];
    const view = await plan.monthPlan(owner, month, NOW);
    expect(view.sk).not.toBeNull();
    expect(runner.settingReads.filter((k) => k === "plan.hubId")).toHaveLength(1);
    expect(view.sk!.source).toEqual(view.hubSource);
  });

  it("выручку и КВ по СК видят управление, команда ОСАГО и команда партнёрского канала; КАСКО и наблюдатель их не видят", async () => {
    const owner = await actor.owner();
    await plan.applyPull(owner, month);
    await hub.applyHub(owner, NOW);
    const see = async (who: tasks.Actor) => (await plan.monthPlan(who, month, NOW)).sk!;
    const ownerSk = await see(owner);
    expect(ownerSk.sensitive).toBe(true);
    expect(ownerSk.rows[0]!.revenueMtd).not.toBeNull();
    expect(ownerSk.rows[0]!.kvPlan).toBeGreaterThan(0);
    expect((await see(await actor.golovkin())).sensitive).toBe(true);
    expect((await see(await actor.sakhibullina())).sensitive).toBe(true);
    const kasko = await see(await actor.fatyanov());
    expect(kasko.sensitive).toBe(false);
    expect(kasko.rows.every((r) => r.revenueMtd === null && r.kvPlan === null)).toBe(true);
    expect(kasko.total.revenueMtd).toBeNull();
    // Полисы и план видны всем
    expect(kasko.rows[0]!.mtd).not.toBeNull();
    expect(kasko.canPull).toBe(false);
    expect(kasko.source.sourceId).toBe("");
    expect(kasko.source.serviceEmail).toBeNull();
    // Наблюдатель с открытыми всеми цифрами (этап 57) видит раздел, но не выручку и КВ
    await prisma.person.update({ where: { slug: "ceo" }, data: { active: true } });
    await prisma.setting.create({ data: { key: NUMBERS_ACCESS_KEY, value: { full: { units: [], people: ["ceo"] }, summary: { topManagement: true, units: [], people: [] } } } });
    const obs = await see(await actor.observer());
    expect(obs.sensitive).toBe(false);
    expect(obs.canPull).toBe(false);
    expect(obs.source.sourceId).toBe("");
    expect(obs.source.serviceEmail).toBeNull();
  });

  it("под общим логином выручка и КВ по СК скрыты, кроме режима владельца: под общим логином можно выбрать чужой профиль", async () => {
    const owner = await actor.owner();
    await hub.applyHub(owner, NOW);
    const team = (a: tasks.Actor): tasks.Actor => ({ ...a, via: "TEAM" });
    const leader = (await hub.skView(team(await actor.golovkin()), month, NOW))!;
    expect(leader.sensitive).toBe(false);
    expect(leader.rows.every((r) => r.revenueMtd === null && r.kvPlan === null)).toBe(true);
    expect(leader.rows[0]!.mtd).not.toBeNull();
    expect(await hub.seesSensitive(team(await actor.admin()))).toBe(false);
    expect(await hub.seesSensitive(team(await actor.sakhibullina()))).toBe(false);
    expect(await hub.seesSensitive(team(owner))).toBe(true);
    expect(await hub.seesSensitive({ ...(await actor.golovkin()), via: "EMAIL" })).toBe(true);
  });

  it("команду ОСАГО можно сменить: новый участник видит чувствительные показатели, старый перестаёт", async () => {
    const owner = await actor.owner();
    await plan.applyPull(owner, month);
    await hub.applyHub(owner, NOW);
    await plan.setOwners(owner, "osago", ["fatyanov"]);
    expect((await plan.monthPlan(await actor.fatyanov(), month, NOW)).sk!.sensitive).toBe(true);
    expect((await plan.monthPlan(await actor.golovkin(), month, NOW)).sk!.sensitive).toBe(false);
  });

  it("названия СК сводятся без регистра и пробелов, «Итого» в любом написании это итог; несовпавшие названия в превью", async () => {
    const owner = await actor.owner();
    const { plan: sheet } = grids();
    for (const row of sheet.grid) {
      if (row[P.sk] === "Ингосстрах") row[P.sk] = "  ингосстрах ";
      if (row[P.sk] === "Росгосстрах") row[P.sk] = "Росгосстрах СК";
      if (row[P.sk] === "ИТОГО") row[P.sk] = "Итого";
    }
    const preview = await hub.previewHub(owner, NOW);
    expect(preview.plan.ready).toBe(true);
    expect(preview.warnings).toHaveLength(1);
    expect(preview.warnings[0]).toMatch(/есть в плане, нет в «Все СК»: Росгосстрах СК; есть в «Все СК», нет в плане: Росгосстрах$/);
    expect(preview.warnings[0]).not.toMatch(/ингосстрах/i);
    await hub.applyHub(owner, NOW);
    const sk = (await hub.skView(owner, month, NOW))!;
    const ingo = sk.rows.filter((r) => /ингосстрах/i.test(r.sk));
    expect(ingo).toHaveLength(1);
    expect(ingo[0]!.plan).not.toBeNull();
    expect(ingo[0]!.mtd).not.toBeNull();
    expect(sk.rows.map((r) => r.sk)).toContain("Росгосстрах СК");
    expect(sk.rows.some((r) => /итого/i.test(r.sk))).toBe(false);
    expect(sk.total.plan).toBe(HUB_FAKE_SK.reduce((s, x) => s + Math.round(x.monthly * 1.05), 0));
  });

  it("снимок старше вчерашнего помечается устаревшим, а серия дневных снимков включает профиль дней недели", async () => {
    const owner = await actor.owner();
    await plan.applyPull(owner, month);
    // Загрузки со 2-го по 15-е: факт с 1-го по 14-е, 13 дневных фактов
    for (let d = 2; d <= 15; d++) await hub.applyHub(owner, at(d));
    const sk = (await hub.skView(owner, month, at(17)))!;
    expect(sk.stale).toBe(true);
    expect(sk.day).toBe(dayOf(14));
    expect(sk.profileDays).toBe(13);
    expect(sk.total.profile).toBeNull();
    await hub.applyHub(owner, at(16));
    const fresh = (await hub.skView(owner, month, at(17)))!;
    expect(fresh.stale).toBe(false);
    expect(fresh.profileDays).toBe(14);
    expect(fresh.total.profile).not.toBeNull();
    // Имитация равномерная по дням: профиль и линейный ранрейт совпадают, месяц стабильный
    expect(fresh.total.profile! / fresh.total.linear!).toBeCloseTo(1, 1);
    expect(fresh.total.unstable).toBe(false);
  });
});

describe("доступ к цифрам хаба по уровням этапа 57", () => {
  // Двое вне команд продуктов и топ-команды: один с основными цифрами из настройки, другой без цифр
  const levels = async () => {
    for (const [slug, fullName] of [
      ["hub-test-summary", "Сводкин Сергей"],
      ["hub-test-none", "Закрытов Захар"],
    ]) {
      await prisma.person.create({ data: { slug, fullName, shortName: fullName.split(" ")[1]!, role: "EMPLOYEE", zone: "Тест доступа" } });
    }
    await prisma.setting.create({ data: { key: NUMBERS_ACCESS_KEY, value: { full: { units: [], people: [] }, summary: { topManagement: false, units: [], people: ["hub-test-summary"] } } } });
    const summary = await tasks.actorFor("hub-test-summary");
    const none = await tasks.actorFor("hub-test-none");
    expect(await numbersLevel(summary)).toBe("summary");
    expect(await numbersLevel(none)).toBe("none");
    return { summary, none };
  };
  const loaded = async () => {
    const owner = await actor.owner();
    await plan.applyPull(owner, month);
    await hub.applyHub(owner);
  };

  it("основные цифры и закрытый уровень: проверка, загрузка и ссылка на хаб отказывают текстом уровня и ничего не пишут", async () => {
    await loaded();
    const { summary, none } = await levels();
    const snapshots = await prisma.planSkSnapshot.count();
    const journal = await prisma.auditLog.count({ where: { action: { in: ["plan.hub", "plan.hubSource"] } } });
    for (const [who, text] of [
      [summary, NUMBERS_SUMMARY_TEXT],
      [none, NUMBERS_CLOSED_TEXT],
    ] as const) {
      runner.actor = who;
      expect(await actions.previewHubAction()).toEqual({ ok: false, error: text });
      expect(await actions.applyHubAction()).toEqual({ ok: false, error: text });
      expect(await actions.setHubSourceAction(LINK)).toEqual({ ok: false, error: text });
    }
    expect(await prisma.planSkSnapshot.count()).toBe(snapshots);
    expect(await prisma.auditLog.count({ where: { action: { in: ["plan.hub", "plan.hubSource"] } } })).toBe(journal);
    expect(await prisma.setting.findUnique({ where: { key: "plan.hubId" } })).toBeNull();
  });

  it("основные цифры получают сводку месяца без разреза по СК, закрытый уровень ничего; представление месяца без раздела по СК", async () => {
    await loaded();
    const { summary, none } = await levels();
    expect((await plan.monthPlan(summary, month)).sk).toBeNull();
    expect((await plan.monthPlan(none, month)).sk).toBeNull();
    const brief = briefFor("summary", await planBrief(summary, month));
    expect(brief).not.toBeNull();
    expect(brief).not.toHaveProperty("sk");
    const text = JSON.stringify(brief);
    for (const x of HUB_FAKE_SK) expect(text).not.toContain(x.sk);
    expect(briefFor("none", await planBrief(none, month))).toBeNull();
  });

  it("все цифры: владелец в режиме управления проверяет, загружает и задаёт хаб через действия; без прав управления отказ по роли остаётся", async () => {
    const owner = await actor.owner();
    await plan.applyPull(owner, month);
    runner.actor = owner;
    const preview = await actions.previewHubAction();
    expect(preview.ok && preview.value.ready).toBe(true);
    expect(await actions.applyHubAction()).toMatchObject({ ok: true, value: { day: today, fact: { loaded: true }, plan: { loaded: true } } });
    expect(await actions.setHubSourceAction(LINK)).toEqual({ ok: true, value: HUB_ID });
    // Лидер ОСАГО со всеми цифрами, но без режима управления: уровень пропускает, сервис отказывает по роли
    runner.actor = await actor.golovkin();
    expect(await numbersLevel(runner.actor)).toBe("full");
    expect(await actions.previewHubAction()).toMatchObject({ ok: false, error: expect.stringMatching(/владелец и администраторы/) });
    expect(await actions.applyHubAction()).toMatchObject({ ok: false, error: expect.stringMatching(/владелец и администраторы/) });
    // Ссылку на хаб задаёт только владелец: администратор в режиме управления получает отказ
    runner.actor = await actor.admin();
    expect(await actions.setHubSourceAction(LINK)).toMatchObject({ ok: false, error: expect.stringMatching(/владелец/) });
    // Со всеми цифрами раздел по СК приходит и без режима управления
    expect((await plan.monthPlan(await actor.fatyanov(), month)).sk?.rows.length).toBe(HUB_FAKE_SK.length);
  });
});
