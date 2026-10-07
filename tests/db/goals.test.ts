// Этап 17: сквозные цели. Дерево от цели департамента до цели сектора, права по командам, связь задач с целями,
// прогресс и риск снизу вверх, загрузка из таблицы и из вкладки целей Bord (имитация), задачи без цели.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import * as goals from "@/lib/goals/service";
import { previewBordGoals } from "@/lib/goals/bord";
import { TOP_TEAM } from "@/lib/org/scope";
import { quarterOf } from "@/lib/goals/parse";
import { teamPanel } from "@/lib/org/panel";
import { dbDate, moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";

const STRUCTURE = [
  ["ФИО", "Должность", "Управление", "Отдел", "Сектор", "Руководитель", "Руководит"],
  ["Рева Тарас", "CPO", "Управление развития продуктов", "", "", "Мурадян Арам", "да"],
  ["Антонов Дмитрий", "PO OSAGO", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "Рева Тарас", "да"],
  ["Чемоданова Алиса", "Product Designer", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "", ""],
  ["Токов Никита", "Team Lead", "Управление развития продуктов", "Продуктовая аналитика", "", "Рева Тарас", "да"],
  ["Иванова Мария", "Аналитик", "Управление развития продуктов", "Продуктовая аналитика", "", "", ""],
]
  .map((r) => r.join("\t"))
  .join("\n");

const Q = quarterOf(moscowToday());
const future = addDays(moscowToday(), 10);
const owner = () => svc.actorFor("muradyan", "OWNER");
const slugOf = async (start: string) => (await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } } })).slug;
const actor = async (start: string) => svc.actorFor(await slugOf(start));
const teamOf = async (leaderStart: string) => prisma.team.findFirstOrThrow({ where: { leader: { fullName: { startsWith: leaderStart } } } });
const who = (a: svc.Actor) => ({ personId: a.personId, role: a.role, management: a.management });
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(svc.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
const newTask = async (a: svc.Actor, title: string, ownerSlug: string, team?: string) =>
  (await svc.createTask(a, { title, outcome: "Результат", owner: ownerSlug, direction: "department", due: future, team })).task;

async function clean() {
  await prisma.task.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.inboxEvent.deleteMany();
  await prisma.teamMember.deleteMany({ where: { teamId: { not: TOP_TEAM } } });
  await prisma.team.deleteMany({ where: { id: { not: TOP_TEAM } } });
  await prisma.person.updateMany({ data: { unitId: null, managerId: null, functionalManagerId: null, position: null } });
  await prisma.person.deleteMany({ where: { role: "EMPLOYEE" } });
  await prisma.vacancy.deleteMany();
  await prisma.orgUnit.deleteMany({ where: { kind: { not: "DEPARTMENT" } } });
  await prisma.orgUnit.deleteMany();
  await prisma.setting.deleteMany({ where: { key: "bord.sourceId" } });
}

const ids: Record<string, string> = {};

beforeAll(async () => {
  await clean();
  await org.applyStructure(await owner(), STRUCTURE);
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("дерево целей и права", () => {
  it("цель департамента заводит управление, цель команды её руководитель, цель выше из своей ветки", async () => {
    const revaTeam = await teamOf("Рева");
    const sector = await teamOf("Антонов");
    const analytics = await teamOf("Токов");
    const reva = await svc.actorFor("reva");
    await expectRule(goals.createGoal(reva, { quarter: Q, title: "Маржа департамента", team: TOP_TEAM }), /Цели департамента заводят владелец/);
    ids.d1 = (await goals.createGoal(await owner(), { quarter: Q, code: "D1", title: "Маржа департамента 150 млн", metric: "Маржа, млн", base: "120", target: "150", team: TOP_TEAM })).id;
    ids.p1 = (await goals.createGoal(reva, { quarter: Q, code: "P1", title: "Конверсия расчёта в покупку", target: "24%", team: revaTeam.id, parent: ids.d1 })).id;
    ids.s1 = (await goals.createGoal(await actor("Антонов"), { quarter: Q, code: "1", title: "Новая форма расчёта на всём трафике", team: sector.id, parent: ids.p1 })).id;
    ids.a1 = (await goals.createGoal(await actor("Токов"), { quarter: Q, title: "Витрина воронки", team: analytics.id, parent: ids.p1 })).id;
    await expectRule(goals.createGoal(await actor("Токов"), { quarter: Q, title: "Чужая цель", team: sector.id }), /руководитель или руководитель выше/);
    await expectRule(goals.createGoal(await actor("Антонов"), { quarter: Q, title: "Под чужую ветку", team: sector.id, parent: ids.a1 }), /своей команды или команды выше/);
    await expectRule(goals.createGoal(await actor("Антонов"), { quarter: Q, code: "1", title: "Дубль номера", team: sector.id }), /уже есть/);
    const other = Q.endsWith("Q4") ? `${Number(Q.slice(0, 4)) + 1}-Q1` : `${Q.slice(0, 5)}Q${Number(Q.slice(6)) + 1}`;
    await expectRule(goals.createGoal(await actor("Антонов"), { quarter: other, title: "Другой квартал", team: sector.id, parent: ids.p1 }), /другого квартала/);
    // Владелец цели по умолчанию руководитель команды
    expect((await prisma.goal.findUniqueOrThrow({ where: { id: ids.s1 }, include: { owner: true } })).owner?.fullName).toMatch(/^Антонов/);
    expect(await prisma.auditLog.count({ where: { action: "goal.create", entityId: { in: Object.values(ids) } } })).toBe(4);
  });

  it("задачу привязывают к цели своей команды или выше; чужая ветка нельзя", async () => {
    const sector = await teamOf("Антонов");
    const antonov = await actor("Антонов");
    const alisa = await actor("Чемоданова");
    const t1 = await newTask(antonov, "Свёрстать форму", alisa.slug, sector.id);
    const t2 = await newTask(antonov, "Выкатить форму на 100%", alisa.slug, sector.id);
    expect((await goals.linkTaskGoal(alisa, t1.number, ids.s1)).goal).toBe("Новая форма расчёта на всём трафике");
    await goals.linkTaskGoal(antonov, t2.number, ids.s1);
    await expectRule(goals.linkTaskGoal(antonov, t1.number, ids.a1), /своей команды или команды выше/);
    await expectRule(goals.linkTaskGoal(await actor("Токов"), t1.number, null), new RegExp(`Задачи ${t1.number} нет`));
    const options = await goals.goalOptions(who(antonov), t1.number);
    expect(options.map((o) => o.id).sort()).toEqual([ids.d1, ids.p1, ids.s1].sort());
    expect((await svc.getTask(t1.number))!.goal?.id).toBe(ids.s1);
    expect(await prisma.auditLog.count({ where: { entity: "task", entityId: String(t1.number), field: "Цель" } })).toBe(1);
    // Закрыли одну задачу, вторая просрочена
    await svc.changeStatus(alisa, t1.number, "done", "Форма свёрстана");
    await prisma.task.update({ where: { number: t2.number }, data: { due: dbDate(addDays(moscowToday(), -2)) } });
  });

  it("прогресс и риск снизу вверх; руководитель сектора видит путь от цели департамента", async () => {
    const sector = await teamOf("Антонов");
    const view = await goals.goalsView(who(await actor("Антонов")), { quarter: Q, team: sector.id });
    expect(view.roots).toEqual([ids.d1]);
    const byId = new Map(view.goals.map((g) => [g.id, g]));
    expect(byId.has(ids.a1)).toBe(false);
    expect(byId.get(ids.s1)!.progress).toEqual({ done: 1, total: 2, overdue: 1 });
    expect(byId.get(ids.s1)!.risk).toMatch(/просрочено 1 из 1/);
    expect(byId.get(ids.p1)!.progress).toEqual({ done: 1, total: 2, overdue: 1 });
    expect(byId.get(ids.p1)!.risk).toMatch(/в риске цель ниже/);
    expect(byId.get(ids.d1)!.below).toEqual({ achieved: 0, total: 1 });
    expect(byId.get(ids.s1)!.canEdit).toBe(true);
    expect(byId.get(ids.d1)!.canEdit).toBe(false);
    // Весь департамент: и цель аналитики
    const all = await goals.goalsView(who(await owner()), { quarter: Q });
    expect(all.goals.map((g) => g.id).sort()).toEqual(Object.values(ids).sort());
    // В панели «Мои команды» у Ревы цели в риске по сектору
    const reva = await svc.actorFor("reva");
    const panel = (await teamPanel({ id: reva.personId, role: reva.role }, null))!;
    expect(panel.teams.find((t) => t.name === "Сектор автострахования")!.goalsAtRisk).toBe(1);
  });

  it("владелец цели отмечает риск и итог, но не правит цель; удалить можно только пустую цель", async () => {
    const sector = await teamOf("Антонов");
    const antonov = await actor("Антонов");
    const alisa = await actor("Чемоданова");
    const own = (await goals.createGoal(antonov, { quarter: Q, title: "Гайд по форме", team: sector.id, owner: alisa.slug, parent: ids.s1 })).id;
    await expectRule(goals.updateGoal(alisa, own, { atRisk: true }), /почему цель в риске/);
    await goals.updateGoal(alisa, own, { atRisk: true, riskNote: "Нет дизайнера на второй экран" });
    await expectRule(goals.updateGoal(alisa, own, { title: "Другое" }), /правят руководитель/);
    await goals.updateGoal(alisa, own, { result: "ACHIEVED", atRisk: false });
    await expectRule(goals.deleteGoal(antonov, ids.s1), /есть задачи или цели ниже/);
    await goals.deleteGoal(antonov, own);
    expect(await prisma.goal.count({ where: { id: own } })).toBe(0);
  });
});

describe("загрузка целей", () => {
  it("таблица: новые цели, повторная загрузка ничего не дублирует, правка цифр видна в проверке", async () => {
    const o = await owner();
    const text = [
      "ID\tКоманда\tВладелец\tЦель\tМетрика\tБаза\tЦелевое значение\tРодительская цель",
      `D2\tТоп-команда\tМурадян Арам\tДоля App 15%\tWeb2App\t11%\t15%\t`,
      `P2\tУправление развития продуктов\tРева Тарас\tПодписка ОСАГО запущена\tP&L\t\tк 15.12\tD2`,
    ].join("\n");
    const plan = await goals.planGoals(o, text, { team: TOP_TEAM, quarter: Q });
    expect(plan.problems).toEqual([]);
    expect(plan.add.map((a) => a.code)).toEqual(["D2", "P2"]);
    expect(await goals.applyGoals(o, text, { team: TOP_TEAM, quarter: Q })).toEqual({ added: 2, changed: 0 });
    const p2 = await prisma.goal.findFirstOrThrow({ where: { code: "P2" }, include: { parent: true, owner: true } });
    expect(p2.parent?.code).toBe("D2");
    expect(p2.owner?.slug).toBe("reva");
    const again = await goals.planGoals(o, text, { team: TOP_TEAM, quarter: Q });
    expect([again.add.length, again.change.length, again.same]).toEqual([0, 0, 2]);
    const edited = await goals.planGoals(o, text.replace("\t15%\t", "\t16%\t"), { team: TOP_TEAM, quarter: Q });
    expect(edited.change.map((c) => c.changes.join(""))).toEqual(["целевое: 15%, станет 16%"]);
  });

  it("ошибки: неизвестная команда и чужая команда у руководителя; база не тронута", async () => {
    const bad = ["Команда\tЦель", "Несуществующая команда\tРост продаж", "Продуктовая аналитика\tЦель аналитики"].join("\n");
    const plan = await goals.planGoals(await actor("Антонов"), bad, { team: (await teamOf("Антонов")).id, quarter: Q });
    expect(plan.problems.map((p) => p.text).join(" | ")).toMatch(/Команда «Несуществующая команда» не найдена.*Цели команды «Продуктовая аналитика» вы не заводите/);
    await expectRule(goals.applyGoals(await actor("Антонов"), bad, { team: (await teamOf("Антонов")).id, quarter: Q }), /не загрузить, база не тронута/);
  });

  it("вкладка целей Bord (имитация): только владелец, только чтение", async () => {
    process.env.SHEET_FAKE = "1";
    await prisma.setting.upsert({ where: { key: "bord.sourceId" }, update: { value: "imitation-bord" }, create: { key: "bord.sourceId", value: "imitation-bord" } });
    const sector = await teamOf("Антонов");
    await expectRule(previewBordGoals(await actor("Антонов"), "Цели образец", { team: sector.id, quarter: Q }), /владелец/);
    const plan = await previewBordGoals(await owner(), "Цели образец", { team: sector.id, quarter: Q });
    expect(plan.problems).toEqual([]);
    // Цель №1 сектора уже заведена руками: загрузка узнаёт её по номеру и предлагает обновить название
    // (в другом квартале обе цели вкладки новые: квартал задаёт раздел «Запланировано на Q4 2026»)
    if (Q === "2026-Q4") {
      expect(plan.add.map((a) => [a.quarter, a.code, a.title])).toEqual([["2026-Q4", "2", "Поднять конверсию расчёта в покупку"]]);
      expect(plan.change.map((c) => c.title)).toEqual(["Запустить новую форму расчёта"]);
    } else expect(plan.add.map((a) => a.code)).toEqual(["1", "2"]);
    await expectRule(previewBordGoals(await owner(), "Нет такой вкладки", { team: sector.id, quarter: Q }), /нет вкладки/);
    delete process.env.SHEET_FAKE;
  });

  it("задачи без цели по командам и с высоким приоритетом", async () => {
    const sector = await teamOf("Антонов");
    const antonov = await actor("Антонов");
    const t = await newTask(antonov, "Без цели", await slugOf("Чемоданова"), sector.id);
    await svc.changePriority(antonov, t.number, "high");
    const view = await goals.goalsView(who(antonov), { quarter: Q, team: sector.id });
    const row = view.unlinked.find((u) => u.team === sector.id)!;
    expect(row).toMatchObject({ open: 2, withoutGoal: 1, highWithoutGoal: 1 });
  });
});
