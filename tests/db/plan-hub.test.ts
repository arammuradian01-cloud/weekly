// Этап 58: единая воронка, шаг 1. Хаб «Единая воронка: данные» в имитации: проверка и загрузка снимка «Все СК» на день и
// плана ОСАГО по СК, ранрейт по СК в карточке ОСАГО, кто видит выручку и КВ по СК, права на загрузку и смену хаба, журнал
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as plan from "@/lib/plan/service";
import * as hub from "@/lib/plan/hub-service";
import { planBrief } from "@/lib/plan/processes";
import { NUMBERS_ACCESS_KEY, NUMBERS_CLOSED_TEXT, NUMBERS_SUMMARY_TEXT, briefFor, numbersLevel } from "@/lib/plan/access";
import { HUB_FAKE_SK } from "@/lib/plan/hub-imitation";
import { moscowToday } from "@/lib/tasks/dates";
import { PROD_SHEET_ID } from "@/lib/sheet/client";
import * as actions from "@/app/(app)/forecast/actions";

// Действия экрана вызываются напрямую: вход и кеш страниц подменены, человек задаётся тестом
const runner = vi.hoisted(() => ({ actor: null as tasks.Actor | null }));
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
const today = moscowToday();
const DAY = 24 * 60 * 60 * 1000;

const clean = async () => {
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
  await prisma.setting.deleteMany({ where: { key: NUMBERS_ACCESS_KEY } });
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

describe("проверка и загрузка из хаба", () => {
  it("проверка читает оба листа, ничего не пишет; загрузка пишет снимок на сегодня и план по СК, журнал и отметку", async () => {
    const owner = await actor.owner();
    const preview = await hub.previewHub(owner);
    expect(preview.problems).toEqual([]);
    expect(preview.ready).toBe(true);
    expect(preview.day).toBe(today);
    expect(preview.replaces).toBe(false);
    expect(preview.vseSk?.companies).toBe(HUB_FAKE_SK.length);
    expect(preview.skPlan?.companies).toBe(HUB_FAKE_SK.length);
    expect(preview.skPlan?.planUnits).toBe(HUB_FAKE_SK.reduce((s, x) => s + Math.round(x.monthly * 1.05), 0));
    expect(await prisma.planSkSnapshot.count()).toBe(0);

    const r = await hub.applyHub(owner);
    expect(r.day).toBe(today);
    // Два месяца, четыре СК, пул и без пула
    expect(r.snapshots).toBe(2 * HUB_FAKE_SK.length * 2);
    expect(await prisma.planSkSnapshot.count({ where: { month } })).toBe(HUB_FAKE_SK.length * 2);
    expect(r.lines).toBeGreaterThan(0);
    expect(await prisma.planSkLine.count({ where: { period: month, metric: "pol" } })).toBe(HUB_FAKE_SK.length + 1);
    const log = await prisma.auditLog.findFirst({ where: { action: "plan.hub" }, orderBy: { at: "desc" } });
    expect(log?.actorName).toBe(owner.fullName);
    expect(String(log?.after)).toContain(`снимок ${today}`);
    const again = await hub.previewHub(owner);
    expect(again.replaces).toBe(true);
  });

  it("повторная загрузка в тот же день заменяет снимок, а не удваивает его; строки плана заменяются целиком", async () => {
    const owner = await actor.owner();
    await hub.applyHub(owner);
    await prisma.planSkLine.create({ data: { period: "2020-01", sk: "Старая СК", metric: "pol", value: 1 } });
    await hub.applyHub(owner);
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
    await expectRule(hub.setHubSource(await actor.admin(), "https://docs.google.com/spreadsheets/d/1KFYKwsRcxC98rHwxbAnV2s29IxQCicq4PVnB0AOEzsg/edit"), /владелец/);
    await expectRule(hub.setHubSource(owner, "не ссылка"), /ссылку/);
    await expectRule(hub.setHubSource(owner, `https://docs.google.com/spreadsheets/d/${PROD_SHEET_ID}/edit`), /Bord/);
    const id = await hub.setHubSource(owner, "https://docs.google.com/spreadsheets/d/1KFYKwsRcxC98rHwxbAnV2s29IxQCicq4PVnB0AOEzsg/edit#gid=5");
    expect(id).toBe("1KFYKwsRcxC98rHwxbAnV2s29IxQCicq4PVnB0AOEzsg");
    const log = await prisma.auditLog.findFirst({ where: { action: "plan.hubSource" }, orderBy: { at: "desc" } });
    expect(log?.after).toBe(id);
    const view = await plan.monthPlan(owner, month);
    expect(view.hubSource.sourceId).toBe(id);
    expect(view.hubSource.mode).toBe("imitation");
  });
});

describe("ОСАГО по СК в карточке", () => {
  it("до загрузки хаба раздела нет; после загрузки: план из модели, факт с начала месяца, ранрейт линейный и итог", async () => {
    const owner = await actor.owner();
    await plan.applyPull(owner, month);
    expect((await plan.monthPlan(owner, month)).sk).toBeNull();
    await hub.applyHub(owner);
    const view = await plan.monthPlan(owner, month);
    const sk = view.sk!;
    expect(sk.day).toBe(today);
    expect(sk.elapsed).toBe(Number(today.slice(8, 10)));
    expect(sk.rows.map((r) => r.sk).sort()).toEqual(HUB_FAKE_SK.map((x) => x.sk).sort());
    const alfa = sk.rows.find((r) => r.sk === "АльфаСтрахование")!;
    const spec = HUB_FAKE_SK.find((x) => x.sk === "АльфаСтрахование")!;
    expect(alfa.plan).toBe(Math.round(spec.monthly * 1.05));
    // Имитация: факт пропорционален прошедшим дням, значит линейный ранрейт попадает в месяц
    expect(alfa.mtd).toBeGreaterThan(0);
    expect(alfa.linear! / spec.monthly).toBeCloseTo(1, 1);
    expect(alfa.profile).toBeNull();
    expect(alfa.forecast).toBe(alfa.linear);
    expect(alfa.poolShare).toBeCloseTo(spec.pool, 1);
    expect(alfa.vsPlan).toBeCloseTo(1 / 1.05, 1);
    expect(sk.total.plan).toBe(HUB_FAKE_SK.reduce((s, x) => s + Math.round(x.monthly * 1.05), 0));
    expect(sk.total.mtd).toBe(sk.rows.reduce((s, r) => s + r.mtd!, 0));
    expect(sk.total.linear! / totalMonthly).toBeCloseTo(1, 1);
    expect(sk.lbeUnits).not.toBeNull();
    expect(sk.stale).toBe(false);
    expect(sk.profileDays).toBe(0);
    expect(sk.canPull).toBe(true);
    expect(sk.canSource).toBe(true);
    // Карточке ОСАГО раздел нужен только в этом продукте: в представлении он один на месяц
    expect(view.products.some((p) => p.code === "osago")).toBe(true);
  });

  it("выручку и КВ по СК видят управление, команда ОСАГО и команда партнёрского канала; КАСКО и наблюдатель их не видят", async () => {
    const owner = await actor.owner();
    await plan.applyPull(owner, month);
    await hub.applyHub(owner);
    const see = async (who: tasks.Actor) => (await plan.monthPlan(who, month)).sk!;
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

  it("команду ОСАГО можно сменить: новый участник видит чувствительные показатели, старый перестаёт", async () => {
    const owner = await actor.owner();
    await plan.applyPull(owner, month);
    await hub.applyHub(owner);
    await plan.setOwners(owner, "osago", ["fatyanov"]);
    expect((await plan.monthPlan(await actor.fatyanov(), month)).sk!.sensitive).toBe(true);
    expect((await plan.monthPlan(await actor.golovkin(), month)).sk!.sensitive).toBe(false);
  });

  it("снимок старше вчерашнего помечается устаревшим, а серия дневных снимков включает профиль дней недели", async () => {
    const owner = await actor.owner();
    await plan.applyPull(owner, month);
    const todayDate = new Date(`${today}T00:00:00Z`);
    const day = Number(today.slice(8, 10));
    if (day < 16) {
      // В начале месяца серии из 15 дней не набрать: проверяем только устаревший снимок
      await hub.applyHub(owner, new Date(todayDate.getTime() - 3 * DAY + 12 * 60 * 60 * 1000));
      const sk = (await plan.monthPlan(owner, month)).sk!;
      expect(sk.stale).toBe(true);
      expect(sk.day).toBe(new Date(todayDate.getTime() - 3 * DAY).toISOString().slice(0, 10));
      return;
    }
    for (let d = day - 15; d <= day - 2; d++) {
      await hub.applyHub(owner, new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), d, 12)));
    }
    const sk = (await plan.monthPlan(owner, month)).sk!;
    expect(sk.stale).toBe(true);
    expect(sk.profileDays).toBe(13);
    expect(sk.total.profile).toBeNull();
    await hub.applyHub(owner, new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), day - 1, 12)));
    const fresh = (await plan.monthPlan(owner, month)).sk!;
    expect(fresh.stale).toBe(false);
    expect(fresh.profileDays).toBe(14);
    expect(fresh.total.profile).not.toBeNull();
    // Имитация равномерная по дням: профиль и линейный ранрейт совпадают, месяц стабильный
    expect(fresh.total.profile! / fresh.total.linear!).toBeCloseTo(1, 1);
    expect(fresh.total.unstable).toBe(false);
  });
});

describe("доступ к цифрам хаба по уровням этапа 57", () => {
  const LINK = "https://docs.google.com/spreadsheets/d/1KFYKwsRcxC98rHwxbAnV2s29IxQCicq4PVnB0AOEzsg/edit";
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
    expect(await actions.applyHubAction()).toMatchObject({ ok: true, value: { day: today } });
    expect(await actions.setHubSourceAction(LINK)).toEqual({ ok: true, value: "1KFYKwsRcxC98rHwxbAnV2s29IxQCicq4PVnB0AOEzsg" });
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
