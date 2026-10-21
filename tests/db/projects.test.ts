// Этап 57: weekly-проекты руководителей и цифры прогноза. Готовые команды департаментов собраны по структуре
// (страхование и инвестиции, Money, партнёрства отдельно), руководитель собирает свой проект по образцу команды:
// люди своей ветки входят сразу, из других веток после согласия непосредственного руководителя. Цифры прогноза
// видят только департамент страхования и инвестиций и топ-команда.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import * as projects from "@/lib/org/projects";
import { NUMBERS_ACCESS_KEY, briefFor, canSeeNumbers, numbersAccessView, numbersLevel, saveNumbersAccess, summaryBrief, withNumbers } from "@/lib/plan/access";
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
    // Сам руководитель в копии подразделения молча пропускается: это не ошибка
    expect(r.skipped).toEqual([]);
    expect(r.already).toEqual([]);
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
    expect(mine.waiting).toEqual([{ id: request.id, slug: kotov.slug, fullName: "Котов Игорь", approver: "Лисина Анна" }]);
    const again = await projects.addProjectPeople(golovkin, team.id, [kotov.slug]);
    expect(again).toEqual({ added: [], requested: [], already: ["Котов Игорь"], skipped: [] });
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

describe("пачки, гонки и границы после проверки кода", () => {
  it("одна транзакция на пачку: несуществующий и закрытый проект отказывают сразу, вся компания и больше 150 человек нет", async () => {
    const ershov = await personal("Ершов");
    const kotov = await person("Котов");
    await expectRule(projects.addProjectPeople(ershov, "нет-такого", [kotov.slug]), /нет или он закрыт/);
    const company = await prisma.orgUnit.findFirstOrThrow({ where: { kind: "COMPANY", active: true } });
    await expectRule(projects.unitPeople(company.id), /Всю компанию/);
    const many = Array.from({ length: projects.BATCH_MAX + 1 }, (_, i) => `slug-${i}`);
    const own = await prisma.team.findFirstOrThrow({ where: { name: "Weekly: Департамент Money" } });
    await expectRule(projects.addProjectPeople(ershov, own.id, many), /до 150 человек/);
    // Неизвестные люди в пачке не роняют остальных
    const r = await projects.addProjectPeople(ershov, own.id, ["нет-такого-человека"]);
    expect(r.skipped).toEqual([{ name: "нет-такого-человека", reason: "Такого человека нет" }]);
  });

  it("руководитель человека получает одно событие на пачку; две одинаковые пачки сразу не дают двойных запросов", async () => {
    const reva = await personal("Головкин");
    const team = await projects.createProjectWith(reva, "Кредиты и страхование", [(await person("Котов")).slug, (await person("Седов")).slug]);
    expect(team.result?.requested.map((x) => x.approver).sort()).toEqual(["Белова Ольга", "Лисина Анна"]);
    const belova = await person("Белова");
    const events = await prisma.inboxEvent.findMany({ where: { recipientId: belova.id, kind: "TEAM", subject: { startsWith: "join:" } } });
    expect(events).toHaveLength(1);
    expect(events[0]!.text).toMatch(/вашего сотрудника Седов Максим в команду «Кредиты и страхование»/);
    // Две пачки одновременно на одних и тех же людей: ровно один ожидающий запрос на человека
    const lisina = await personal("Лисина");
    const p2 = await projects.createProject(lisina, { name: "Партнёры и кредиты" });
    const sedov = (await person("Седов")).slug;
    const outcomes = await Promise.allSettled([projects.addProjectPeople(lisina, p2.id, [sedov]), projects.addProjectPeople(lisina, p2.id, [sedov])]);
    expect(outcomes.every((o) => o.status === "fulfilled")).toBe(true);
    expect(await prisma.teamJoinRequest.count({ where: { teamId: p2.id, status: "PENDING" } })).toBe(1);
    // Индекс запрещает второй ожидающий запрос даже в обход сервиса
    const existing = await prisma.teamJoinRequest.findFirstOrThrow({ where: { teamId: p2.id, status: "PENDING" } });
    await expect(prisma.teamJoinRequest.create({ data: { teamId: p2.id, personId: existing.personId, approverId: existing.approverId } })).rejects.toThrow();
  });

  it("новый проект с людьми одной транзакцией: при отказе пустой проект не остаётся", async () => {
    const ershov = await personal("Ершов");
    const many = Array.from({ length: projects.BATCH_MAX + 1 }, (_, i) => `x-${i}`);
    await expectRule(projects.createProjectWith(ershov, "Слишком большой", many), /до 150 человек/);
    expect(await prisma.team.count({ where: { name: "Слишком большой" } })).toBe(0);
  });

  it("свой проект переименовывают и закрывают; чужой и команду по структуре нет; запрос можно отменить", async () => {
    const ershov = await personal("Ершов");
    const own = await prisma.team.findFirstOrThrow({ where: { name: "Weekly: Департамент Money" } });
    const renamed = await projects.renameProject(ershov, own.id, "Money — weekly");
    expect(renamed.name).toBe("Money - weekly");
    const golovkin = await personal("Головкин");
    await expectRule(projects.renameProject(golovkin, own.id, "Чужое"), /руководитель/);
    const unitTeam = await prisma.team.findFirstOrThrow({ where: { leaderId: ershov.personId, kind: "UNIT" } });
    await expectRule(projects.closeProject(ershov, unitTeam.id), /нет или он закрыт/);
    // Открытая задача держит проект
    const kotov = await person("Котов");
    await svc.createTask(ershov, { title: "Отчёт по кредитам", outcome: "Отчёт готов", owner: kotov.slug, direction: "department", due: "2027-01-15", team: own.id });
    await expectRule(projects.closeProject(ershov, own.id), /открытых задач/);
    await prisma.task.deleteMany({ where: { teamId: own.id } });
    await projects.closeProject(ershov, own.id);
    expect((await prisma.team.findUniqueOrThrow({ where: { id: own.id } })).active).toBe(false);
    await expectRule(projects.addProjectPeople(ershov, own.id, [kotov.slug]), /нет или он закрыт/);
    // Ожидающий запрос отменяет тот, кто просил
    const cross = await prisma.team.findFirstOrThrow({ where: { name: "Кредиты и страхование" } });
    const req = await prisma.teamJoinRequest.findFirstOrThrow({ where: { teamId: cross.id, status: "PENDING" } });
    await org.cancelJoinRequest(golovkin, req.id);
    expect((await prisma.teamJoinRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("CANCELLED");
  });

  it("руководитель без своей команды по структуре: проект встаёт под команду генерального директора, а не под топ-команду", async () => {
    const sedov = await person("Седов");
    await prisma.person.update({ where: { id: sedov.id }, data: { role: "LEADER" } });
    const p = await projects.createProject(await personal("Седов"), { name: "Партнёрский пилот" });
    const row = await prisma.team.findUniqueOrThrow({ where: { id: p.id }, include: { parent: true } });
    const company = await prisma.orgUnit.findFirstOrThrow({ where: { kind: "COMPANY", active: true } });
    expect(row.parent?.unitId).toBe(company.id);
    expect(row.parentId).not.toBe(TOP_TEAM);
    await prisma.person.update({ where: { id: sedov.id }, data: { role: "EMPLOYEE" } });
  });
});

describe("второй круг проверки кода", () => {
  it("закрытие проекта и пачка людей не расходятся: после закрытия ожидающих запросов нет, согласовать в закрытый нельзя", async () => {
    const golovkin = await personal("Головкин");
    const p = await projects.createProject(golovkin, { name: "Гонка закрытия" });
    const slugs = [(await person("Котов")).slug, (await person("Седов")).slug];
    await Promise.allSettled([projects.addProjectPeople(golovkin, p.id, slugs), projects.closeProject(golovkin, p.id)]);
    const team = await prisma.team.findUniqueOrThrow({ where: { id: p.id } });
    if (!team.active) expect(await prisma.teamJoinRequest.count({ where: { teamId: p.id, status: "PENDING" } })).toBe(0);
    // Запрос, который ждал, пока проект закрыли руками в обход сервиса: согласие отказывает
    const p2 = await projects.createProjectWith(golovkin, "Закрыт до согласия", [slugs[0]!]);
    const req = await prisma.teamJoinRequest.findFirstOrThrow({ where: { teamId: p2.id, status: "PENDING" } });
    await prisma.team.update({ where: { id: p2.id }, data: { active: false } });
    await expectRule(org.decideJoinRequest(await personal("Лисина"), req.id, true), /закрыта/);
    // Общий логин запрос не отменяет
    await prisma.team.update({ where: { id: p2.id }, data: { active: true } });
    await expectRule(org.cancelJoinRequest({ ...golovkin, via: "TEAM" }, req.id), /войдя лично/);
  });

  it("режим управления: человек из другой ветки входит сразу, его руководитель получает одно событие на пачку", async () => {
    const ershov = await personal("Ершов");
    const p = await projects.createProject(ershov, { name: "Пачка владельца" });
    const ownerActor = { ...(await owner()), via: "PASSWORD" as const };
    const belova = await person("Белова");
    const before = await prisma.inboxEvent.count({ where: { recipientId: belova.id, kind: "TEAM" } });
    const r = await projects.addProjectPeople(ownerActor, p.id, [(await person("Седов")).slug]);
    expect(r.added).toEqual(["Седов Максим"]);
    expect(await prisma.inboxEvent.count({ where: { recipientId: belova.id, kind: "TEAM" } })).toBe(before + 1);
  });

  it("команду, которую владелец создал в «Структуре», руководитель на странице проектов не переименовывает и не закрывает", async () => {
    const ownerActor = await owner();
    const t = await org.createTeam(ownerActor, { name: "Команда владельца", leader: (await person("Ершов")).slug });
    const ershov = await personal("Ершов");
    await expectRule(projects.renameProject(ershov, t.id, "Моё название"), /нет или он закрыт/);
    await expectRule(projects.closeProject(ershov, t.id), /нет или он закрыт/);
    const view = await projects.projectsView(ershov);
    expect(view.projects.find((x) => x.id === t.id)?.project).toBe(false);
  });

  it("основные цифры: итог месяца без корректировок команд и партнёров", () => {
    const brief = { month: "2026-10", reasons: [{ product: "osago" }], partnerReasons: [{ product: "b2b" }], partnersMore: 4 } as unknown as Parameters<typeof summaryBrief>[0];
    const cut = summaryBrief(brief)!;
    expect(cut.reasons).toEqual([]);
    expect(cut.partnerReasons).toEqual([]);
    expect(cut.partnersMore).toBe(0);
    expect(briefFor("none", brief)).toBeNull();
    expect(briefFor("full", brief)).toBe(brief);
  });

  it("настройка со ссылками на удалённые подразделения: раздел показывает, сколько их", async () => {
    await prisma.setting.upsert({ where: { key: NUMBERS_ACCESS_KEY }, update: { value: { full: { units: ["нет-такого"], people: [] }, summary: { topManagement: true, units: [], people: ["нет-такого-человека"] } } }, create: { key: NUMBERS_ACCESS_KEY, value: { full: { units: ["нет-такого"], people: [] }, summary: { topManagement: true, units: [], people: ["нет-такого-человека"] } } } });
    const view = await numbersAccessView();
    expect(view.stale).toBe(2);
    expect(view.access.full.units).toEqual([]);
    await prisma.setting.deleteMany({ where: { key: NUMBERS_ACCESS_KEY } });
  });
});

describe("цифры прогноза", () => {
  const who = async (start: string) => {
    const p = await person(start);
    return { personId: p.id, role: p.role, management: null };
  };

  it("уровни по умолчанию: департамент страхования, топ-команда и генеральный директор видят всё, топ-менеджмент основное", async () => {
    await prisma.setting.deleteMany({ where: { key: { in: [NUMBERS_ACCESS_KEY, "plan.owners"] } } });
    // Аналитик департамента страхования с ролью сотрудника: в ветке департамента, которым руководит Арам
    expect(await numbersLevel(await who("Токов"))).toBe("full");
    expect(await numbersLevel(await who("Мурадян"))).toBe("full");
    // Генеральный директор (решение Арама 21.10)
    expect(await numbersLevel(await who("Крайник"))).toBe("full");
    // Руководители департаментов: основные цифры
    expect(await numbersLevel(await who("Ершов"))).toBe("summary");
    expect(await numbersLevel(await who("Белова"))).toBe("summary");
    // Остальные департаменты: ничего
    expect(await numbersLevel(await who("Котов"))).toBe("none");
    expect(await numbersLevel(await who("Лисина"))).toBe("none");
    expect(await canSeeNumbers(await who("Ершов"))).toBe(false);
    // Человек другого департамента в топ-команде видит всё
    const ershov = await person("Ершов");
    await prisma.teamMember.create({ data: { teamId: TOP_TEAM, personId: ershov.id } });
    expect(await numbersLevel(await who("Ершов"))).toBe("full");
    await prisma.teamMember.delete({ where: { teamId_personId: { teamId: TOP_TEAM, personId: ershov.id } } });
    // Режим управления открывает всё
    expect(await numbersLevel({ ...(await who("Котов")), management: "OWNER" })).toBe("full");
  });

  it("команда продукта из «Прогноза» видит все цифры, даже если она из другого департамента", async () => {
    const kotov = await person("Котов");
    await prisma.setting.upsert({ where: { key: "plan.owners" }, update: { value: { osago: [kotov.slug] } }, create: { key: "plan.owners", value: { osago: [kotov.slug] } } });
    expect(await numbersLevel(await who("Котов"))).toBe("full");
    await prisma.setting.deleteMany({ where: { key: "plan.owners" } });
  });

  it("владелец настраивает уровни; действия прогноза отказывают тому, у кого только основные цифры", async () => {
    const aram = { ...(await owner()), via: "PASSWORD" as const };
    const money = await unitNamed(MONEY);
    const ins = await unitNamed(INS);
    const kotov = await person("Котов");
    await expectRule(saveNumbersAccess({ ...aram, management: null }, { full: { units: [], people: [] }, summary: { topManagement: true, units: [], people: [] } }), /владелец в режиме управления/);
    const saved = await saveNumbersAccess(aram, { full: { units: [ins.id], people: [] }, summary: { topManagement: false, units: [money.id], people: ["нет-такого"] } });
    expect(saved.access.summary).toEqual({ topManagement: false, units: [money.id], people: [] });
    // Топ-менеджмент выключен: директор партнёрств ничего не видит, Money целиком видит основное
    expect(await numbersLevel(await who("Белова"))).toBe("none");
    expect(await numbersLevel(await who("Котов"))).toBe("summary");
    const kotovActor = await svc.actorFor(kotov.slug);
    await expectRule(withNumbers(kotovActor, () => "ok"), /основные цифры/);
    expect(await withNumbers(kotovActor, () => "ok", "summary")).toBe("ok");
    await expectRule(withNumbers(await svc.actorFor((await person("Седов")).slug), () => "ok", "summary"), /департамент страхования/);
    // Отдельный человек получает все цифры
    await saveNumbersAccess(aram, { full: { units: [ins.id], people: [kotov.slug] }, summary: { topManagement: true, units: [], people: [] } });
    expect(await numbersLevel(await who("Котов"))).toBe("full");
    const view = await numbersAccessView();
    expect(view.counts.full).toBeGreaterThan(0);
    expect(view.departments.map((d) => d.name)).toEqual(expect.arrayContaining([INS, MONEY, PARTNERS]));
    const journal = await prisma.auditLog.findMany({ where: { action: "settings.numbersAccess" } });
    expect(journal.some((j) => j.field === "Доступ к цифрам: Все цифры: люди")).toBe(true);
    await prisma.setting.deleteMany({ where: { key: NUMBERS_ACCESS_KEY } });
  });
});
