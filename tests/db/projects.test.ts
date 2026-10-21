// Этап 57: weekly-проекты руководителей и цифры прогноза. Готовые команды департаментов собраны по структуре
// (страхование и инвестиции, Money, партнёрства отдельно), руководитель собирает свой проект по образцу команды:
// люди своей ветки входят сразу, из других веток после согласия непосредственного руководителя. Цифры прогноза
// видят только департамент страхования и инвестиций и топ-команда.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import * as projects from "@/lib/org/projects";
import { canSeeNumbers } from "@/lib/plan/access";
import { TOP_TEAM } from "@/lib/org/scope";

const owner = () => svc.actorFor("muradyan", "OWNER");
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(svc.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

const INS = "Департамент страхования и инвестиций";
const MONEY = "Департамент Money";
const PARTNERS = "Департамент партнёрств";

// Вымышленные люди Money и партнёрств: руководители из файла приходят с ролью сотрудника
const COMPANY = [
  ["ФИО", "Должность", "Департамент", "Управление", "Отдел", "Сектор", "Руководитель", "Функциональный руководитель", "Руководит", "Статус"],
  ["Крайник Александр", "CEO", "", "", "", "", "", "", "да", ""],
  ["Мурадян Арам", "Директор департамента", INS, "", "", "", "", "", "да", ""],
  ["Головкин Владислав", "Director of Insurance", INS, "Управление бизнес развития", "", "", "", "", "да", ""],
  ["Фатьянов Евгений", "Head of Sales", INS, "Управление бизнес развития", "Отдел по развитию бизнеса", "", "", "", "", ""],
  ["Токов Никита Андреевич", "Analytics Lead", INS, "Управление бизнес развития", "Отдел аналитики (insurance)", "", "", "", "", ""],
  ["Ершов Пётр", "Директор департамента", MONEY, "", "", "", "", "", "да", ""],
  ["Лисина Анна", "Head of Credit", MONEY, "Управление кредитных продуктов", "", "", "", "", "да", ""],
  ["Котов Игорь", "Product analyst", MONEY, "Управление кредитных продуктов", "Отдел аналитики (money)", "", "", "", "", ""],
  ["Белова Ольга", "Директор департамента", PARTNERS, "", "", "", "", "", "да", ""],
  ["Седов Максим", "Partner manager", PARTNERS, "Управление партнёрских продаж", "", "", "", "", "", ""],
]
  .map((r) => r.join(";"))
  .join("\n");

const person = (start: string) => prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } } });
const personal = async (start: string) => ({ ...(await svc.actorFor((await person(start)).slug)), via: "PASSWORD" as const });
const unitNamed = (name: string) => prisma.orgUnit.findFirstOrThrow({ where: { name, active: true } });

async function deleteUnits() {
  for (let i = 0; i < 10; i++) {
    if (!(await prisma.orgUnit.count())) return;
    await prisma.orgUnit.deleteMany({ where: { children: { none: {} } } });
  }
}

let topMembers: string[] = [];

async function clean() {
  await prisma.task.deleteMany();
  await prisma.teamJoinRequest.deleteMany();
  await prisma.teamMember.deleteMany({ where: { teamId: { not: TOP_TEAM } } });
  await prisma.teamMember.deleteMany({ where: { teamId: TOP_TEAM, person: { role: "EMPLOYEE" } } });
  await prisma.goal.deleteMany();
  await prisma.team.deleteMany({ where: { id: { not: TOP_TEAM } } });
  await prisma.team.update({ where: { id: TOP_TEAM }, data: { parentId: null } });
  await prisma.person.updateMany({ data: { unitId: null, managerId: null, functionalManagerId: null, position: null } });
  await prisma.inboxEvent.deleteMany();
  await prisma.weeklyEntry.deleteMany({ where: { author: { role: "EMPLOYEE" } } });
  await prisma.weeklyReport.deleteMany({ where: { author: { role: "EMPLOYEE" } } });
  await prisma.person.deleteMany({ where: { role: "EMPLOYEE" } });
  await prisma.vacancy.deleteMany();
  await deleteUnits();
}

beforeAll(async () => {
  topMembers = (await prisma.teamMember.findMany({ where: { teamId: TOP_TEAM }, select: { personId: true } })).map((m) => m.personId);
  await clean();
  await org.applyStructure(await owner(), COMPANY);
});
afterAll(async () => {
  await clean();
  await prisma.teamMember.createMany({ data: topMembers.map((personId) => ({ teamId: TOP_TEAM, personId })), skipDuplicates: true });
  await prisma.$disconnect();
});

describe("готовые команды по структуре", () => {
  it("департаменты под компанией: Money и партнёрства отдельными командами со всеми людьми ветки", async () => {
    const view = await projects.projectsView(await personal("Ершов"));
    const company = view.units.find((u) => u.kind === "COMPANY")!;
    const ready = view.units.filter((u) => u.parentId === company.id).map((u) => u.name);
    expect(ready).toEqual(expect.arrayContaining([INS, MONEY, PARTNERS]));
    const money = await unitNamed(MONEY);
    const slugs = await projects.unitPeople(money.id);
    const names = (await prisma.person.findMany({ where: { slug: { in: slugs } }, select: { fullName: true } })).map((p) => p.fullName).sort();
    expect(names).toEqual(["Ершов Пётр", "Котов Игорь", "Лисина Анна"]);
    expect(view.units.find((u) => u.id === money.id)?.head).toBe((await person("Ершов")).slug);
    // Руководитель из файла с ролью сотрудника собирает проекты; его команда по структуре уже среди его проектов
    expect(view.canCreate).toBe(true);
    expect(view.projects.map((p) => p.kind)).toEqual(["UNIT"]);
    // Топ-команды среди проектов нет даже у её руководителя: её собирают в структуре в режиме управления
    const aram = await projects.projectsView({ ...(await owner()), management: null, via: "PASSWORD" });
    expect(aram.projects.some((p) => p.id === TOP_TEAM)).toBe(false);
  });
});

describe("свой weekly-проект по образцу", () => {
  it("руководитель Money забирает свою команду: своя ветка входит сразу, без запросов", async () => {
    const ershov = await personal("Ершов");
    const team = await projects.createProject(ershov, { name: "  Weekly:   Департамент Money " });
    expect(team.name).toBe("Weekly: Департамент Money");
    const row = await prisma.team.findUniqueOrThrow({ where: { id: team.id }, include: { parent: true } });
    expect(row.kind).toBe("CUSTOM");
    expect(row.leaderId).toBe(ershov.personId);
    // Проект под командой, которой он руководит по структуре: руководитель выше видит проект в дереве команд
    expect(row.parent?.kind).toBe("UNIT");
    expect(row.parent?.leaderId).toBe(ershov.personId);
    const r = await projects.addProjectPeople(ershov, team.id, await projects.unitPeople((await unitNamed(MONEY)).id));
    expect(r.added.sort()).toEqual(["Котов Игорь", "Лисина Анна"]);
    expect(r.requested).toEqual([]);
    expect(r.skipped).toEqual([{ name: "Ершов Пётр", reason: "Ершов Пётр руководит этой командой" }]);
    expect(await prisma.teamJoinRequest.count({ where: { teamId: team.id } })).toBe(0);
    const audit = await prisma.auditLog.findFirst({ where: { entity: "team", entityId: team.id, field: "Weekly-проект создан" } });
    expect(audit?.after).toBe("Weekly: Департамент Money, руководитель Ершов Пётр");
    // Тот же проект второй раз не создаётся
    await expectRule(projects.createProject(ershov, { name: "Weekly: Департамент Money" }), /уже есть/);
  });

  it("человек из другой ветки ждёт согласия своего непосредственного руководителя, свой человек входит сразу", async () => {
    const golovkin = await personal("Головкин");
    const team = await projects.createProject(golovkin, { name: "Кросс-продажи с кредитами" });
    const kotov = await person("Котов");
    const fatyanov = await person("Фатьянов");
    const r = await projects.addProjectPeople(golovkin, team.id, [kotov.slug, fatyanov.slug, kotov.slug]);
    expect(r.added).toEqual(["Фатьянов Евгений"]);
    // Согласует непосредственный руководитель Котова по структуре, а не директор департамента
    expect(r.requested).toEqual([{ name: "Котов Игорь", approver: "Лисина Анна" }]);
    const request = await prisma.teamJoinRequest.findFirstOrThrow({ where: { teamId: team.id, personId: kotov.id, status: "PENDING" } });
    expect(request.approverId).toBe((await person("Лисина")).id);
    expect((await prisma.inboxEvent.findFirstOrThrow({ where: { subject: `join:${request.id}` }, include: { recipient: true } })).recipient.fullName).toBe("Лисина Анна");
    expect(await prisma.teamMember.count({ where: { teamId: team.id, personId: kotov.id } })).toBe(0);
    // Ждущий виден в проекте; повтор не создаёт второй запрос, а объясняет, почему
    const view = await projects.projectsView(golovkin);
    const mine = view.projects.find((p) => p.id === team.id)!;
    expect(mine.members.map((m) => m.fullName)).toEqual(["Фатьянов Евгений"]);
    expect(mine.waiting).toEqual([{ slug: kotov.slug, fullName: "Котов Игорь", approver: "Лисина Анна" }]);
    const again = await projects.addProjectPeople(golovkin, team.id, [kotov.slug]);
    expect(again.skipped).toEqual([{ name: "Котов Игорь", reason: "Котов Игорь уже ждёт согласия руководителя: Лисина Анна" }]);
    expect(await prisma.teamJoinRequest.count({ where: { teamId: team.id, personId: kotov.id } })).toBe(1);
    // После согласия Котов в проекте с пометкой «из другой ветки»
    await org.decideJoinRequest(await personal("Лисина"), request.id, true);
    const member = await prisma.teamMember.findUniqueOrThrow({ where: { teamId_personId: { teamId: team.id, personId: kotov.id } } });
    expect(member.external).toBe(true);
  });

  it("чужой проект не пополнить; сотрудник без подчинённых, наблюдатель и общий логин проекты не собирают", async () => {
    const golovkinTeam = await prisma.team.findFirstOrThrow({ where: { name: "Кросс-продажи с кредитами" } });
    const ershov = await personal("Ершов");
    await expectRule(projects.addProjectPeople(ershov, golovkinTeam.id, [(await person("Седов")).slug]), /меняют её руководитель/);
    const kotov = await personal("Котов");
    expect(await projects.canCreateProject(kotov)).toBe(false);
    await expectRule(projects.createProject(kotov, { name: "Мой проект" }), /Проекты собирают руководители/);
    const viaTeam = { ...(await personal("Головкин")), via: "TEAM" as const };
    expect(await projects.canCreateProject(viaTeam)).toBe(false);
    await expectRule(projects.createProject(viaTeam, { name: "Ещё проект" }), /войдя лично/);
    expect(await projects.canCreateProject({ personId: kotov.personId, role: "OBSERVER", via: "PASSWORD", management: null })).toBe(false);
    await expectRule(projects.createProject(await personal("Белова"), { name: " " }), /Напишите название/);
    await expectRule(projects.addProjectPeople(ershov, golovkinTeam.id, []), /Выберите людей/);
  });
});

describe("цифры прогноза", () => {
  it("видят департамент страхования и инвестиций и топ-команда, остальные департаменты пока нет", async () => {
    const who = async (start: string) => {
      const p = await person(start);
      return { personId: p.id, role: p.role, management: null };
    };
    // Аналитик департамента страхования с ролью сотрудника: в ветке департамента, которым руководит Арам
    expect(await canSeeNumbers(await who("Токов"))).toBe(true);
    expect(await canSeeNumbers(await who("Мурадян"))).toBe(true);
    expect(await canSeeNumbers(await who("Котов"))).toBe(false);
    expect(await canSeeNumbers(await who("Ершов"))).toBe(false);
    expect(await canSeeNumbers(await who("Седов"))).toBe(false);
    expect(await canSeeNumbers(await who("Крайник"))).toBe(false);
    // Человек другого департамента, которого Арам взял в топ-команду, видит цифры
    const ershov = await person("Ершов");
    await prisma.teamMember.create({ data: { teamId: TOP_TEAM, personId: ershov.id } });
    expect(await canSeeNumbers(await who("Ершов"))).toBe(true);
    await prisma.teamMember.delete({ where: { teamId_personId: { teamId: TOP_TEAM, personId: ershov.id } } });
    // Режим управления открывает всё
    expect(await canSeeNumbers({ ...(await who("Котов")), management: "OWNER" })).toBe(true);
  });
});
