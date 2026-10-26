// Этап 77: цели для roadmap. Свои цели квартала выбранной команды видны и без задач; цель выше уходит на roadmap, только
// если на неё работает открытая задача; статус, риск и прогресс как на экране «Цели»; цели другого квартала не уходят;
// «Все мои команды» отдаёт цели всех своих команд.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import * as goals from "@/lib/goals/service";
import { roadmapGoals } from "@/lib/goals/roadmap";
import { TOP_TEAM } from "@/lib/org/scope";
import { quarterOf } from "@/lib/goals/parse";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";

const STRUCTURE = [
  ["ФИО", "Должность", "Управление", "Отдел", "Сектор", "Руководитель", "Руководит"],
  ["Рева Тарас", "CPO", "Управление развития продуктов", "", "", "Мурадян Арам", "да"],
  ["Антонов Дмитрий", "PO OSAGO", "Управление развития продуктов", "Отдел развития продуктов", "", "Рева Тарас", "да"],
  ["Чемоданова Алиса", "Product Designer", "Управление развития продуктов", "Отдел развития продуктов", "", "", ""],
]
  .map((r) => r.join("\t"))
  .join("\n");

const Q = quarterOf(moscowToday());
const NEXT = Q.endsWith("Q4") ? `${Number(Q.slice(0, 4)) + 1}-Q1` : `${Q.slice(0, 5)}Q${Number(Q.slice(6)) + 1}`;
const future = addDays(moscowToday(), 10);
const owner = () => svc.actorFor("muradyan", "OWNER");
const actor = async (start: string) => svc.actorFor((await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } } })).slug);
const teamOf = async (leaderStart: string) => prisma.team.findFirstOrThrow({ where: { leader: { fullName: { startsWith: leaderStart } } } });
const who = (a: svc.Actor) => ({ personId: a.personId, role: a.role, management: a.management });
const newTask = async (a: svc.Actor, title: string, ownerSlug: string, team: string) =>
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
}

const ids: Record<string, string> = {};

beforeAll(async () => {
  await clean();
  await org.applyStructure(await owner(), STRUCTURE);
  const revaTeam = await teamOf("Рева");
  const dept = await teamOf("Антонов");
  const boss = await owner();
  const reva = await svc.actorFor("reva");
  ids.d1 = (await goals.createGoal(boss, { quarter: Q, code: "D1", title: "Маржа департамента", team: TOP_TEAM })).id;
  ids.d2 = (await goals.createGoal(boss, { quarter: Q, code: "D2", title: "Цель департамента без задач команды", team: TOP_TEAM })).id;
  ids.d3 = (await goals.createGoal(boss, { quarter: Q, code: "D3", title: "Цель с закрытой задачей", team: TOP_TEAM })).id;
  ids.p1 = (await goals.createGoal(reva, { quarter: Q, code: "P1", title: "Конверсия расчёта", metric: "Конверсия, %", base: "20", target: "24", team: revaTeam.id, parent: ids.d1 })).id;
  ids.p2 = (await goals.createGoal(reva, { quarter: Q, code: "P2", title: "Цель без задач", team: revaTeam.id })).id;
  ids.old = (await goals.createGoal(boss, { quarter: NEXT, code: "N1", title: "Цель следующего квартала", team: revaTeam.id })).id;
  ids.s1 = (await goals.createGoal(await actor("Антонов"), { quarter: Q, code: "S1", title: "Цель отдела", team: dept.id, parent: ids.p1 })).id;

  // Задачи команды Ревы: на цель департамента, на свою цель, закрытая на третью цель департамента
  const t1 = await newTask(reva, "Задача на цель департамента", "reva", revaTeam.id);
  const t2 = await newTask(reva, "Задача на свою цель", "reva", revaTeam.id);
  const t3 = await newTask(reva, "Закрытая задача", "reva", revaTeam.id);
  await goals.linkTaskGoal(reva, t1.number, ids.d1);
  await goals.linkTaskGoal(reva, t2.number, ids.p1);
  await goals.linkTaskGoal(reva, t3.number, ids.d3);
  await svc.changeStatus(reva, t3.number, "done", "Готово");
  await goals.setGoalFact(reva, ids.p1, { value: "22" });
  ids.t1 = String(t1.number);
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("цели для roadmap", () => {
  it("своя команда: свои цели квартала и без задач, цель выше только с открытой задачей, другой квартал не уходит", async () => {
    const revaTeam = await teamOf("Рева");
    const reva = await svc.actorFor("reva");
    const view = await roadmapGoals(who(reva), { team: revaTeam.id, own: [revaTeam.id] });
    expect(view.quarter).toBe(Q);
    const byId = new Map(view.goals.map((g) => [g.id, g]));
    expect([...byId.keys()].sort()).toEqual([ids.d1, ids.p1, ids.p2].sort());
    expect(byId.get(ids.p2)).toMatchObject({ own: true, known: true, code: "P2", progress: { done: 0, total: 0, overdue: 0 } });
    expect(byId.get(ids.d1)).toMatchObject({ own: false, team: { id: TOP_TEAM } });
    // Прогресс и факт как на экране «Цели»: путь от базы к целевому, задача цели и цели ниже
    const p1 = byId.get(ids.p1)!;
    expect(p1.own).toBe(true);
    expect(p1.fact).toBe("22");
    expect(p1.numeric?.share).toBeCloseTo(0.5);
    expect(p1.progress.total).toBe(1);
    expect(p1.owner?.slug).toBe("reva");
    // На roadmap уходит только строка цели: без истории фактов, описания и задач
    expect(Object.keys(p1)).not.toContain("facts");
    expect(Object.keys(p1)).not.toContain("tasks");
  });

  it("риск считается как на экране «Цели»", async () => {
    const revaTeam = await teamOf("Рева");
    const reva = await svc.actorFor("reva");
    await goals.updateGoal(reva, ids.p2, { atRisk: true, riskNote: "Нет людей" });
    const view = await roadmapGoals(who(reva), { team: revaTeam.id, own: [revaTeam.id] });
    expect(view.goals.find((g) => g.id === ids.p2)!.risk).toMatch(/Нет людей/);
  });

  it("цель выше уходит, пока задача открыта: закрыли задачу, цели на roadmap нет", async () => {
    const revaTeam = await teamOf("Рева");
    const reva = await svc.actorFor("reva");
    await svc.changeStatus(reva, Number(ids.t1), "done", "Сделано");
    const view = await roadmapGoals(who(reva), { team: revaTeam.id, own: [revaTeam.id] });
    expect(view.goals.map((g) => g.id).sort()).toEqual([ids.p1, ids.p2].sort());
  });

  it("«Все мои команды»: цели всех своих команд; без команды только цели под открытыми задачами", async () => {
    const revaTeam = await teamOf("Рева");
    const dept = await teamOf("Антонов");
    const reva = await svc.actorFor("reva");
    const all = await roadmapGoals(who(reva), { team: null, own: [revaTeam.id, dept.id] });
    expect(all.goals.filter((g) => g.own).map((g) => g.id).sort()).toEqual([ids.p1, ids.p2, ids.s1].sort());
    const none = await roadmapGoals(who(reva), { team: null, own: [] });
    // Открытая задача осталась только у своей цели команды Ревы: она и уходит, но уже не своей
    expect(none.goals.map((g) => [g.id, g.own])).toEqual([[ids.p1, false]]);
    // Другой квартал отдаётся по запросу: тогда свои цели этого квартала
    const next = await roadmapGoals(who(reva), { team: revaTeam.id, own: [revaTeam.id], quarter: NEXT });
    expect(next.goals.map((g) => g.id)).toEqual([ids.old]);
  });
});
