// Этап 34: дерево подчинённых по полю «Руководитель». Корни, порядок, число людей ниже, петли и выключенные
// руководители, вакансии только руководителям ветки и управлению, с кого начинать
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import { peopleTree } from "@/lib/org/people-tree";
import { TOP_TEAM } from "@/lib/org/scope";

const STRUCTURE = [
  ["ФИО", "Должность", "Управление", "Отдел", "Сектор", "Руководитель", "Руководит", "Статус"],
  ["Рева Тарас", "CPO", "Управление развития продуктов", "", "", "Мурадян Арам", "да", ""],
  ["Антонов Дмитрий", "PO OSAGO", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "Рева Тарас", "да", ""],
  ["Чемоданова Алиса", "Product Designer", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "Антонов Дмитрий", "", ""],
  ["Токов Никита", "Team Lead", "Управление развития продуктов", "Продуктовая аналитика", "", "Рева Тарас", "да", ""],
  ["Иванова Мария", "Аналитик", "Управление развития продуктов", "Продуктовая аналитика", "", "Токов Никита", "", ""],
  ["Вакансия", "PO KASKO", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "", "", "вакансия"],
]
  .map((r) => r.join("\t"))
  .join("\n");

const owner = () => svc.actorFor("muradyan", "OWNER");
const viewer = async (slug: string) => {
  const p = await prisma.person.findUniqueOrThrow({ where: { slug } });
  return { id: p.id, role: p.role };
};
const slugOf = async (start: string) => (await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } } })).slug;

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

beforeAll(async () => {
  await clean();
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("дерево подчинённых", () => {
  it("до загрузки структуры дерева нет", async () => {
    const tree = await peopleTree(await viewer("muradyan"));
    expect(tree.loaded).toBe(false);
  });

  it("по руководителям: корень, подчинённые, всего ниже, глубина, команды", async () => {
    await org.applyStructure(await owner(), STRUCTURE);
    const tree = await peopleTree(await viewer("muradyan"));
    expect(tree.loaded).toBe(true);
    const reva = await slugOf("Рева");
    const antonov = await slugOf("Антонов");
    const tokov = await slugOf("Токов");
    const alisa = await slugOf("Чемоданова");
    expect(tree.roots[0]).toBe("muradyan");
    expect(tree.people.muradyan!.reports).toContain(reva);
    // Руководители впереди, потом по алфавиту
    expect(tree.people[reva]!.reports).toEqual([antonov, tokov]);
    expect(tree.people[reva]!.total).toBe(4);
    expect(tree.people[antonov]!).toMatchObject({ manager: reva, reports: [alisa], total: 1, depth: 2, position: "PO OSAGO", unit: "Сектор автострахования" });
    expect(tree.people[alisa]!.depth).toBe(3);
    expect(tree.people[antonov]!.leads.map((t) => t.name)).toContain("Сектор автострахования");
    expect(tree.people[alisa]!.memberOf.map((t) => t.name)).toContain("Сектор автострахования");
    // Начало: у меня есть подчинённые, начинаю с себя
    expect(tree.start).toBe("muradyan");
    expect((await peopleTree(await viewer(alisa))).start).toBe(antonov);
  });

  it("вакансии видят руководитель ветки и управление, остальные нет", async () => {
    const antonov = await slugOf("Антонов");
    expect((await peopleTree(await viewer("muradyan"))).people[antonov]!.vacancies).toEqual(["PO KASKO"]);
    expect((await peopleTree(await viewer(await slugOf("Рева")))).people[antonov]!.vacancies).toEqual(["PO KASKO"]);
    expect((await peopleTree(await viewer(antonov))).people[antonov]!.vacancies).toEqual(["PO KASKO"]);
    expect((await peopleTree(await viewer(await slugOf("Токов")))).people[antonov]!.vacancies).toBeNull();
    // У кого нет подразделения под руководством, вакансий нет вовсе
    expect((await peopleTree(await viewer("muradyan"))).people[await slugOf("Чемоданова")]!.vacancies).toEqual([]);
  });

  it("петля и выключенный руководитель: люди не теряются, встают в корни", async () => {
    const tokov = await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: "Токов" } } });
    const ivanova = await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: "Иванова" } } });
    // Токов под Ивановой, Иванова под Токовым
    await prisma.person.update({ where: { id: tokov.id }, data: { managerId: ivanova.id } });
    let tree = await peopleTree(await viewer("muradyan"));
    expect(tree.orphans).toBeGreaterThan(0);
    const all = Object.keys(tree.people);
    const reachable = new Set<string>();
    const walk = (s: string) => {
      if (reachable.has(s)) return;
      reachable.add(s);
      tree.people[s]!.reports.forEach(walk);
    };
    tree.roots.forEach(walk);
    expect([...reachable].sort()).toEqual(all.sort());
    // Выключенный руководитель: подчинённый в корнях
    await prisma.person.update({ where: { id: tokov.id }, data: { managerId: null, active: false } });
    tree = await peopleTree(await viewer("muradyan"));
    expect(tree.people[tokov.slug]).toBeUndefined();
    expect(tree.roots).toContain(ivanova.slug);
    expect(tree.people[ivanova.slug]!.manager).toBeNull();
    await prisma.person.update({ where: { id: tokov.id }, data: { active: true } });
  });
});
