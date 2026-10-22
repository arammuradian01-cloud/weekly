// Этап 64: один экран «Weekly-команды». Список команд по тому, кто смотрит (владелец и администратор в режиме
// управления все, руководитель свои и где участник, сотрудник где участник, общий логин топ-команду), права на каждую
// по правилам сервисов, ждущие согласия видны только тем, кому их показывали раньше, и тонкие обёртки
// renameTeam и closeTeam: проект через сервис проектов, остальные команды правкой владельца, всё в журнале.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import * as projects from "@/lib/org/projects";
import * as teams from "@/lib/org/teams";
import { NO_RIGHTS } from "@/lib/org/team-rights";
import { TOP_TEAM } from "@/lib/org/scope";

const INS = "Департамент страхования и инвестиций";
const MONEY = "Департамент Money";
const PARTNERS = "Департамент партнёрств";

// Вымышленные люди Money и партнёрств: руководители из файла приходят с ролью сотрудника
const COMPANY = [
  ["ФИО", "Должность", "Департамент", "Управление", "Отдел", "Руководит"],
  ["Крайник Александр", "CEO", "", "", "", "да"],
  ["Мурадян Арам", "Директор департамента", INS, "", "", "да"],
  ["Головкин Владислав", "Director of Insurance", INS, "Управление бизнес развития", "", "да"],
  ["Фатьянов Евгений", "Head of Sales", INS, "Управление бизнес развития", "Отдел по развитию бизнеса", ""],
  ["Ершов Пётр", "Директор департамента", MONEY, "", "", "да"],
  ["Лисина Анна", "Head of Credit", MONEY, "Управление кредитных продуктов", "", "да"],
  ["Котов Игорь", "Product analyst", MONEY, "Управление кредитных продуктов", "Отдел аналитики (money)", ""],
  ["Белова Ольга", "Директор департамента", PARTNERS, "", "", "да"],
  ["Седов Максим", "Partner manager", PARTNERS, "Управление партнёрских продаж", "", ""],
]
  .map((r) => r.join(";"))
  .join("\n");

const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(svc.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
const person = (start: string) => prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } } });
const personal = async (start: string) => ({ ...(await svc.actorFor((await person(start)).slug)), via: "PASSWORD" as const });
const ownerMode = async () => ({ ...(await svc.actorFor("muradyan", "OWNER")), via: "PASSWORD" as const });
const teamOf = (name: string) => prisma.team.findFirstOrThrow({ where: { name, active: true } });

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
  await prisma.team.update({ where: { id: TOP_TEAM }, data: { parentId: null, name: "Топ-команда" } });
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
  await org.applyStructure(await svc.actorFor("muradyan", "OWNER"), COMPANY);
});
afterAll(async () => {
  await clean();
  await prisma.teamMember.createMany({ data: topMembers.map((personId) => ({ teamId: TOP_TEAM, personId })), skipDuplicates: true });
  await prisma.$disconnect();
});

describe("список команд по тому, кто смотрит", () => {
  it("владелец в режиме управления: все команды компании, всё можно, кроме закрытия топ-команды", async () => {
    const view = await teams.teamsView(await ownerMode());
    expect(view.mode).toBe("all");
    expect(view.owner).toBe(true);
    const active = await prisma.team.count({ where: { active: true } });
    expect(view.teams).toHaveLength(active);
    // Сначала команды, которыми он руководит: топ-команда
    expect(view.teams[0]!.id).toBe(TOP_TEAM);
    expect(view.teams[0]!.rights).toEqual({ members: true, rename: true, close: false, leader: true, rhythm: false });
    const money = view.teams.find((t) => t.name === MONEY)!;
    expect(money.rights).toEqual({ members: true, rename: true, close: true, leader: true, rhythm: true });
    expect(money.leader?.fullName).toBe("Ершов Пётр");
    expect(money.kind).toBe("UNIT");
    // Люди для поиска и подразделения для помощника, владельцы для руководителя топ-команды
    expect(view.people.map((p) => p.fullName)).toContain("Котов Игорь");
    expect(view.people.find((p) => p.fullName === "Котов Игорь")?.manager).toBe((await person("Лисина")).slug);
    expect(view.units.some((u) => u.kind === "COMPANY")).toBe(true);
    expect(view.owners).toContain("muradyan");
    expect(view.parents.length).toBe(active);
  });

  it("администратор в режиме управления видит все команды, но меняет только свои: правила сервисов те же", async () => {
    const golovkin = { ...(await personal("Головкин")), management: "ADMIN" as const };
    const view = await teams.teamsView(golovkin);
    expect(view.mode).toBe("all");
    expect(view.owner).toBe(false);
    expect(view.teams.find((t) => t.name === MONEY)?.rights).toEqual(NO_RIGHTS);
    const own = view.teams.find((t) => t.name === "Управление бизнес развития")!;
    expect(own.relation).toBe("leader");
    expect(own.rights).toMatchObject({ members: true, rename: false, close: false, leader: false });
    expect(view.closed).toEqual([]);
  });

  it("руководитель из файла: свои команды и команды, где участник; люди для поиска приходят", async () => {
    const view = await teams.teamsView(await personal("Ершов"));
    expect(view.mode).toBe("mine");
    expect(view.canCreate).toBe(true);
    expect(view.teams.map((t) => [t.name, t.relation])).toEqual([
      [MONEY, "leader"],
      [org.COMPANY_TEAM_NAME, "member"],
    ]);
    expect(view.teams[0]!.rights).toEqual({ members: true, rename: false, close: false, leader: false, rhythm: true });
    expect(view.teams[1]!.rights).toEqual(NO_RIGHTS);
    expect(view.teams[0]!.members.map((m) => [m.fullName, m.position, m.unit])).toEqual([["Лисина Анна", "Head of Credit", "Управление кредитных продуктов"]]);
    expect(view.people.length).toBeGreaterThan(0);
  });

  it("сотрудник: только команды, где он участник, только просмотр, людей компании экран не получает", async () => {
    const view = await teams.teamsView(await personal("Котов"));
    expect(view.mode).toBe("mine");
    expect(view.canCreate).toBe(false);
    expect(view.teams.map((t) => t.name)).toEqual(["Управление кредитных продуктов"]);
    expect(view.teams[0]!.rights).toEqual(NO_RIGHTS);
    expect(view.people).toEqual([]);
    expect(view.units).toEqual([]);
    // Команда из адреса, где его нет (ссылка из «Мне»): карточка только для просмотра, в списке её нет
    const money = await teamOf(MONEY);
    const focused = await teams.teamsView(await personal("Котов"), { focus: money.id });
    expect(focused.teams.map((t) => t.id)).not.toContain(money.id);
    expect(focused.extra?.id).toBe(money.id);
    expect(focused.extra?.rights).toEqual(NO_RIGHTS);
    expect(focused.extra?.relation).toBe("other");
  });

  it("общий логин без режима управления: только топ-команда и только просмотр, без запросов и людей", async () => {
    const shared = { ...(await personal("Головкин")), via: "TEAM" as const };
    const view = await teams.teamsView(shared);
    expect(view.mode).toBe("shared");
    expect(view.teams.map((t) => t.id)).toEqual([TOP_TEAM]);
    expect(view.teams[0]!.rights).toEqual(NO_RIGHTS);
    expect(view.canCreate).toBe(false);
    expect(view.people).toEqual([]);
    expect(view.toApprove).toEqual([]);
  });
});

describe("ждущие согласия и запросы", () => {
  it("ждущих видят руководитель команды, согласующий и владелец; участник команды их не видит", async () => {
    const golovkin = await personal("Головкин");
    const unit = await teamOf("Управление бизнес развития");
    const kotov = await person("Котов");
    const r = await projects.addProjectPeople(golovkin, unit.id, [kotov.slug]);
    expect(r.requested).toEqual([{ name: "Котов Игорь", approver: "Лисина Анна" }]);

    const lead = (await teams.teamsView(golovkin)).teams.find((t) => t.id === unit.id)!;
    expect(lead.waiting).toMatchObject([{ fullName: "Котов Игорь", approver: "Лисина Анна", requestedBy: "Головкин Владислав", canCancel: true }]);
    // Согласующий решает на этом же экране: запрос у него в «Ваших сотрудников зовут в команды»
    const lisina = await teams.teamsView(await personal("Лисина"));
    expect(lisina.toApprove.map((x) => x.person.fullName)).toEqual(["Котов Игорь"]);
    const owner = (await teams.teamsView(await ownerMode())).teams.find((t) => t.id === unit.id)!;
    expect(owner.waiting).toHaveLength(1);
    expect(owner.waiting[0]!.canCancel).toBe(true);
    // Фатьянов участник этой команды: состав видит, чужие запросы нет
    const member = (await teams.teamsView(await personal("Фатьянов"))).teams.find((t) => t.id === unit.id)!;
    expect(member.relation).toBe("member");
    expect(member.waiting).toEqual([]);
    expect(member.members.map((m) => m.fullName)).toEqual(["Фатьянов Евгений"]);
    await org.cancelJoinRequest(golovkin, lead.waiting[0]!.id);
  });
});

describe("обёртки над сервисами", () => {
  it("переименовать: свой проект руководитель, команду по структуре только владелец; оба пишутся в журнал", async () => {
    const ershov = await personal("Ершов");
    const p = await projects.createProjectWith(ershov, "Кредиты и страхование", [(await person("Лисина")).slug]);
    const renamed = await teams.renameTeam(ershov, p.id, "  Кредиты —  страхование ");
    expect(renamed).toEqual({ id: p.id, name: "Кредиты - страхование" });
    expect(await prisma.auditLog.findFirst({ where: { entityId: p.id, field: "Название проекта", after: { equals: "Кредиты - страхование" } } })).not.toBeNull();

    const money = await teamOf(MONEY);
    await expectRule(teams.renameTeam(ershov, money.id, "Money"), /только владелец/);
    const done = await teams.renameTeam(await ownerMode(), money.id, "Money: weekly");
    expect(done.name).toBe("Money: weekly");
    expect(await prisma.auditLog.findFirst({ where: { entityId: money.id, field: "Название команды", before: { equals: MONEY }, after: { equals: "Money: weekly" } } })).not.toBeNull();
    await teams.renameTeam(await ownerMode(), money.id, MONEY);
    // Общий логин не переименовывает даже свой проект
    await expectRule(teams.renameTeam({ ...ershov, via: "TEAM" }, p.id, "Другое"), /войдя лично/);
  });

  it("закрыть: проект с открытыми задачами нельзя, без них закрывается и запросы отменяются; команду по структуре закрывает владелец", async () => {
    const ershov = await personal("Ершов");
    const p = await teamOf("Кредиты - страхование");
    const sedov = await person("Седов");
    await projects.addProjectPeople(ershov, p.id, [sedov.slug]);
    expect(await prisma.teamJoinRequest.count({ where: { teamId: p.id, status: "PENDING" } })).toBe(1);
    const lisina = await person("Лисина");
    await svc.createTask(ershov, { title: "Сверка кредитов", outcome: "Сверка готова", owner: lisina.slug, direction: "department", due: "2027-01-15", team: p.id });
    await expectRule(teams.closeTeam(ershov, p.id), /открытых задач/);
    const open = (await teams.teamsView(ershov)).teams.find((t) => t.id === p.id)!;
    expect(open.openTasks).toBe(1);
    await prisma.task.deleteMany({ where: { teamId: p.id } });
    await teams.closeTeam(ershov, p.id);
    expect((await prisma.team.findUniqueOrThrow({ where: { id: p.id } })).active).toBe(false);
    expect(await prisma.teamJoinRequest.count({ where: { teamId: p.id, status: "PENDING" } })).toBe(0);
    await expectRule(teams.closeTeam(ershov, p.id), /нет или она закрыта/);

    // Команду по структуре руководитель не закрывает, владелец закрывает и возвращает
    const credit = await teamOf("Управление кредитных продуктов");
    await expectRule(teams.closeTeam(await personal("Лисина"), credit.id), /только владелец/);
    await teams.closeTeam(await ownerMode(), credit.id);
    expect(await prisma.auditLog.findFirst({ where: { entityId: credit.id, action: "team.off" } })).not.toBeNull();
    const view = await teams.teamsView(await ownerMode());
    expect(view.closed.map((t) => t.name)).toEqual(expect.arrayContaining(["Управление кредитных продуктов", "Кредиты - страхование"]));
    expect(view.teams.some((t) => t.id === credit.id)).toBe(false);
    await org.updateTeam(await ownerMode(), credit.id, { active: true });
    // Топ-команду не закрыть
    await expectRule(teams.closeTeam(await ownerMode(), TOP_TEAM), /Топ-команду/);
  });

  it("владелец назначает руководителя: новый руководитель управляет составом, прежний больше нет", async () => {
    const owner = await ownerMode();
    const created = await projects.createProjectWith(owner, "Партнёрский пилот", []);
    expect((await teams.teamsView(owner)).teams.find((t) => t.id === created.id)?.relation).toBe("leader");
    await org.updateTeam(owner, created.id, { leader: (await person("Белова")).slug });
    const belova = (await teams.teamsView(await personal("Белова"))).teams.find((t) => t.id === created.id)!;
    expect(belova.relation).toBe("leader");
    expect(belova.rights).toMatchObject({ members: true, rename: true, close: true });
    const aram = (await teams.teamsView({ ...owner, management: null })).teams.find((t) => t.id === created.id);
    expect(aram).toBeUndefined();
  });
});
