// Этап 14: структура департамента и команды. Загрузка структуры, видимость по командам, права руководителя команды,
// состав команд, weekly выбранной команды. Топ-команда работает как раньше.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import { loadScope, TOP_TEAM } from "@/lib/org/scope";
import { structureView } from "@/lib/org/view";
import { readFileSync } from "node:fs";
import { currentReportingKey, getWeekView, saveEntry, setAbsence, setCeoFlag } from "@/lib/weekly/service";
import { currentCounts, reloadFromBord } from "@/lib/admin/reload";
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
  await prisma.absence.deleteMany({ where: { OR: [{ person: { role: "EMPLOYEE" } }, { substitute: { role: "EMPLOYEE" } }] } });
  await prisma.weeklyEntry.deleteMany({ where: { author: { role: "EMPLOYEE" } } });
  await prisma.weeklyReport.deleteMany({ where: { author: { role: "EMPLOYEE" } } });
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
    const mark = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? 0n;
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
    expect(await prisma.auditLog.count({ where: { action: "structure.import", id: { gt: mark } } })).toBe(1);
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

describe("границы прав по командам", () => {
  it("общий логин без режима управления видит только топ-команду и ничем не руководит", async () => {
    const reva = await actors.reva();
    const limited = await loadScope(prisma, { id: reva.personId, role: reva.role, limited: true });
    expect(limited.member).toEqual([TOP_TEAM]);
    expect(limited.visible).toEqual([TOP_TEAM]);
    expect(limited.leads).toEqual([]);
    const sectorTask = await newTask(await actors.owner(), "Задача сектора для проверки общего логина", await slugOf("Чемоданова"), (await teamLedBy("Антонов")).id);
    const viaTeam = { ...reva, via: "TEAM" as const };
    expect((await svc.listTasks({ reader: { personId: reva.personId, role: reva.role, limited: true } })).map((t) => t.number)).not.toContain(sectorTask.number);
    expect(await svc.getTask(sectorTask.number, { personId: reva.personId, role: reva.role, limited: true })).toBeNull();
    await expectRule(svc.addComment(viaTeam, sectorTask.number, "С общего логина"), new RegExp(`Задачи ${sectorTask.number} нет`));
    // По личной ссылке тот же человек видит команду сектора
    expect((await svc.listTasks({ reader: { personId: reva.personId, role: reva.role } })).map((t) => t.number)).toContain(sectorTask.number);
  });

  it("руководитель команды ставит «В работе», передаёт и зовёт соисполнителями только людей своих команд", async () => {
    const antonovTeam = await teamLedBy("Антонов");
    const antonov = await actor("Антонов");
    const novikova = await slugOf("Новикова");
    const proposed = await newTask(antonov, "Помочь с расчётом", novikova, antonovTeam.id);
    expect(proposed.status).toBe("proposed");
    const own = await newTask(antonov, "Своя задача сектора", await slugOf("Чемоданова"), antonovTeam.id);
    expect(own.status).toBe("in-progress");
    await expectRule(svc.assignOwner(antonov, own.number, novikova), /человеку из ваших команд/);
    await expectRule(svc.setCoExecutors(antonov, own.number, [novikova]), /людей своих команд/);
    // Владелец в режиме управления передаёт кому угодно
    const reassigned = await svc.assignOwner(await actors.owner(), own.number, novikova);
    expect(reassigned.task.owner).toBe(novikova);
  });

  it("функциональный руководитель видит задачу своего человека, но не комментирует её", async () => {
    const tokovTeam = await teamLedBy("Токов");
    const t = await newTask(await actors.owner(), "Отчёт по воронке", await slugOf("Иванова"), tokovTeam.id);
    const antonov = await actor("Антонов");
    expect(await svc.getTask(t.number, { personId: antonov.personId, role: antonov.role })).not.toBeNull();
    await expectRule(svc.addComment(antonov, t.number, "Посмотрел"), /не комментирует/);
    // Руководитель команды комментирует
    const tokov = await actor("Токов");
    expect((await svc.addComment(tokov, t.number, "Беру в работу")).task.number).toBe(t.number);
  });

  it("замещающего выбирают из коллег по команде", async () => {
    const week = await currentReportingKey();
    const alisa = await slugOf("Чемоданова");
    await expectRule(setAbsence(await actors.owner(), { slug: alisa, week, substitute: "loginova" }, new Date()), /из своей команды/);
    const ok = await setAbsence(await actors.owner(), { slug: alisa, week, substitute: await slugOf("Антонов") }, new Date());
    expect(ok.substitute).toBe(await slugOf("Антонов"));
    await prisma.absence.deleteMany();
  });

  it("запись другой команды с отметкой «В отчёт CEO» попадает в отчёт CEO, но не в ленту топ-команды", async () => {
    const week = await currentReportingKey();
    const antonov = await actor("Антонов");
    const entry = await saveEntry(antonov, { week, direction: "osago", block: "product", type: "event", what: "Запустили новую форму расчёта ОСАГО" });
    const top = await prisma.team.findUniqueOrThrow({ where: { id: TOP_TEAM }, include: { members: true } });
    const topIds = [top.leaderId!, ...top.members.map((m) => m.personId)];
    const topFeed = await getWeekView(week, new Date(), { personIds: topIds, shared: true });
    expect(topFeed.entries.some((e) => e.id === entry.id)).toBe(false);
    await setCeoFlag(await actors.owner(), entry.id, true);
    const ceo = await getWeekView(week, new Date(), { personIds: topIds, shared: true, ceo: true });
    expect(ceo.entries.some((e) => e.id === entry.id)).toBe(true);
    await prisma.weeklyEntry.delete({ where: { id: entry.id } });
  });

  it("перезаливка из Bord трогает только топ-команду: задачи других команд остаются", async () => {
    const antonovTeam = await teamLedBy("Антонов");
    const kept = await newTask(await actor("Антонов"), "Задача сектора переживёт перезаливку", await slugOf("Чемоданова"), antonovTeam.id);
    const before = await currentCounts(prisma);
    expect(before.tasks).toBe(await prisma.task.count({ where: { teamId: TOP_TEAM } }));
    const owner = await actors.owner();
    await reloadFromBord(prisma, readFileSync("data/bord/zadachi-2026-10-05.csv", "utf8"), readFileSync("data/bord/weekly-ceo-2026-10-05.csv", "utf8"), {
      batch: "org-test",
      actor: { personId: owner.personId, name: owner.fullName, source: "SYSTEM" },
    });
    const row = await prisma.task.findFirst({ where: { title: "Задача сектора переживёт перезаливку" } });
    expect(row?.number).toBe(kept.number);
    expect(row?.teamId).toBe(antonovTeam.id);
    expect(await prisma.task.count({ where: { teamId: TOP_TEAM } })).toBeGreaterThan(0);
    // Новый номер не совпадает ни с одной задачей
    const fresh = await newTask(owner, "Задача после перезаливки", "reva");
    expect(await prisma.task.count({ where: { number: fresh.number } })).toBe(1);
  });
});

describe("повторная загрузка с изменённой структурой", () => {
  // Аналитику переименовали и подчинили Головкину, Иванова перешла к Антонову, финансовую координацию расформировали
  const CHANGED = [
    ["ФИО", "Должность", "Управление", "Отдел", "Сектор", "Руководитель", "Функциональный руководитель", "Руководит"],
    ["Рева Тарас Игоревич", "CPO", "Управление развития продуктов", "", "", "Мурадян Арам", "", "да"],
    ["Антонов Дмитрий Денисович", "PO OSAGO", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "Рева Тарас", "", "да"],
    ["Чемоданова Алиса Владимировна", "Product Designer", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "", "", ""],
    ["Токов Никита", "Team Lead", "Управление развития продуктов", "Аналитика продукта", "", "Головкин Владислав", "", "да"],
    ["Иванова Мария", "Аналитик", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "Антонов Дмитрий", "", ""],
    ["Головкин Влад", "Заместитель директора", "Управление бизнес развития", "", "", "Мурадян Арам", "", "да"],
    ["Радионов Александр", "Head of Sales support", "Управление бизнес развития", "", "", "Головкин Владислав", "", ""],
    ["Новикова Екатерина", "Finance coordinator", "Управление бизнес развития", "", "", "Радионов Александр", "", ""],
  ]
    .map((r) => r.join("\t"))
    .join("\n");

  it("переименованное подразделение сохраняет команду, ушедший из подчинения уходит из команды, команда выше пересчитывается", async () => {
    const tokovBefore = await teamLedBy("Токов");
    const plan = await org.previewStructure(await actors.owner(), CHANGED);
    expect(plan.problems).toEqual([]);
    expect(plan.units.add).toContain("Управление развития продуктов / Аналитика продукта");
    expect(plan.units.remove).toEqual(expect.arrayContaining(["Управление развития продуктов / Продуктовая аналитика", "Управление бизнес развития / Финансовая координация"]));
    await org.applyStructure(await actors.owner(), CHANGED);

    // Команда Токова та же, называется по новому подразделению и стоит под командой Головкина
    const tokov = await teamLedBy("Токов");
    expect(tokov.id).toBe(tokovBefore.id);
    expect(tokov.name).toBe("Аналитика продукта");
    expect(tokov.parentId).toBe((await teamLedBy("Головкин")).id);
    // Иванова ушла из команды Токова (добавлена по структуре) и пришла в команду Антонова
    expect(tokov.members.some((m) => m.person.fullName.startsWith("Иванова"))).toBe(false);
    expect((await teamLedBy("Антонов")).members.map((m) => m.person.fullName)).toEqual(expect.arrayContaining(["Иванова Мария"]));
    // В команде Ревы Иванову добавили руками: там она осталась
    expect((await teamLedBy("Рева")).members.some((m) => m.person.fullName.startsWith("Иванова"))).toBe(true);
    // Расформированное подразделение выключено, старое имя аналитики тоже
    expect((await prisma.orgUnit.findFirstOrThrow({ where: { name: "Финансовая координация" } })).active).toBe(false);
    expect((await prisma.orgUnit.findFirstOrThrow({ where: { name: "Продуктовая аналитика" } })).active).toBe(false);
    // Радионов больше не руководит подразделением, но Новикова подчиняется ему: команда остаётся
    const radionov = await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: "Радионов" } }, include: { headOf: { where: { active: true } } } });
    expect(radionov.headOf).toHaveLength(0);
    expect((await teamLedBy("Радионов")).members.map((m) => m.person.fullName)).toEqual(["Новикова Екатерина"]);
    // Функционального руководителя в файле больше нет: связь снята
    const ivanova = await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: "Иванова" } } });
    expect(ivanova.functionalManagerId).toBeNull();
  });

  it("смена руководителя подразделения: команда переходит к новому руководителю, прежний становится участником", async () => {
    const sector = await teamLedBy("Антонов");
    const swapped = CHANGED.replace(
      "Антонов Дмитрий Денисович\tPO OSAGO\tУправление развития продуктов\tОтдел развития продуктов\tСектор автострахования\tРева Тарас\t\tда",
      "Антонов Дмитрий Денисович\tPO OSAGO\tУправление развития продуктов\tОтдел развития продуктов\tСектор автострахования\tЧемоданова Алиса\t\t",
    )
      .replace(
        "Чемоданова Алиса Владимировна\tProduct Designer\tУправление развития продуктов\tОтдел развития продуктов\tСектор автострахования\t\t\t",
        "Чемоданова Алиса Владимировна\tProduct Designer\tУправление развития продуктов\tОтдел развития продуктов\tСектор автострахования\tРева Тарас\t\tда",
      )
      .replace("Сектор автострахования\tАнтонов Дмитрий\t\t", "Сектор автострахования\t\t\t");
    const plan = await org.previewStructure(await actors.owner(), swapped);
    expect(plan.problems).toEqual([]);
    await org.applyStructure(await actors.owner(), swapped);
    const team = await prisma.team.findUniqueOrThrow({ where: { id: sector.id }, include: { leader: true, members: { include: { person: true } } } });
    expect(team.leader?.fullName).toMatch(/^Чемоданова/);
    expect(team.members.map((m) => m.person.fullName)).toEqual(expect.arrayContaining(["Антонов Дмитрий Денисович", "Иванова Мария"]));
    expect(team.members.some((m) => m.person.fullName.startsWith("Чемоданова"))).toBe(false);
    const unit = await prisma.orgUnit.findFirstOrThrow({ where: { name: "Сектор автострахования", active: true }, include: { head: true } });
    expect(unit.head?.fullName).toMatch(/^Чемоданова/);
  });
});
