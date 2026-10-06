// Этап 14: структура департамента и команды. Загрузка структуры, видимость по командам, права руководителя команды,
// состав команд, weekly выбранной команды. Топ-команда работает как раньше.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import { loadScope, TOP_TEAM } from "@/lib/org/scope";
import { structureView } from "@/lib/org/view";
import { getWeekView } from "@/lib/weekly/service";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";
import { colleaguesOf, topTeamOnly } from "@/lib/org/people";

const future = addDays(moscowToday(), 10);

// Структура в том виде, в каком её копируют из Google-таблицы: табуляция, лишние и кадровые колонки, вакансия
const STRUCTURE = [
  ["ФИО", "Должность", "Управление", "Отдел", "Сектор", "Руководитель", "Функциональный руководитель", "Руководит", "Статус", "Тип договора"],
  ["Рева Тарас Игоревич", "CPO", "Управление развития продуктов", "", "", "Мурадян Арам", "", "да", "работает / ок", "ТК"],
  ["Антонов Дмитрий Денисович", "PO OSAGO", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "Рева Тарас", "", "да", "работает / ок", "ТК"],
  ["Чемоданова Алиса Владимировна", "Product Designer", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "", "", "", "работает / ок", "ТК"],
  ["Токов Никита", "Team Lead", "Управление развития продуктов", "Продуктовая аналитика", "", "Рева Тарас", "", "да", "", ""],
  ["Иванова Мария", "Аналитик", "Управление развития продуктов", "Продуктовая аналитика", "", "", "Антонов Дмитрий", "", "", ""],
  ["Вакансия PO KASKO", "PO KASKO", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "", "", "", "вакансия / новая", ""],
  ["Головкин Влад", "Заместитель директора", "Управление бизнес развития", "", "", "Мурадян Арам", "", "да", "", ""],
  ["Радионов Александр", "Head of Sales support", "Управление бизнес развития", "Финансовая координация", "", "Головкин Владислав", "", "да", "", ""],
  ["Новикова Екатерина", "Finance coordinator", "Управление бизнес развития", "Финансовая координация", "", "", "", "", "", ""],
]
  .map((r) => r.join("\t"))
  .join("\n");

const actors = {
  owner: () => svc.actorFor("muradyan", "OWNER"),
  ownerPlain: () => svc.actorFor("muradyan"),
  admin: () => svc.actorFor("golovkin", "ADMIN"),
  reva: () => svc.actorFor("reva"),
  fatyanov: () => svc.actorFor("fatyanov"),
};

const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(svc.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

const slugOf = async (fullNameStart: string) => (await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: fullNameStart } } })).slug;
const actor = async (fullNameStart: string) => svc.actorFor(await slugOf(fullNameStart));
const teamLedBy = async (fullNameStart: string) => prisma.team.findFirstOrThrow({ where: { leader: { fullName: { startsWith: fullNameStart } } }, include: { members: { include: { person: true } } } });

async function newTask(a: svc.Actor, title: string, owner: string, team?: string) {
  return (await svc.createTask(a, { title, outcome: "Результат", owner, direction: "department", due: future, team })).task;
}

beforeAll(() => cleanStructure());
async function cleanStructure() {
  await prisma.task.deleteMany();
  await prisma.teamMember.deleteMany({ where: { teamId: { not: TOP_TEAM } } });
  await prisma.team.deleteMany({ where: { id: { not: TOP_TEAM } } });
  await prisma.person.updateMany({ data: { unitId: null, managerId: null, functionalManagerId: null, position: null } });
  await prisma.inboxEvent.deleteMany();
  await prisma.person.deleteMany({ where: { role: "EMPLOYEE" } });
  await prisma.vacancy.deleteMany();
  await prisma.orgUnit.deleteMany({ where: { kind: { not: "DEPARTMENT" } } });
  await prisma.orgUnit.deleteMany();
}

afterAll(async () => {
  // Остальные файлы тестов живут в топ-команде из десяти человек: сотрудников из структуры убираем
  await cleanStructure();
  await prisma.$disconnect();
});

describe("топ-команда после миграции", () => {
  it("руководитель: владелец, участники: остальные люди, задачи по умолчанию в топ-команде", async () => {
    const top = await prisma.team.findUniqueOrThrow({ where: { id: TOP_TEAM }, include: { leader: true, members: { include: { person: true } } } });
    expect(top.kind).toBe("TOP");
    expect(top.leader?.slug).toBe("muradyan");
    const slugs = top.members.map((m) => m.person.slug);
    expect(slugs).toEqual(expect.arrayContaining(["golovkin", "reva", "loginova", "fatyanov", "sakhibullina", "afanasyev", "cheychenets"]));
    expect(slugs).not.toContain("muradyan");
    const t = await newTask(await actors.owner(), "Задача топ-команды", "reva");
    expect(t.team).toBe(TOP_TEAM);
  });
});

describe("загрузка структуры", () => {
  it("предпросмотр: кто добавится, кто изменится, вакансия отдельно, кадровые колонки не читаются, база не тронута", async () => {
    const plan = await org.previewStructure(await actors.owner(), STRUCTURE);
    expect(plan.problems).toEqual([]);
    expect(plan.people.add.map((p) => p.fullName).sort()).toEqual(
      ["Антонов Дмитрий Денисович", "Иванова Мария", "Новикова Екатерина", "Радионов Александр", "Токов Никита", "Чемоданова Алиса Владимировна"].sort(),
    );
    // «Рева Тарас Игоревич» и «Головкин Влад» узнаны как люди ресурса
    expect(plan.people.change.map((p) => p.fullName).sort()).toEqual(["Головкин Владислав", "Рева Тарас"]);
    expect(plan.vacancies).toEqual([{ path: ["Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования"], position: "PO KASKO" }]);
    expect(plan.units.add).toContain("Управление развития продуктов / Отдел развития продуктов / Сектор автострахования");
    expect(await prisma.orgUnit.count({ where: { kind: { not: "DEPARTMENT" } } })).toBe(0);
    expect(JSON.stringify(plan)).not.toContain("ТК");
  });

  it("загрузка: подразделения, сотрудники, руководители и команды руководителей подразделений с участниками", async () => {
    const r = await org.applyStructure(await actors.owner(), STRUCTURE);
    expect(r.added).toBe(6);
    expect(r.vacancies).toBe(1);
    const antonov = await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: "Антонов" } }, include: { manager: true, unit: true } });
    expect(antonov.role).toBe("EMPLOYEE");
    expect(antonov.position).toBe("PO OSAGO");
    expect(antonov.manager?.slug).toBe("reva");
    expect(antonov.unit?.name).toBe("Сектор автострахования");
    // Пустой «Руководитель»: руководитель своего подразделения
    const alisa = await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: "Чемоданова" } }, include: { manager: true } });
    expect(alisa.manager?.fullName).toMatch(/^Антонов/);
    const ivanova = await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: "Иванова" } }, include: { manager: true, functionalManager: true } });
    expect(ivanova.manager?.fullName).toMatch(/^Токов/);
    expect(ivanova.functionalManager?.fullName).toMatch(/^Антонов/);

    const revaTeam = await teamLedBy("Рева");
    expect(revaTeam.parentId).toBe(TOP_TEAM);
    expect(revaTeam.members.map((m) => m.person.fullName).sort()).toEqual(["Антонов Дмитрий Денисович", "Токов Никита"]);
    const antonovTeam = await teamLedBy("Антонов");
    expect(antonovTeam.parentId).toBe(revaTeam.id);
    expect(antonovTeam.members.map((m) => m.person.fullName)).toEqual(["Чемоданова Алиса Владимировна"]);
    const vladTeam = await teamLedBy("Головкин");
    expect(vladTeam.parentId).toBe(TOP_TEAM);
    const radionovTeam = await teamLedBy("Радионов");
    expect(radionovTeam.parentId).toBe(vladTeam.id);
    // Топ-команда не тронута: руководители подразделений в ней остались, новые сотрудники в неё не попали
    const top = await prisma.team.findUniqueOrThrow({ where: { id: TOP_TEAM }, include: { members: { include: { person: true } } } });
    expect(top.members.some((m) => m.person.slug === "reva")).toBe(true);
    expect(top.members.some((m) => m.person.fullName.startsWith("Антонов"))).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: "structure.import" } })).toBe(1);
  });

  it("повторная загрузка того же файла ничего не дублирует и ручной состав команды не трогает", async () => {
    const before = await prisma.team.count();
    const revaTeam = await teamLedBy("Рева");
    await org.addTeamMember(await actors.owner(), revaTeam.id, await slugOf("Иванова"));
    const plan = await org.previewStructure(await actors.owner(), STRUCTURE);
    expect(plan.people.add).toHaveLength(0);
    expect(plan.people.change).toHaveLength(0);
    await org.applyStructure(await actors.owner(), STRUCTURE);
    expect(await prisma.team.count()).toBe(before);
    expect((await teamLedBy("Рева")).members.some((m) => m.person.fullName.startsWith("Иванова"))).toBe(true);
    expect(await prisma.vacancy.count({ where: { closedAt: null } })).toBe(1);
  });

  it("ошибки в файле: строка без имени, неизвестный руководитель, двойник; база не тронута", async () => {
    const bad = ["ФИО;Должность;Управление;Руководитель", "Петров;Аналитик;Управление развития продуктов;", "Сидоров Иван;Аналитик;Управление развития продуктов;Неизвестный Человек", "Токов Никита;Lead;;", "Токов Никита;Lead;;"].join("\n");
    const plan = await org.previewStructure(await actors.owner(), bad);
    const texts = plan.problems.map((p) => p.text).join(" | ");
    expect(texts).toMatch(/нужны фамилия и имя/);
    expect(texts).toMatch(/Неизвестный Человек.*не найден/);
    expect(texts).toMatch(/уже есть в строке/);
    await expectRule(org.applyStructure(await actors.owner(), bad), /не загрузить, база не тронута/);
    expect(await prisma.person.count({ where: { fullName: { startsWith: "Сидоров" } } })).toBe(0);
  });

  it("загружает только владелец в режиме управления", async () => {
    await expectRule(org.previewStructure(await actors.admin(), STRUCTURE), /только владелец/);
    await expectRule(org.applyStructure(await actors.ownerPlain(), STRUCTURE), /только владелец/);
  });
});

describe("видимость задач по командам", () => {
  it("руководитель видит свою команду и команды ниже, соседний руководитель нет, функциональный видит задачи своего человека", async () => {
    const owner = await actors.owner();
    const antonovTeam = await teamLedBy("Антонов");
    const tokovTeam = await teamLedBy("Токов");
    const t1 = await newTask(owner, "Задача сектора автострахования", await slugOf("Чемоданова"), antonovTeam.id);
    const t2 = await newTask(owner, "Задача аналитики", await slugOf("Иванова"), tokovTeam.id);
    const numbersFor = async (a: svc.Actor) => (await svc.listTasks({ reader: { personId: a.personId, role: a.role } })).map((t) => t.number);
    const antonov = await actor("Антонов");
    const tokov = await actor("Токов");
    const reva = await actors.reva();
    const alisa = await actor("Чемоданова");
    expect(await numbersFor(antonov)).toEqual(expect.arrayContaining([t1.number, t2.number]));
    // Антонов видит задачу аналитики, потому что он функциональный руководитель Ивановой
    expect(await numbersFor(tokov)).toContain(t2.number);
    expect(await numbersFor(tokov)).not.toContain(t1.number);
    expect(await numbersFor(reva)).toEqual(expect.arrayContaining([t1.number, t2.number]));
    expect(await numbersFor(alisa)).toContain(t1.number);
    expect(await numbersFor(alisa)).not.toContain(t2.number);
    // Сотрудник не видит задач топ-команды
    const topTask = await newTask(owner, "Только для топ-команды", "loginova");
    expect(await numbersFor(alisa)).not.toContain(topTask.number);
    expect(await svc.getTask(topTask.number, { personId: alisa.personId, role: alisa.role })).toBeNull();
    // Владелец и администратор видят всё
    expect(await numbersFor(await actors.admin())).toEqual(expect.arrayContaining([t1.number, t2.number, topTask.number]));
    // Чужую задачу нельзя ни комментировать, ни править: номер не подтверждается
    await expectRule(svc.addComment(alisa, topTask.number, "Комментарий"), new RegExp(`Задачи ${topTask.number} нет`));
    await expectRule(svc.updateWhere(tokov, t1.number, "Где сейчас"), new RegExp(`Задачи ${t1.number} нет`));
  });

  it("scope: участник, руководитель, команды ниже; топ-команды в «руковожу» не бывает", async () => {
    const reva = await actors.reva();
    const scope = await loadScope(prisma, { id: reva.personId, role: reva.role });
    const revaTeam = await teamLedBy("Рева");
    const antonovTeam = await teamLedBy("Антонов");
    expect(scope.member).toEqual(expect.arrayContaining([TOP_TEAM, revaTeam.id]));
    expect(scope.leads).toEqual(expect.arrayContaining([revaTeam.id, antonovTeam.id]));
    expect(scope.leads).not.toContain(TOP_TEAM);
    const owner = await actors.ownerPlain();
    expect((await loadScope(prisma, { id: owner.personId, role: owner.role })).leads).not.toContain(TOP_TEAM);
  });
});

describe("права руководителя команды", () => {
  it("руководитель ставит задачу участнику сразу «В работе», участник другому только предлагает, предложение подтверждает руководитель", async () => {
    const antonovTeam = await teamLedBy("Антонов");
    const antonov = await actor("Антонов");
    const alisa = await actor("Чемоданова");
    const assigned = await newTask(antonov, "Макет формы", alisa.slug, antonovTeam.id);
    expect(assigned.status).toBe("in-progress");
    const proposed = await newTask(alisa, "Обновить гайд", antonov.slug, antonovTeam.id);
    expect(proposed.status).toBe("proposed");
    await expectRule(svc.changeStatus(alisa, proposed.number, "in-progress"), /подтверждает/);
    // Руководитель команды выше тоже может подтвердить
    const confirmed = await svc.changeStatus(await actors.reva(), proposed.number, "in-progress");
    expect(confirmed.task.status).toBe("in-progress");
    // Руководитель меняет ответственного и переносит срок без режима управления
    const moved = await svc.transferDue(antonov, assigned.number, addDays(future, 7), "Ждём данные от аналитиков");
    expect(moved.task.due).toBe(addDays(future, 7));
    const reassigned = await svc.assignOwner(antonov, assigned.number, antonov.slug);
    expect(reassigned.task.owner).toBe(antonov.slug);
    // Архив только у владельца
    await expectRule(svc.archiveTask(antonov, assigned.number), /только владелец/);
  });

  it("руководитель команды, который состоит в топ-команде, топ-командой не управляет", async () => {
    const owner = await actors.owner();
    const topTask = await newTask(owner, "Задача Логиновой", "loginova");
    const reva = await actors.reva();
    await expectRule(svc.changeStatus(reva, topTask.number, "done", "Готово"), /Статус меняет/);
    await expectRule(svc.assignOwner(reva, topTask.number, "reva"), /Ответственного меняют/);
  });

  it("задачу ставят только в свои команды; «Все лидеры» только в топ-команде", async () => {
    const alisa = await actor("Чемоданова");
    const tokovTeam = await teamLedBy("Токов");
    await expectRule(newTask(alisa, "Чужая команда", alisa.slug, tokovTeam.id), /не состоите/);
    await expectRule(newTask(alisa, "В топ-команду", alisa.slug, TOP_TEAM), /не состоите/);
    const own = await newTask(alisa, "Своя задача без команды в запросе", alisa.slug);
    expect(own.team).toBe((await teamLedBy("Антонов")).id);
    await expectRule(newTask(await actors.reva(), "Всем", "all", (await teamLedBy("Рева")).id), /Все лидеры/);
  });

  it("перенос задачи между командами: руководитель обеих команд или режим управления", async () => {
    const antonovTeam = await teamLedBy("Антонов");
    const tokovTeam = await teamLedBy("Токов");
    const t = await newTask(await actor("Антонов"), "Перенести в аналитику", await slugOf("Чемоданова"), antonovTeam.id);
    await expectRule(org.moveTask(await actor("Антонов"), t.number, tokovTeam.id), /руководитель обеих команд/);
    await org.moveTask(await actors.reva(), t.number, tokovTeam.id);
    expect((await svc.getTask(t.number))!.team).toBe(tokovTeam.id);
    const log = await prisma.auditLog.findFirst({ where: { entity: "task", entityId: String(t.number), field: "Команда" }, orderBy: { id: "desc" } });
    expect(log?.after).toBe(tokovTeam.name);
  });
});

describe("состав команд", () => {
  it("руководитель добавляет людей своей ветки, чужих добавляет владелец; топ-команду правит только владелец", async () => {
    const antonovTeam = await teamLedBy("Антонов");
    const antonov = await actor("Антонов");
    // Новикова из другого управления: Антонову её добавить нельзя
    await expectRule(org.addTeamMember(antonov, antonovTeam.id, await slugOf("Новикова")), /не из вашей ветки/);
    await org.addTeamMember(await actors.owner(), antonovTeam.id, await slugOf("Новикова"));
    await org.removeTeamMember(antonov, antonovTeam.id, await slugOf("Новикова"));
    await expectRule(org.addTeamMember(await actors.reva(), TOP_TEAM, await slugOf("Токов")), /меняют её руководитель и владелец/);
    await expectRule(org.updateTeam(await actors.owner(), TOP_TEAM, { leader: "reva" }), /Топ-командой руководит владелец/);
    await expectRule(org.updateTeam(await actors.owner(), (await teamLedBy("Рева")).id, { parent: antonovTeam.id }), /ниже своей же команды/);
    const logs = await prisma.auditLog.findMany({ where: { action: { in: ["team.member.add", "team.member.remove"] }, entityId: antonovTeam.id } });
    expect(logs).toHaveLength(2);
  });

  it("команду с открытыми задачами не выключить", async () => {
    const tokovTeam = await teamLedBy("Токов");
    await expectRule(org.updateTeam(await actors.owner(), tokovTeam.id, { active: false }), /открытых задач/);
  });
});

describe("weekly выбранной команды", () => {
  it("в ленте команды только её люди, общие записи без автора только у топ-команды", async () => {
    const antonovTeam = await teamLedBy("Антонов");
    const ids = [antonovTeam.leaderId!, ...antonovTeam.members.map((m) => m.personId)];
    const view = await getWeekView(null, new Date(), { personIds: ids, shared: false });
    expect(view.reports.map((r) => r.author).sort()).toEqual((await prisma.person.findMany({ where: { id: { in: ids } } })).map((p) => p.slug).sort());
    const topView = await getWeekView(null);
    expect(topView.reports.length).toBeGreaterThan(view.reports.length);
  });
});

describe("люди по командам", () => {
  it("общий логин выбирает только из топ-команды, коллеги: люди моих команд", async () => {
    const top = await prisma.person.findMany({ where: { active: true, ...topTeamOnly } });
    expect(top.some((p) => p.slug === "reva")).toBe(true);
    expect(top.some((p) => p.fullName.startsWith("Антонов"))).toBe(false);
    const alisa = await actor("Чемоданова");
    const colleagues = await prisma.person.findMany({ where: { id: { not: alisa.personId }, ...colleaguesOf(alisa.personId) } });
    expect(colleagues.map((p) => p.fullName)).toEqual(expect.arrayContaining(["Антонов Дмитрий Денисович"]));
    expect(colleagues.some((p) => p.slug === "loginova")).toBe(false);
  });

  it("страница «Структура»: вакансии видят руководители ветки, сотрудник нет", async () => {
    const reva = await actors.reva();
    const alisa = await actor("Чемоданова");
    const forReva = await structureView({ id: reva.personId, role: reva.role });
    const sector = forReva.units.find((u) => u.name === "Сектор автострахования")!;
    expect(sector.vacancies).toEqual(["PO KASKO"]);
    expect(sector.head?.fullName).toMatch(/^Антонов/);
    const forAlisa = await structureView({ id: alisa.personId, role: alisa.role });
    expect(forAlisa.units.find((u) => u.name === "Сектор автострахования")!.vacancies).toBeNull();
    const management = forReva.units.find((u) => u.name === "Управление развития продуктов")!;
    expect(management.total).toBeGreaterThanOrEqual(5);
  });
});
