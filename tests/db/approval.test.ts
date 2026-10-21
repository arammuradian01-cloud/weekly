// Этап 54: согласование и информирование. Задача человеку из другого департамента ждёт согласования его
// руководителя или руководитель о ней узнаёт. Правило по умолчанию и правила департаментов задаёт владелец.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
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
const COMPANY = [
  ["ФИО", "Должность", "Департамент", "Управление", "Руководитель", "Руководит"],
  ["Крайник Александр", "CEO", "", "", "", "да"],
  ["Мурадян Арам", "Директор департамента", INS, "", "", "да"],
  ["Рева Тарас Игоревич", "CPO", INS, "Управление продуктового развития (insurance)", "", "да"],
  ["Токов Никита Андреевич", "Analytics Lead", INS, "Управление продуктового развития (insurance)", "", ""],
  ["Харченко Артём", "CFO", FIN, "", "", "да"],
  ["Кацемба Наталья Сергеевна", "Chief Accountant", FIN, "Управление финансового учёта и контроля", "", "да"],
  ["Погосова Сабина Левоновна", "Finance coordinator", FIN, "Управление финансового учёта и контроля", "", ""],
  ["Комаричев Сергей Владимирович", "Head of Data", FIN, "Управление хранения данных", "", "да"],
]
  .map((r) => r.join(";"))
  .join("\n");

const person = (start: string) => prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } } });
const actorOf = async (start: string) => ({ ...(await svc.actorFor((await person(start)).slug)), via: "PASSWORD" as const });
const teamLedBy = (start: string) => prisma.team.findFirstOrThrow({ where: { leader: { fullName: { startsWith: start } }, kind: "UNIT" } });
const newTask = async (a: svc.Actor, owner: string, team: string, title = "Сверка комиссий за октябрь") =>
  (await svc.createTask(a, { title, outcome: "Сверка готова", owner, direction: "department", due: future, team })).task;

async function clean() {
  await prisma.task.deleteMany();
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

beforeAll(async () => {
  await clean();
  await org.applyStructure(await owner(), COMPANY);
  // Погосова из финансов в команде Ревы: её добавил владелец
  await org.addTeamMember(await owner(), (await teamLedBy("Рева")).id, (await person("Погосова")).slug);
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("правило и настройка", () => {
  it("по умолчанию информирование; департаменты из структуры; правку делает только владелец и она в журнале", async () => {
    expect((await loadApprovalSetting()).default).toBe("inform");
    const deps = await approvalDepartments();
    expect(deps.map((d) => d.name)).toEqual(expect.arrayContaining([INS, FIN]));
    const fin = deps.find((d) => d.name === FIN)!;
    await expectRule(saveApprovalSetting(await svc.actorFor("muradyan"), { default: "approve", departments: {} }), /владелец в режиме управления/);
    const saved = await saveApprovalSetting(await owner(), { default: "inform", departments: { [fin.id]: "approve", "чужой-id": "off" } });
    expect(saved.departments).toEqual({ [fin.id]: "approve" });
    expect(await prisma.auditLog.count({ where: { action: "settings.approval" } })).toBeGreaterThan(0);
    await saveApprovalSetting(await owner(), { default: "inform", departments: {} });
  });
});

describe("информирование", () => {
  it("задача человеку из другого департамента: руководитель узнаёт и видит задачу", async () => {
    const reva = await actorOf("Рева");
    const pogosova = await person("Погосова");
    const task = await newTask(reva, pogosova.slug, (await teamLedBy("Рева")).id);
    expect(task.approval).toEqual({ state: "informed", approver: (await person("Кацемба")).slug });
    const katsemba = await person("Кацемба");
    const event = await prisma.inboxEvent.findFirstOrThrow({ where: { kind: "APPROVAL", recipientId: katsemba.id } });
    expect(event.text).toMatch(/Задача из другого департамента для вашего сотрудника: Погосова Сабина Левоновна\. Решать ничего не нужно/);
    const seen = (await svc.listTasks({ reader: { personId: katsemba.id, role: katsemba.role } })).map((t) => t.number);
    expect(seen).toContain(task.number);
  });

  it("правило не срабатывает: свой департамент, руководитель по линии, задача себе", async () => {
    const katsemba = await actorOf("Кацемба");
    const pogosova = await person("Погосова");
    expect((await newTask(katsemba, pogosova.slug, (await teamLedBy("Кацемба")).id, "Своя задача")).approval).toBeUndefined();
    // Комаричев из того же финансового департамента, но из другого управления: правило не про него
    const komarichev = await person("Комаричев");
    expect(await approvalRule(prisma, komarichev.id, pogosova.id)).toBeNull();
    expect(await approvalRule(prisma, pogosova.id, pogosova.id)).toBeNull();
    // А Рева из страхования: правило срабатывает, согласует руководитель Погосовой
    expect(await approvalRule(prisma, (await person("Рева")).id, pogosova.id)).toMatchObject({ mode: "inform", approverId: (await person("Кацемба")).id, department: FIN });
    // Генеральный ставит любому по линии подчинения
    const krainik = await actorOf("Крайник");
    expect((await newTask(krainik, pogosova.slug, (await teamLedBy("Крайник")).id, "Задача от генерального")).approval).toBeUndefined();
  });
});

describe("согласование", () => {
  it("задача ждёт решения руководителя: ни ответственный, ни руководитель команды задачи сами её не принимают", async () => {
    const fin = (await approvalDepartments()).find((d) => d.name === FIN)!;
    await saveApprovalSetting(await owner(), { default: "inform", departments: { [fin.id]: "approve" } });
    const reva = await actorOf("Рева");
    const pogosova = await person("Погосова");
    const task = await newTask(reva, pogosova.slug, (await teamLedBy("Рева")).id, "Отчёт по партнёрам для финансов");
    expect(task.status).toBe("proposed");
    expect(task.approval?.state).toBe("pending");
    await expectRule(svc.changeStatus(await actorOf("Погосова"), task.number, "in-progress"), /ждёт согласования/);
    await expectRule(svc.changeStatus(reva, task.number, "in-progress"), /ждёт согласования/);
    const katsemba = await actorOf("Кацемба");
    const done = await svc.changeStatus(katsemba, task.number, "in-progress");
    expect(done.task.status).toBe("in-progress");
    expect(done.task.approval?.state).toBe("approved");
    // Отмена кнопкой для решения по согласованию не выдаётся
    expect(done.undo).toBeUndefined();
    const to = (await prisma.inboxEvent.findMany({ where: { kind: "TASK_CONFIRMED", task: { number: task.number } }, include: { recipient: true } })).map((e) => e.recipient.fullName);
    expect(to.some((n) => n.startsWith("Рева"))).toBe(true);
    expect(to.some((n) => n.startsWith("Погосова"))).toBe(true);
  });

  it("руководитель не согласовал: задача отменена с причиной, автор узнаёт", async () => {
    const reva = await actorOf("Рева");
    const pogosova = await person("Погосова");
    const task = await newTask(reva, pogosova.slug, (await teamLedBy("Рева")).id, "Ещё одна сверка");
    const katsemba = await actorOf("Кацемба");
    await expectRule(svc.changeStatus(katsemba, task.number, "cancelled"), /причины/i);
    const r = await svc.changeStatus(katsemba, task.number, "cancelled", "Сабина закрывает квартал, вернёмся в ноябре");
    expect(r.task.status).toBe("cancelled");
    expect(r.task.approval?.state).toBe("rejected");
    const event = await prisma.inboxEvent.findFirstOrThrow({ where: { kind: "TASK_CONFIRMED", task: { number: task.number }, recipient: { fullName: { startsWith: "Рева" } } } });
    expect(event.text).toMatch(/не согласовал/);
  });

  it("передача задачи человеку из другого департамента снова требует согласования", async () => {
    const reva = await actorOf("Рева");
    const tokov = await person("Токов");
    const task = await newTask(reva, tokov.slug, (await teamLedBy("Рева")).id, "Модель комиссий");
    expect(task.status).toBe("in-progress");
    const handed = await svc.handOver(await actorOf("Токов"), task.number, (await person("Погосова")).slug as never, "Сабина считает комиссии по финансам");
    expect(handed.task.status).toBe("proposed");
    expect(handed.task.approval?.state).toBe("pending");
  });

  it("выключенное правило департамента: задача ставится как обычно", async () => {
    const fin = (await approvalDepartments()).find((d) => d.name === FIN)!;
    await saveApprovalSetting(await owner(), { default: "inform", departments: { [fin.id]: "off" } });
    const task = await newTask(await actorOf("Рева"), (await person("Погосова")).slug, (await teamLedBy("Рева")).id, "Без согласования");
    expect(task.approval).toBeUndefined();
    await saveApprovalSetting(await owner(), { default: "inform", departments: {} });
  });
});
