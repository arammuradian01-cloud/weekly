// Этап 53: структура всей компании. Корень «компания» над департаментами, генеральный директор во главе, команды
// на трёх уровнях, топ-команда под командой генерального директора, загрузка файла департамента не трогает другие
// департаменты, руководитель собирает команду из людей других веток с уведомлением их руководителю.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import { loadScope, TOP_TEAM } from "@/lib/org/scope";
import { structureView } from "@/lib/org/view";
import { peopleTree } from "@/lib/org/people-tree";
import { entryReaders } from "@/lib/discuss/access";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";

const future = addDays(moscowToday(), 10);
const owner = () => svc.actorFor("muradyan", "OWNER");
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(svc.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

const INS = "Департамент страхования и инвестиций";
const FIN = "Финансовый департамент";
const MKT = "Департамент маркетинга";

// Файл всей компании: колонка «Департамент», генеральный директор без подразделения, у маркетинга руководителя нет
// (вакансия CMO), клиентский сервис прямо под генеральным
const COMPANY = [
  ["ФИО", "Должность", "Департамент", "Управление", "Отдел", "Сектор", "Руководитель", "Функциональный руководитель", "Руководит", "Статус"],
  ["Крайник Александр", "CEO", "", "", "", "", "", "", "да", ""],
  ["Тимохина Ирина Владимировна", "CEO Assistant", "", "", "", "", "Крайник Александр", "", "", ""],
  ["Мурадян Арам", "Директор департамента", INS, "", "", "", "", "", "да", ""],
  ["Головкин Владислав", "Director of Insurance", INS, "Управление бизнес развития", "", "", "", "", "да", ""],
  ["Фатьянов Евгений Анатольевич", "Head of Sales", INS, "Управление бизнес развития", "Отдел по развитию бизнеса", "", "", "", "", ""],
  ["Чейченец Евгений Андреевич", "Sales manager", INS, "Управление бизнес развития", "Отдел по развитию бизнеса", "", "", "", "", ""],
  ["Рева Тарас Игоревич", "CPO", INS, "Управление продуктового развития (insurance)", "", "", "", "", "да", ""],
  ["Токов Никита Андреевич", "Analytics Lead", INS, "Управление продуктового развития (insurance)", "Отдел аналитики (insurance)", "", "", "", "", ""],
  ["Харченко Артём", "CFO", FIN, "", "", "", "", "", "да", ""],
  ["Кацемба Наталья Сергеевна", "Chief Accountant", FIN, "Управление финансового учёта и контроля", "", "", "", "", "да", ""],
  ["Погосова Сабина Левоновна", "Finance coordinator", FIN, "Управление финансового учёта и контроля", "Отдел финансового сопровождения бизнеса", "Направление доходного учета", "", "", "", ""],
  ["Евдокимова Екатерина Валерьевна", "Head of Support Service", "", "Управление клиентским сервисом", "", "", "", "", "да", ""],
  ["Плохих Наталья Васильевна", "Lead of Support Group", "", "Управление клиентским сервисом", "Отдел клиентской поддержки", "Сектор клиентской поддержки", "", "", "", ""],
  ["", "CMO", MKT, "", "", "", "", "", "", "вакансия"],
  ["Григорьев Никита Сергеевич", "Head of Acquistition", MKT, "Управление привлечения трафика", "", "", "", "", "да", ""],
  ["Багненко Артем Игоревич", "Head of SEO", MKT, "Управление привлечения трафика", "Отдел органического и SEO привлечения", "", "", "", "", ""],
  ["", "SEO specialist", MKT, "Управление привлечения трафика", "Отдел органического и SEO привлечения", "", "", "", "", "вакансия"],
]
  .map((r) => r.join(";"))
  .join("\n");

const person = (start: string) => prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } } });
const actorOf = async (start: string) => svc.actorFor((await person(start)).slug);
const unitNamed = (name: string) => prisma.orgUnit.findFirstOrThrow({ where: { name, active: true } });
const teamLedBy = async (start: string) => prisma.team.findFirstOrThrow({ where: { leader: { fullName: { startsWith: start } }, kind: "UNIT" }, include: { members: { include: { person: true } } } });

/** Подразделения удаляются с листьев: у дерева внешний ключ на родителя без каскада */
async function deleteUnits() {
  for (let i = 0; i < 10; i++) {
    const left = await prisma.orgUnit.count();
    if (!left) return;
    await prisma.orgUnit.deleteMany({ where: { children: { none: {} } } });
  }
}

async function clean() {
  await prisma.task.deleteMany();
  await prisma.teamMember.deleteMany({ where: { teamId: { not: TOP_TEAM } } });
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
  await clean();
  // Как на стенде до этапа 53: структура департамента уже загружена файлом без колонки «Департамент»
  await org.applyStructure(await owner(), [
    ["ФИО", "Должность", "Управление", "Руководитель", "Руководит"],
    ["Головкин Владислав", "Заместитель директора", "Управление бизнес развития", "Мурадян Арам", "да"],
    ["Фатьянов Евгений", "Head of Sales", "Управление бизнес развития", "", ""],
  ].map((r) => r.join(";")).join("\n"));
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("загрузка структуры всей компании", () => {
  it("предпросмотр ничего не меняет и показывает пути от компании", async () => {
    const plan = await org.previewStructure(await owner(), COMPANY);
    expect(plan.company).toBe(true);
    expect(plan.problems).toEqual([]);
    expect(plan.units.add).toContain(FIN);
    expect(plan.units.add).toContain("Управление клиентским сервисом");
    // Департамент, загруженный раньше, узнаётся по имени со своими управлениями
    expect(plan.units.add).not.toContain(INS);
    expect(plan.units.add).not.toContain(`${INS} / Управление бизнес развития`);
    expect(plan.vacancies).toHaveLength(2);
    expect(await prisma.orgUnit.count({ where: { kind: "COMPANY" } })).toBe(0);
  });

  it("компания во главе, департамент страхования под ней, руководители по уровням", async () => {
    const before = await prisma.orgUnit.findFirstOrThrow({ where: { kind: "DEPARTMENT" } });
    await org.applyStructure(await owner(), COMPANY);
    const company = await prisma.orgUnit.findFirstOrThrow({ where: { kind: "COMPANY" }, include: { head: true } });
    expect(company.name).toBe("Сравни");
    expect(company.head?.fullName).toMatch(/^Крайник/);
    const ins = await prisma.orgUnit.findUniqueOrThrow({ where: { id: before.id } });
    expect(ins.parentId).toBe(company.id);
    expect(ins.kind).toBe("DEPARTMENT");
    expect((await unitNamed(FIN)).kind).toBe("DEPARTMENT");
    expect((await unitNamed("Управление клиентским сервисом")).parentId).toBe(company.id);
    expect((await unitNamed("Управление клиентским сервисом")).kind).toBe("MANAGEMENT");
    // Подчинение: топ-менеджеры у генерального, руководители управлений у топ-менеджеров, люди у своих руководителей
    const managerOf = async (start: string) => (await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } }, include: { manager: true } })).manager?.fullName ?? null;
    expect(await managerOf("Мурадян")).toMatch(/^Крайник/);
    expect(await managerOf("Харченко")).toMatch(/^Крайник/);
    expect(await managerOf("Евдокимова")).toMatch(/^Крайник/);
    expect(await managerOf("Головкин")).toMatch(/^Мурадян/);
    expect(await managerOf("Рева")).toMatch(/^Мурадян/);
    expect(await managerOf("Фатьянов")).toMatch(/^Головкин/);
    expect(await managerOf("Погосова")).toMatch(/^Кацемба/);
    // У маркетинга руководитель не выделен (вакансия CMO): руководитель управления у генерального
    expect(await managerOf("Григорьев")).toMatch(/^Крайник/);
    expect(await managerOf("Крайник")).toBeNull();
    // Логины всем новым людям
    expect((await person("Крайник")).login).toBe("akraynik");
  });

  it("команды на трёх уровнях: генеральный, топ-менеджеры, руководители управлений; топ-команда под генеральным", async () => {
    const ceo = await teamLedBy("Крайник");
    expect(ceo.name).toBe("Команда генерального директора");
    expect(ceo.parentId).toBeNull();
    const names = ceo.members.map((m) => m.person.fullName);
    for (const n of ["Мурадян", "Харченко", "Евдокимова", "Григорьев", "Тимохина"]) expect(names.some((x) => x.startsWith(n))).toBe(true);
    const top = await prisma.team.findUniqueOrThrow({ where: { id: TOP_TEAM } });
    expect(top.parentId).toBe(ceo.id);
    const fin = await teamLedBy("Харченко");
    expect(fin.name).toBe(FIN);
    expect(fin.parentId).toBe(ceo.id);
    expect(fin.members.map((m) => m.person.fullName).some((x) => x.startsWith("Кацемба"))).toBe(true);
    const acc = await teamLedBy("Кацемба");
    expect(acc.parentId).toBe(fin.id);
    // Головкин подчиняется Араму, руководителю топ-команды: его команда под топ-командой
    expect((await teamLedBy("Головкин")).parentId).toBe(TOP_TEAM);
    // Пока генеральный не владелец, он видит свою ветку: свою команду и все команды ниже, топ-команду как участник
    const krainik = await person("Крайник");
    const scope = await loadScope(prisma, { id: krainik.id, role: krainik.role });
    expect(scope.leads).toContain(ceo.id);
    expect(scope.leads).toContain(fin.id);
    expect(scope.leads).not.toContain(TOP_TEAM);
  });

  it("дерево подчинённых начинается с генерального, структура показывает компанию и департаменты", async () => {
    const krainik = await person("Крайник");
    const tree = await peopleTree({ id: krainik.id, role: krainik.role });
    expect(tree.roots[0]).toBe(krainik.slug);
    const view = await structureView({ id: krainik.id, role: krainik.role });
    expect(view.units[0]!.kind).toBe("COMPANY");
    expect(view.units[0]!.depth).toBe(0);
    expect(view.units.find((u) => u.name === FIN)?.kindLabel).toBe("Департамент");
    // Вакансии своей ветки генеральный видит
    expect(view.units.find((u) => u.name === MKT)?.vacancies).toEqual(["CMO"]);
  });

  it("файл департамента без колонки «Департамент» трогает только свой департамент", async () => {
    const plan = await org.previewStructure(await owner(), [
      ["ФИО", "Должность", "Управление", "Руководит"],
      ["Головкин Владислав", "Director of Insurance", "Управление бизнес развития", "да"],
      ["Фатьянов Евгений", "Head of Sales", "Управление бизнес развития", ""],
      ["Чейченец Евгений", "Sales manager", "Управление бизнес развития", ""],
      ["Рева Тарас", "CPO", "Управление продуктового развития (insurance)", "да"],
      ["Токов Никита", "Analytics Lead", "Управление продуктового развития (insurance)", ""],
    ].map((r) => r.join(";")).join("\n"));
    expect(plan.company).toBe(false);
    // Другие департаменты не уходят, их люди не числятся «нет в файле»
    expect(plan.units.remove.some((u) => u.includes("финансового"))).toBe(false);
    expect(plan.people.missing.some((p) => p.fullName.startsWith("Харченко"))).toBe(false);
    expect(plan.people.missing.some((p) => p.fullName.startsWith("Крайник"))).toBe(false);
  });

  it("повторная загрузка того же файла ничего не ломает", async () => {
    const before = await prisma.team.count();
    const r = await org.applyStructure(await owner(), COMPANY);
    expect(r.added).toBe(0);
    expect(await prisma.team.count()).toBe(before);
    expect(await prisma.orgUnit.count({ where: { kind: "COMPANY" } })).toBe(1);
  });
});

describe("руководитель собирает команду из разных веток", () => {
  it("человек из другого департамента входит с согласия своего руководителя; до согласия его weekly не виден", async () => {
    const golovkin = { ...(await actorOf("Головкин")), via: "PASSWORD" as const };
    const team = await teamLedBy("Головкин");
    const pogosova = await person("Погосова");
    const candidates = await org.memberCandidates(golovkin);
    expect(candidates.find((c) => c.slug === pogosova.slug)?.own).toBe(false);
    const fatyanov = await person("Фатьянов");
    expect(candidates.find((c) => c.slug === fatyanov.slug)?.own).toBe(true);
    // Запись weekly Погосовой: пока она не в команде, руководитель чужой команды её не видит
    const entry = { authorId: pogosova.id, ceo: false, promotedBy: [] as string[] };
    const reva = await person("Рева");
    const r = await org.addTeamMember(golovkin, team.id, pogosova.slug);
    expect(r).toMatchObject({ added: false, external: true, pendingWith: expect.stringMatching(/^Кацемба/) });
    expect(await prisma.teamMember.count({ where: { teamId: team.id, personId: pogosova.id } })).toBe(0);
    expect(await entryReaders(prisma, entry, [reva.id])).toEqual([]);
    await expectRule(org.addTeamMember(golovkin, team.id, pogosova.slug), /ждёт согласия/);
    const request = await prisma.teamJoinRequest.findFirstOrThrow({ where: { teamId: team.id, personId: pogosova.id, status: "PENDING" } });
    expect((await prisma.inboxEvent.findFirstOrThrow({ where: { subject: `join:${request.id}` }, include: { recipient: true } })).recipient.fullName).toMatch(/^Кацемба/);
    // Решает только руководитель человека или владелец
    await expectRule(org.decideJoinRequest(golovkin, request.id, true), /руководитель человека/);
    const katsemba = { ...(await actorOf("Кацемба")), via: "PASSWORD" as const };
    expect((await org.joinRequestsFor(katsemba)).toApprove.map((x) => x.id)).toEqual([request.id]);
    await org.decideJoinRequest(katsemba, request.id, true);
    const member = await prisma.teamMember.findUniqueOrThrow({ where: { teamId_personId: { teamId: team.id, personId: pogosova.id } } });
    expect(member.external).toBe(true);
    const events = await prisma.inboxEvent.findMany({ where: { kind: "TEAM", subject: `team:${team.id}:${pogosova.id}` }, include: { recipient: true } });
    expect(events.map((e) => e.recipient.fullName).sort()).toEqual([golovkin.fullName, pogosova.fullName].sort());
    // Своего человека руководитель добавляет сразу, без запроса и уведомлений
    const cheychenets = await person("Чейченец");
    await prisma.teamMember.deleteMany({ where: { teamId: team.id, personId: cheychenets.id } });
    expect(await org.addTeamMember(golovkin, team.id, cheychenets.slug)).toEqual({ added: true, external: false });
    expect(await prisma.inboxEvent.count({ where: { kind: "TEAM", subject: `team:${team.id}:${cheychenets.id}` } })).toBe(0);
  });

  it("отказ и отмена запроса; владелец добавляет сразу, руководитель человека узнаёт", async () => {
    const reva = { ...(await actorOf("Рева")), via: "PASSWORD" as const };
    const team = await teamLedBy("Рева");
    const plokhikh = await person("Плохих");
    const first = await org.addTeamMember(reva, team.id, plokhikh.slug);
    expect(first.added).toBe(false);
    const req = await prisma.teamJoinRequest.findFirstOrThrow({ where: { personId: plokhikh.id, status: "PENDING" } });
    const evdokimova = { ...(await actorOf("Евдокимова")), via: "PASSWORD" as const };
    await org.decideJoinRequest(evdokimova, req.id, false);
    expect(await prisma.teamMember.count({ where: { teamId: team.id, personId: plokhikh.id } })).toBe(0);
    await org.addTeamMember(reva, team.id, plokhikh.slug);
    const again = await prisma.teamJoinRequest.findFirstOrThrow({ where: { personId: plokhikh.id, status: "PENDING" } });
    await org.cancelJoinRequest(reva, again.id);
    // Владелец в режиме управления добавляет сразу: человек и его руководитель получают по своей строке в «Мне»
    const r = await org.addTeamMember(await owner(), team.id, plokhikh.slug);
    expect(r).toEqual({ added: true, external: true });
    const to = (await prisma.inboxEvent.findMany({ where: { kind: "TEAM", subject: `team:${team.id}:${plokhikh.id}` }, include: { recipient: true } })).map((e) => e.recipient.fullName);
    expect(to.some((n) => n.startsWith("Евдокимова"))).toBe(true);
    expect(to.some((n) => n.startsWith("Плохих"))).toBe(true);
  });

  it("задачи участника из другой ветки видны руководителю только в его команде", async () => {
    // Рева лидер, а не администратор: администратор видит все команды и так
    const reva = { ...(await actorOf("Рева")), via: "PASSWORD" as const };
    const team = await teamLedBy("Рева");
    const pogosova = await person("Погосова");
    await org.addTeamMember(await owner(), team.id, pogosova.slug);
    const katsemba = await actorOf("Кацемба");
    const acc = await teamLedBy("Кацемба");
    const inFinance = await svc.createTask(katsemba, { title: "Сверка доходов за октябрь", outcome: "Сверка готова", owner: pogosova.slug, direction: "department", due: future, team: acc.id });
    const inMine = await svc.createTask(reva, { title: "Отчёт по комиссиям партнёров", outcome: "Отчёт готов", owner: pogosova.slug, direction: "department", due: future, team: team.id });
    // Задача участнику из другой ветки предлагается, а не ставится сразу: он сначала соглашается
    expect(inMine.task.status).toBe("proposed");
    const scope = await loadScope(prisma, { id: reva.personId, role: reva.role });
    expect(scope.leadPeople).not.toContain(pogosova.id);
    const seen = (await svc.listTasks({ reader: { personId: reva.personId, role: reva.role } })).map((t) => t.number);
    expect(seen).toContain(inMine.task.number);
    expect(seen).not.toContain(inFinance.task.number);
  });

  it("пометка «из другой ветки» пересчитывается: человек перешёл в ветку руководителя команды", async () => {
    const team = await teamLedBy("Рева");
    const pogosova = await person("Погосова");
    await prisma.person.update({ where: { id: pogosova.id }, data: { managerId: (await person("Рева")).id } });
    await prisma.$transaction((tx) => org.recomputeExternal(tx));
    expect((await prisma.teamMember.findUniqueOrThrow({ where: { teamId_personId: { teamId: team.id, personId: pogosova.id } } })).external).toBe(false);
    await prisma.person.update({ where: { id: pogosova.id }, data: { managerId: (await person("Кацемба")).id } });
    await prisma.$transaction((tx) => org.recomputeExternal(tx));
    expect((await prisma.teamMember.findUniqueOrThrow({ where: { teamId_personId: { teamId: team.id, personId: pogosova.id } } })).external).toBe(true);
  });
});

describe("режим загрузки после проверки кода", () => {
  it("файл одного департамента с колонкой «Департамент» грузится только в него и называет корень", async () => {
    const plan = await org.previewStructure(await owner(), [
      ["ФИО", "Должность", "Департамент", "Управление", "Руководит"],
      ["Харченко Артём", "CFO", FIN, "", "да"],
      ["Кацемба Наталья Сергеевна", "Chief Accountant", FIN, "Управление финансового учёта и контроля", "да"],
    ].map((r) => r.join(";")).join("\n"));
    expect(plan.company).toBe(false);
    expect(plan.root).toBe(FIN);
    expect(plan.units.remove.some((u) => u.includes("клиентским"))).toBe(false);
    expect(plan.people.missing.some((p) => p.fullName.startsWith("Евдокимова"))).toBe(false);
    // Незнакомый департамент: ошибка, а не загрузка в чужой
    const bad = await org.previewStructure(await owner(), [["ФИО", "Департамент"], ["Харченко Артём", "Департамент снабжения"]].map((r) => r.join(";")).join("\n"));
    expect(bad.problems.some((p) => /нет в структуре/.test(p.text))).toBe(true);
  });

  it("два руководителя одного подразделения в файле: ошибка", async () => {
    const plan = await org.previewStructure(await owner(), [
      ["ФИО", "Департамент", "Руководит"],
      ["Крайник Александр", "", "да"],
      ["Харченко Артём", "", "да"],
    ].map((r) => r.join(";")).join("\n"));
    expect(plan.problems.some((p) => /уже есть руководитель/.test(p.text))).toBe(true);
  });

  it("выключенное подразделение снова в файле включается, второе такое же не заводится, люди возвращаются", async () => {
    const unit = await unitNamed("Управление клиентским сервисом");
    await org.updateUnit(await owner(), unit.id, { active: false });
    const plan = await org.previewStructure(await owner(), COMPANY);
    expect(plan.people.change.some((p) => p.fullName.startsWith("Евдокимова"))).toBe(true);
    await org.applyStructure(await owner(), COMPANY);
    expect(await prisma.orgUnit.count({ where: { name: "Управление клиентским сервисом" } })).toBe(1);
    expect((await prisma.orgUnit.findUniqueOrThrow({ where: { id: unit.id } })).active).toBe(true);
    expect((await person("Евдокимова")).unitId).toBe(unit.id);
  });

  it("без команды генерального команды департаментов не встают под топ-команду", async () => {
    const ceo = await teamLedBy("Крайник");
    await prisma.team.update({ where: { id: ceo.id }, data: { active: false } });
    try {
      await org.syncTeams(await owner());
      expect((await teamLedBy("Харченко")).parentId).not.toBe(TOP_TEAM);
    } finally {
      await prisma.team.update({ where: { id: ceo.id }, data: { active: true } });
      await org.syncTeams(await owner());
    }
    expect((await teamLedBy("Харченко")).parentId).toBe(ceo.id);
  });
});

describe("правка структуры с компанией", () => {
  it("компанию не выключить и не перенести, департамент под ней правится и заводится", async () => {
    const company = await prisma.orgUnit.findFirstOrThrow({ where: { kind: "COMPANY" } });
    await expectRule(org.updateUnit(await owner(), company.id, { active: false }), /Компанию выключить нельзя/);
    await expectRule(org.updateUnit(await owner(), company.id, { parent: (await unitNamed(FIN)).id }), /на самом верху/);
    await expectRule(org.updateUnit(await owner(), (await unitNamed(FIN)).id, { kind: "COMPANY" }), /Компания в структуре одна/);
    await org.updateUnit(await owner(), (await unitNamed(FIN)).id, { name: "Финансовый департамент (CFO)" });
    await org.updateUnit(await owner(), (await unitNamed("Финансовый департамент (CFO)")).id, { name: FIN });
    const created = await org.createUnit(await owner(), { name: "Департамент МСБ", kind: "DEPARTMENT" });
    expect((await prisma.orgUnit.findUniqueOrThrow({ where: { id: created.id } })).parentId).toBe(company.id);
    await expectRule(org.createUnit(await owner(), { name: "Вторая компания", kind: "COMPANY" }), /Выберите уровень/);
  });
});
