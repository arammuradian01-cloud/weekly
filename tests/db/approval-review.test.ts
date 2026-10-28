// Этап 54, правки после проверки кода: обходы согласования и устаревшее состояние. Сценарии R1-R12 ревьюера
// записаны проверками: отказ в передаче, открытие отклонённой задачи, общий логин, соисполнители, просьба, повтор,
// история, режим управления, смена структуры и выключенный согласующий.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import * as req from "@/lib/requests/service";
import { setPersonActive } from "@/lib/admin/service";
import { listInbox } from "@/lib/inbox/service";
import { TOP_TEAM } from "@/lib/org/scope";
import { APPROVAL_KEY, approvalDepartments, approvalRule, loadApprovalSetting } from "@/lib/tasks/approval";
import { saveApprovalSetting } from "@/lib/tasks/approval-settings";
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
const rows = (pogosovaUnit = "Управление финансового учёта и контроля") =>
  [
    ["ФИО", "Должность", "Департамент", "Управление", "Руководитель", "Руководит"],
    ["Крайник Александр", "CEO", "", "", "", "да"],
    ["Мурадян Арам", "Директор департамента", INS, "", "", "да"],
    ["Рева Тарас Игоревич", "CPO", INS, "Управление продуктового развития (insurance)", "", "да"],
    ["Токов Никита Андреевич", "Analytics Lead", INS, "Управление продуктового развития (insurance)", "", ""],
    ["Харченко Артём", "CFO", FIN, "", "", "да"],
    ["Кацемба Наталья Сергеевна", "Chief Accountant", FIN, "Управление финансового учёта и контроля", "", "да"],
    ["Погосова Сабина Левоновна", "Finance coordinator", FIN, pogosovaUnit, "", ""],
    ["Комаричев Сергей Владимирович", "Head of Data", FIN, "Управление хранения данных", "", "да"],
    ["Белов Иван Петрович", "Data engineer", FIN, "Управление хранения данных", "", ""],
  ]
    .map((r) => r.join(";"))
    .join("\n");

const person = (start: string) => prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } } });
const actorOf = async (start: string, via: "PASSWORD" | "TEAM" = "PASSWORD") => ({ ...(await svc.actorFor((await person(start)).slug)), via });
const teamLedBy = (start: string) => prisma.team.findFirstOrThrow({ where: { leader: { fullName: { startsWith: start } }, kind: "UNIT" } });
const newTask = async (a: svc.Actor, ownerSlug: string, team: string, title: string, extra: Partial<svc.NewTaskInput> = {}) =>
  (await svc.createTask(a, { title, outcome: "Готово", owner: ownerSlug, direction: "department", due: future, team, ...extra })).task;
const row = (number: number) => prisma.task.findUniqueOrThrow({ where: { number }, select: { id: true, status: true, approvalState: true, approverId: true, approvalFromId: true, ownerId: true, repeat: true } });
const openApprovals = async (start: string, number: number) =>
  prisma.inboxEvent.count({ where: { kind: "APPROVAL", doneAt: null, task: { number }, recipient: { fullName: { startsWith: start } } } });

async function clean() {
  await prisma.task.deleteMany();
  await prisma.helpRequest.deleteMany();
  await prisma.teamJoinRequest.deleteMany();
  await prisma.teamMember.deleteMany({ where: { teamId: { not: TOP_TEAM } } });
  await prisma.goal.deleteMany();
  await prisma.team.deleteMany({ where: { id: { not: TOP_TEAM } } });
  await prisma.person.updateMany({ data: { unitId: null, managerId: null, functionalManagerId: null, position: null } });
  await prisma.inboxEvent.deleteMany();
  await prisma.weeklyEntry.deleteMany({ where: { author: { role: "EMPLOYEE" } } });
  await prisma.weeklyReport.deleteMany({ where: { author: { role: "EMPLOYEE" } } });
  await prisma.person.deleteMany({ where: { role: "EMPLOYEE" } });
  await prisma.vacancy.deleteMany();
  for (let i = 0; i < 10 && (await prisma.orgUnit.count()); i++) await prisma.orgUnit.deleteMany({ where: { children: { none: {} } } });
  await prisma.setting.deleteMany({ where: { key: APPROVAL_KEY } });
}

let reva: svc.Actor;
let revaTeam: string;
let finId: string;

beforeAll(async () => {
  await clean();
  await org.applyStructure(await owner(), rows());
  revaTeam = (await teamLedBy("Рева")).id;
  await org.addTeamMember(await owner(), revaTeam, (await person("Погосова")).slug);
  await org.addTeamMember(await owner(), revaTeam, (await person("Белов")).slug);
  finId = (await approvalDepartments()).find((d) => d.name === FIN)!.id;
  await saveApprovalSetting(await owner(), { default: "inform", departments: { [finId]: "approve" } });
  reva = await actorOf("Рева");
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("передача на согласовании", () => {
  it("R11: отказ возвращает задачу прежнему ответственному в прежний статус, серия и соисполнители как были", async () => {
    const tok = await actorOf("Токов");
    const t = await newTask(reva, tok.slug, revaTeam, "R11 передача", { repeat: { kind: "weekly", mode: "on-close" } });
    const h = await svc.handOver(tok, t.number, (await person("Погосова")).slug as never, "Сабина доделает");
    expect(h.task.status).toBe("proposed");
    expect(h.task.approval).toMatchObject({ state: "pending", approver: (await person("Кацемба")).slug, from: tok.slug });
    // Перевод в «Предложена» виден в истории задачи
    expect((await svc.taskHistory(t.number)).some((x) => x.field === "Статус" && /ждёт согласования/.test(x.after ?? ""))).toBe(true);
    expect(await openApprovals("Кацемба", t.number)).toBe(1);
    const r = await svc.changeStatus(await actorOf("Кацемба"), t.number, "cancelled", "Сабина закрывает квартал");
    expect(r.task.status).toBe("in-progress");
    expect(r.task.owner).toBe(tok.slug);
    expect(r.task.approval).toBeUndefined();
    expect(r.task.repeat?.kind).toBe("weekly");
    expect(r.task.coExecutors).not.toContain(tok.slug);
    expect(await openApprovals("Кацемба", t.number)).toBe(0);
    const toTokov = await prisma.inboxEvent.findFirstOrThrow({ where: { task: { number: t.number }, kind: "TASK_ASSIGNED", text: { contains: "передачу" }, recipient: { fullName: { startsWith: "Токов" } } } });
    expect(toTokov.text).toMatch(/не согласовал передачу, задача снова у вас/);
    const toPogosova = await prisma.inboxEvent.findFirstOrThrow({ where: { task: { number: t.number }, kind: "TASK_CONFIRMED", recipient: { fullName: { startsWith: "Погосова" } } } });
    expect(toPogosova.text).toMatch(/Передачу задачи не согласовали, она вернулась прежнему ответственному/);
  });

  it("R12: правило считается от автора задачи, а не от того, кто передаёт внутри финансов", async () => {
    const t = await newTask(reva, (await person("Погосова")).slug, revaTeam, "R12 внутри департамента");
    await svc.changeStatus(await actorOf("Кацемба"), t.number, "in-progress");
    const h = await svc.handOver(await actorOf("Погосова"), t.number, (await person("Белов")).slug as never, "Иван доделает");
    expect(h.task.approval).toMatchObject({ state: "pending", approver: (await person("Комаричев")).slug });
    expect(await openApprovals("Комаричев", t.number)).toBe(1);
    // Согласие: задача в работе у Белова, отметка о прежнем ответственном снята
    const ok = await svc.changeStatus(await actorOf("Комаричев"), t.number, "in-progress");
    expect(ok.task.status).toBe("in-progress");
    expect(ok.task.approval).toEqual({ state: "approved", approver: (await person("Комаричев")).slug });
    expect((await row(t.number)).approvalFromId).toBeNull();
  });

  it("R5: смена ответственного внутри своего департамента снимает согласование, событие у прежнего согласующего разобрано", async () => {
    const t = await newTask(reva, (await person("Погосова")).slug, revaTeam, "R5 смена ответственного");
    const r = await svc.assignOwner(reva, t.number, (await person("Токов")).slug as never);
    expect(r.task.approval).toBeUndefined();
    expect(await openApprovals("Кацемба", t.number)).toBe(0);
    expect((await svc.changeStatus(reva, t.number, "in-progress")).task.status).toBe("in-progress");
  });
});

describe("обходы закрыты", () => {
  it("R1: отклонённую задачу ответственный и руководитель команды открывают только через новое согласование", async () => {
    const pog = await person("Погосова");
    const t = await newTask(reva, pog.slug, revaTeam, "R1 отклонят");
    await svc.changeStatus(await actorOf("Кацемба"), t.number, "cancelled", "Нет времени");
    const again = await svc.changeStatus(await actorOf("Погосова"), t.number, "in-progress");
    expect(again.task.status).toBe("proposed");
    expect(again.task.approval?.state).toBe("pending");
    expect(await openApprovals("Кацемба", t.number)).toBe(1);
    const t2 = await newTask(reva, pog.slug, revaTeam, "R1b отклонят");
    await svc.changeStatus(await actorOf("Кацемба"), t2.number, "cancelled", "Нет времени");
    expect((await svc.changeStatus(reva, t2.number, "in-progress")).task.status).toBe("proposed");
    // Режим управления открывает отклонённую задачу сам: это и есть согласие
    const t3 = await newTask(reva, pog.slug, revaTeam, "R1c отклонят");
    await svc.changeStatus(await actorOf("Кацемба"), t3.number, "cancelled", "Нет времени");
    const own = await svc.changeStatus(await owner(), t3.number, "in-progress");
    expect(own.task.status).toBe("in-progress");
    expect(own.task.approval?.state).toBe("approved");
  });

  it("R2: по общему логину согласования не видно и решить нельзя", async () => {
    const t = await newTask(reva, (await person("Погосова")).slug, revaTeam, "R2 общий логин");
    const kats = await person("Кацемба");
    const shared = await listInbox(kats.id, new Date(), { id: kats.id, role: kats.role, limited: true, shared: true });
    expect(shared.items.some((i) => i.kind === "APPROVAL")).toBe(false);
    expect((await listInbox(kats.id)).items.some((i) => i.kind === "APPROVAL" && i.taskNumber === t.number)).toBe(true);
    await expectRule(svc.changeStatus(await actorOf("Кацемба", "TEAM"), t.number, "in-progress"), /личном входе/);
  });

  it("R3: автор без места в структуре считается человеком из другого департамента", async () => {
    const loose = await prisma.person.findFirstOrThrow({ where: { unitId: null, active: true, role: { not: "OBSERVER" } } });
    expect(await approvalRule(prisma, loose.id, (await person("Погосова")).id)).toMatchObject({ mode: "approve", approverId: (await person("Кацемба")).id });
  });

  it("R4: соисполнитель из департамента с согласованием только отдельной задачей; с информированием руководитель узнаёт", async () => {
    const tok = await person("Токов");
    const pog = await person("Погосова");
    await expectRule(newTask(reva, tok.slug, revaTeam, "R4 соисполнитель", { coExecutors: [pog.slug] as never }), /Соисполнитель Погосова Сабина Левоновна: в департаменте «Финансовый департамент»/);
    const t = await newTask(reva, tok.slug, revaTeam, "R4 без соисполнителя");
    await expectRule(svc.setCoExecutors(await actorOf("Токов"), t.number, [pog.slug] as never), /отдельную задачу/);
    await saveApprovalSetting(await owner(), { default: "inform", departments: {} });
    const informed = await newTask(reva, tok.slug, revaTeam, "R4 информирование", { coExecutors: [pog.slug] as never });
    const event = await prisma.inboxEvent.findFirstOrThrow({ where: { kind: "APPROVAL", subject: { startsWith: "approval-co:" }, recipient: { fullName: { startsWith: "Кацемба" } } } });
    expect(event.text).toContain(`задачи ${informed.number}`);
    expect(event.text).toMatch(/: Погосова Сабина Левоновна$/);
    expect(event.taskId).toBeNull();
    await saveApprovalSetting(await owner(), { default: "inform", departments: { [finId]: "approve" } });
  });

  it("R6: просьба из другого департамента, сделанная задачей, ждёт согласования руководителя адресата", async () => {
    const pog = await actorOf("Погосова");
    const r = await req.createRequest(reva, { to: pog.slug, text: "Посчитайте комиссии партнёров за октябрь", due: future });
    const done = await req.requestToTask(pog, r.number, "department");
    const t = await row(done.task);
    expect(t.status).toBe("PROPOSED");
    expect(t.approvalState).toBe("PENDING");
    expect(t.approverId).toBe((await person("Кацемба")).id);
  });

  it("R7: следующая задача согласованной серии остаётся согласованной и видна руководителю", async () => {
    const t = await newTask(reva, (await person("Погосова")).slug, revaTeam, "R7 повтор", { repeat: { kind: "weekly", mode: "on-close" } });
    await svc.changeStatus(await actorOf("Кацемба"), t.number, "in-progress");
    const r = await svc.changeStatus(await actorOf("Погосова"), t.number, "done", "Готово");
    const next = await row(r.task.repeat!.next!);
    expect(next.approvalState).toBe("APPROVED");
    expect(next.approverId).toBe((await person("Кацемба")).id);
  });

  it("R8: строка согласования в истории карточки после строки создания", async () => {
    const t = await newTask(reva, (await person("Погосова")).slug, revaTeam, "R8 история");
    const fields = (await svc.taskHistory(t.number)).map((h) => h.field);
    expect(fields).toContain("Ждёт согласования руководителя");
    expect(fields.at(-1)).toBe("Задача предложена");
  });

  it("R9: режим управления не ждёт согласования, руководитель узнаёт, как и при передаче", async () => {
    const top = await newTask(await owner(), (await person("Погосова")).slug, revaTeam, "R9 режим управления");
    expect(top.status).toBe("in-progress");
    expect(top.approval?.state).toBe("informed");
  });

  it("правка названия и результата приходит согласующему, он может прокомментировать задачу", async () => {
    const t = await newTask(reva, (await person("Погосова")).slug, revaTeam, "Правка на согласовании");
    await svc.editTask(reva, t.number, { outcome: "Сверка готова и отправлена в бухгалтерию" });
    const event = await prisma.inboxEvent.findFirstOrThrow({ where: { kind: "APPROVAL", task: { number: t.number }, text: { contains: "поправили" } } });
    expect(event.text).toMatch(/что нужно сделать/);
    const commented = await svc.addComment(await actorOf("Кацемба"), t.number, "Сабина свободна со следующей недели");
    expect(commented.task.comments.length).toBe(1);
  });

  it("выбор департамента хранится, даже когда совпадает с правилом по умолчанию", async () => {
    const ins = (await approvalDepartments()).find((d) => d.name === INS)!;
    await saveApprovalSetting(await owner(), { default: "inform", departments: { [finId]: "approve", [ins.id]: "inform" } });
    expect((await loadApprovalSetting()).departments[ins.id]).toBe("inform");
    await saveApprovalSetting(await owner(), { default: "off", departments: { [finId]: "approve", [ins.id]: "inform" } });
    expect((await loadApprovalSetting()).departments[ins.id]).toBe("inform");
    await saveApprovalSetting(await owner(), { default: "inform", departments: { [finId]: "approve" } });
  });
});

describe("структура поменялась", () => {
  it("R10: человек перешёл к другому руководителю, согласующий выключен: согласующий пересчитан", async () => {
    // Журнал только дописывается, а номера задач после сброса настройки в других файлах повторяются: считаем записи этого теста
    const mark = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
    const t = await newTask(reva, (await person("Погосова")).slug, revaTeam, "R10 до переезда");
    // Погосова переходит в управление хранения данных: согласует Комаричев, у Кацембы событие разобрано
    await org.applyStructure(await owner(), rows("Управление хранения данных"));
    expect((await row(t.number)).approverId).toBe((await person("Комаричев")).id);
    expect(await openApprovals("Кацемба", t.number)).toBe(0);
    expect(await openApprovals("Комаричев", t.number)).toBe(1);
    // Прежняя согласующая больше не решает и задачу из чужого департамента не видит
    await expectRule(svc.changeStatus(await actorOf("Кацемба"), t.number, "in-progress"), new RegExp(`Задачи ${t.number} нет`));
    // Задача Белову ждёт Комаричева; Комаричева выключили: согласует руководитель департамента
    const t2 = await newTask(reva, (await person("Белов")).slug, revaTeam, "R10 согласующий выключен");
    await setPersonActive(await owner(), (await person("Комаричев")).slug, false);
    expect((await row(t2.number)).approverId).toBe((await person("Харченко")).id);
    const t3 = await newTask(reva, (await person("Белов")).slug, revaTeam, "R10 новая задача");
    expect(t3.approval?.approver).toBe((await person("Харченко")).slug);
    // Пересчёт записан в журнал задачи
    expect(await prisma.auditLog.count({ where: { id: { gt: mark }, entity: "task", entityId: String(t2.number), field: "Согласующий" } })).toBe(1);
    await setPersonActive(await owner(), (await person("Комаричев")).slug, true);
  });
});
