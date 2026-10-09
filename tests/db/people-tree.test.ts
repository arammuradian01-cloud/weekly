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
  ["Белова Анна", "Аналитик", "Управление развития продуктов", "", "", "Рева Тарас", "", ""],
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
    const belova = await slugOf("Белова");
    expect(tree.roots[0]).toBe("muradyan");
    expect(tree.people.muradyan!.reports).toContain(reva);
    // Руководители впереди, потом по алфавиту: Белова по алфавиту раньше Токова, но без подчинённых
    expect(tree.people[reva]!.reports).toEqual([antonov, tokov, belova]);
    expect(tree.people[reva]!.total).toBe(5);
    expect(tree.people[antonov]!).toMatchObject({ manager: reva, reports: [alisa], total: 1, depth: 2, position: "PO OSAGO", unit: "Сектор автострахования" });
    expect(tree.people[alisa]!.depth).toBe(3);
    expect(tree.people[antonov]!.leads.map((t) => t.name)).toContain("Сектор автострахования");
    expect(tree.people[alisa]!.memberOf.map((t) => t.name)).toContain("Сектор автострахования");
    // Начало: у меня есть подчинённые, начинаю с себя
    expect(tree.start).toBe("muradyan");
    expect((await peopleTree(await viewer(alisa))).start).toBe(antonov);
    // Корень без подчинённых (наблюдатель вне структуры): начинает с первого корня
    expect((await peopleTree(await viewer("ceo"))).start).toBe("muradyan");
  });

  it("чья работа видна: управление всех, специалист себя и руководителя своей команды", async () => {
    const antonov = await slugOf("Антонов");
    const tokov = await slugOf("Токов");
    const alisa = await slugOf("Чемоданова");
    const all = await peopleTree(await viewer("muradyan"));
    expect(Object.values(all.people).every((p) => p.work)).toBe(true);
    const mine = await peopleTree(await viewer(alisa));
    expect(mine.people[alisa]!.work).toBe(true);
    expect(mine.people[antonov]!.work).toBe(true);
    expect(mine.people[tokov]!.work).toBe(false);
    expect((await peopleTree(await viewer(antonov))).people[alisa]!.work).toBe(true);
  });

  it("вакансии видят руководитель ветки и управление, остальные нет", async () => {
    const antonov = await slugOf("Антонов");
    expect((await peopleTree(await viewer("muradyan"))).people[antonov]!.vacancies).toEqual(["PO KASKO"]);
    expect((await peopleTree(await viewer(await slugOf("Рева")))).people[antonov]!.vacancies).toEqual(["PO KASKO"]);
    expect((await peopleTree(await viewer(antonov))).people[antonov]!.vacancies).toEqual(["PO KASKO"]);
    expect((await peopleTree(await viewer(await slugOf("Токов")))).people[antonov]!.vacancies).toBeNull();
    const alisa = await viewer(await slugOf("Чемоданова"));
    expect((await peopleTree(alisa)).people[antonov]!.vacancies).toBeNull();
    // Администратор без подразделений видит вакансии
    expect((await peopleTree({ ...alisa, role: "ADMIN" })).people[antonov]!.vacancies).toEqual(["PO KASKO"]);
    // У кого нет подразделения под руководством, вакансий нет вовсе
    expect((await peopleTree(await viewer("muradyan"))).people[await slugOf("Чемоданова")]!.vacancies).toEqual([]);
  });

  it("руководитель двух подразделений в разных ветках: вакансии чужой ветки не видны", async () => {
    const tokov = await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: "Токов" } } });
    const dept = await prisma.orgUnit.findFirstOrThrow({ where: { kind: "DEPARTMENT" } });
    const other = await prisma.orgUnit.create({ data: { name: "Управление продаж", kind: "MANAGEMENT", parentId: dept.id, headId: tokov.id } });
    await prisma.vacancy.create({ data: { unitId: other.id, position: "Аналитик продаж" } });
    try {
      const reva = await viewer(await slugOf("Рева"));
      // Рева видит вакансии только «Продуктовой аналитики» (их нет), но не управления продаж
      expect((await peopleTree(reva)).people[tokov.slug]!.vacancies).toEqual([]);
      expect((await peopleTree(await viewer("muradyan"))).people[tokov.slug]!.vacancies).toEqual(["Аналитик продаж"]);
    } finally {
      await prisma.orgUnit.delete({ where: { id: other.id } });
    }
  });

  it("выключенное подразделение у человека не показывается", async () => {
    const antonov = await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: "Антонов" } } });
    await prisma.orgUnit.update({ where: { id: antonov.unitId! }, data: { active: false } });
    try {
      expect((await peopleTree(await viewer("muradyan"))).people[antonov.slug]!.unit).toBeNull();
    } finally {
      await prisma.orgUnit.update({ where: { id: antonov.unitId! }, data: { active: true } });
    }
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
    await prisma.person.update({ where: { id: tokov.id }, data: { active: true, managerId: (await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: "Рева" } } })).id } });
    await prisma.person.update({ where: { id: ivanova.id }, data: { managerId: tokov.id } });
  });

  it("петля выше по дереву: из неё выходят только её участники, люди под ней остаются на месте", async () => {
    const find = (start: string) => prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } } });
    const [reva, antonov, alisa, tokov, muradyan] = await Promise.all([find("Рева"), find("Антонов"), find("Чемоданова"), find("Токов"), prisma.person.findUniqueOrThrow({ where: { slug: "muradyan" } })]);
    // Рева под Антоновым, Антонов под Ревой; под ними Чемоданова и Токов
    await prisma.person.update({ where: { id: reva.id }, data: { managerId: antonov.id } });
    try {
      const tree = await peopleTree(await viewer("muradyan"));
      expect(tree.orphans).toBe(2);
      expect(tree.roots).toEqual(expect.arrayContaining([reva.slug, antonov.slug]));
      expect(tree.people[alisa.slug]!.manager).toBe(antonov.slug);
      expect(tree.people[tokov.slug]!.manager).toBe(reva.slug);
      expect(tree.people[tokov.slug]!.depth).toBe(1);
      expect(tree.roots[0]).toBe("muradyan");
    } finally {
      await prisma.person.update({ where: { id: reva.id }, data: { managerId: muradyan.id } });
    }
  });
});
