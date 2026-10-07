// Этап 16: задачи команд и панель руководителя. Просьба человеку другой команды, руководитель видит задачи своих людей,
// «Попросить обновить», подписка на задачу, панель «Мои команды», «Изменилось за неделю», история статусов.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import { TOP_TEAM } from "@/lib/org/scope";
import { teamPanel } from "@/lib/org/panel";
import { recentChanges, taskStatusSpans } from "@/lib/tasks/changes";
import { moscowToday, dbDate } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";

const STRUCTURE = [
  ["ФИО", "Должность", "Управление", "Отдел", "Сектор", "Руководитель", "Руководит"],
  ["Рева Тарас", "CPO", "Управление развития продуктов", "", "", "Мурадян Арам", "да"],
  ["Антонов Дмитрий", "PO OSAGO", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "Рева Тарас", "да"],
  ["Чемоданова Алиса", "Product Designer", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "", ""],
  ["Петров Олег", "Product Designer", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "", ""],
  ["Токов Никита", "Team Lead", "Управление развития продуктов", "Продуктовая аналитика", "", "Рева Тарас", "да"],
  ["Иванова Мария", "Аналитик", "Управление развития продуктов", "Продуктовая аналитика", "", "", ""],
]
  .map((r) => r.join("\t"))
  .join("\n");

const future = addDays(moscowToday(), 10);
const owner = () => svc.actorFor("muradyan", "OWNER");
const slugOf = async (start: string) => (await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } } })).slug;
const actor = async (start: string) => svc.actorFor(await slugOf(start));
const teamOf = async (leaderStart: string) => prisma.team.findFirstOrThrow({ where: { leader: { fullName: { startsWith: leaderStart } } } });
const reader = (a: svc.Actor) => ({ personId: a.personId, role: a.role });
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(svc.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
const newTask = async (a: svc.Actor, title: string, ownerSlug: string, team?: string) =>
  (await svc.createTask(a, { title, outcome: "Результат", owner: ownerSlug, direction: "department", due: future, team })).task;

async function clean() {
  await prisma.taskWatch.deleteMany();
  await prisma.task.deleteMany();
  await prisma.inboxEvent.deleteMany();
  await prisma.weeklyEntry.deleteMany({ where: { author: { role: "EMPLOYEE" } } });
  await prisma.weeklyReport.deleteMany({ where: { author: { role: "EMPLOYEE" } } });
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
  await org.applyStructure(await owner(), STRUCTURE);
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("просьба человеку другой команды", () => {
  it("задачу из сектора человеку аналитики принимает он сам или его руководитель; посторонний не может", async () => {
    const sector = await teamOf("Антонов");
    const alisa = await actor("Чемоданова");
    const ivanova = await actor("Иванова");
    const tokov = await actor("Токов");
    const petrov = await actor("Петров");
    const first = await newTask(alisa, "Выгрузить воронку расчёта ОСАГО", ivanova.slug, sector.id);
    expect(first.status).toBe("proposed");
    // Адресат видит просьбу и принимает её
    expect(await svc.getTask(first.number, reader(ivanova))).not.toBeNull();
    expect((await svc.changeStatus(ivanova, first.number, "in-progress")).task.status).toBe("in-progress");
    // Руководитель адресата видит просьбы к своим людям и принимает за них
    const second = await newTask(alisa, "Посчитать конверсию шага оплаты", ivanova.slug, sector.id);
    expect((await svc.listTasks({ reader: reader(tokov) })).map((t) => t.number)).toContain(second.number);
    await expectRule(svc.changeStatus(petrov, second.number, "in-progress"), /подтверждает адресат, его руководитель/);
    expect((await svc.changeStatus(tokov, second.number, "in-progress")).task.status).toBe("in-progress");
    // Отклонить можно с причиной
    const third = await newTask(alisa, "Сделать дашборд по КАСКО", ivanova.slug, sector.id);
    expect((await svc.changeStatus(ivanova, third.number, "cancelled", "Это задача команды КАСКО")).task.status).toBe("cancelled");
  });

  it("в топ-команде предложенную задачу по-прежнему подтверждает только режим управления", async () => {
    const offer = await newTask(await svc.actorFor("loginova"), "Сверить отчёт по ДВС", "reva");
    expect(offer.status).toBe("proposed");
    await expectRule(svc.changeStatus(await svc.actorFor("reva"), offer.number, "in-progress"), /владелец или администратор/);
  });

  it("руководитель видит задачи своих людей в любой команде", async () => {
    const tokov = await actor("Токов");
    const sectorTask = (await prisma.task.findFirstOrThrow({ where: { title: "Выгрузить воронку расчёта ОСАГО" } })).number;
    expect(await svc.getTask(sectorTask, reader(tokov))).not.toBeNull();
    // Участник сектора видит задачу своей команды, человек вне ветки нет
    expect(await svc.getTask(sectorTask, reader(await actor("Петров")))).not.toBeNull();
    const outsider = await svc.actorFor("fatyanov");
    expect(await svc.getTask(sectorTask, reader(outsider))).toBeNull();
  });
});

describe("попросить обновить", () => {
  it("руководитель команды просит ответственного обновить задачу, раз в день; остальным нельзя", async () => {
    const sector = await teamOf("Антонов");
    const antonov = await actor("Антонов");
    const alisa = await actor("Чемоданова");
    const t = await newTask(antonov, "Макет экрана оплаты", alisa.slug, sector.id);
    expect((await svc.requestUpdate(antonov, t.number)).asked).toMatch(/^Чемоданова/);
    const events = await prisma.inboxEvent.findMany({ where: { kind: "UPDATE_REQUEST", recipientId: alisa.personId } });
    expect(events).toHaveLength(1);
    await expectRule(svc.requestUpdate(antonov, t.number), /уже просили/);
    // Руководитель выше тоже может, руководитель соседней команды нет
    await svc.requestUpdate(await svc.actorFor("reva"), t.number);
    // Руководитель соседней команды задачу сектора даже не видит
    await expectRule(svc.requestUpdate(await actor("Токов"), t.number), new RegExp(`Задачи ${t.number} нет`));
    await expectRule(svc.requestUpdate(await actor("Петров"), t.number), /руководитель команды или ответственного/);
    await expectRule(svc.requestUpdate(alisa, t.number), /обновите её сами/);
    expect(await prisma.auditLog.count({ where: { action: "task.ask", entityId: String(t.number) } })).toBe(2);
  });
});

describe("подписка на задачу", () => {
  it("подписчик получает событие о смене статуса и срока, после отписки нет", async () => {
    const sector = await teamOf("Антонов");
    const antonov = await actor("Антонов");
    const alisa = await actor("Чемоданова");
    const reva = await svc.actorFor("reva");
    const t = await newTask(antonov, "Согласовать тексты формы", alisa.slug, sector.id);
    expect((await svc.watchTask(reva, t.number, true)).watching).toBe(true);
    await svc.changeStatus(alisa, t.number, "clarify");
    await svc.transferDue(antonov, t.number, addDays(future, 7), "Ждём юристов");
    const got = await prisma.inboxEvent.findMany({ where: { kind: "TASK_WATCH", recipientId: reva.personId }, orderBy: { createdAt: "asc" } });
    expect(got.map((e) => e.text)).toEqual(["Статус: Требует уточнений", expect.stringMatching(/^Срок перенесён на .*Ждём юристов/)]);
    await svc.watchTask(reva, t.number, false);
    await svc.changeStatus(alisa, t.number, "in-progress");
    expect(await prisma.inboxEvent.count({ where: { kind: "TASK_WATCH", recipientId: reva.personId } })).toBe(2);
    // Чужую задачу не подписать: номер не подтверждается
    await expectRule(svc.watchTask(await svc.actorFor("fatyanov"), t.number, true), new RegExp(`Задачи ${t.number} нет`));
  });
});

describe("панель «Мои команды»", () => {
  it("своя команда и команды ниже, люди, требует внимания", async () => {
    const sector = await teamOf("Антонов");
    const antonov = await actor("Антонов");
    const alisa = await actor("Чемоданова");
    // Просроченная задача в секторе
    const late = await newTask(antonov, "Обновить калькулятор", alisa.slug, sector.id);
    await prisma.task.update({ where: { number: late.number }, data: { due: dbDate(addDays(moscowToday(), -3)) } });
    const reva = await svc.actorFor("reva");
    const panel = (await teamPanel({ id: reva.personId, role: reva.role }, null))!;
    expect(panel.team.name).toBe("Управление развития продуктов");
    expect(panel.teams.map((t) => t.name)).toEqual(["Управление развития продуктов", "Сектор автострахования", "Продуктовая аналитика"]);
    const sectorRow = panel.teams.find((t) => t.name === "Сектор автострахования")!;
    expect(sectorRow.overdue).toBe(1);
    expect(sectorRow.level).toBe("below");
    expect(panel.attention[0]).toMatchObject({ number: late.number, overdue: 3, canAsk: true });
    expect(panel.people.map((p) => p.fullName).sort()).toEqual(["Антонов Дмитрий", "Рева Тарас", "Токов Никита"]);
    expect(panel.people.find((p) => p.fullName === "Рева Тарас")!.leader).toBe(true);
    expect(panel.path.map((p) => p.name)).toEqual(["Топ-команда", "Управление развития продуктов"]);
    // Спуск в сектор: люди сектора и их задачи, просьбы к ним
    const down = (await teamPanel({ id: reva.personId, role: reva.role }, sector.id))!;
    const alisaRow = down.people.find((p) => p.fullName === "Чемоданова Алиса")!;
    expect(alisaRow.overdue).toBe(1);
    expect(alisaRow.tasks.some((t) => t.number === late.number)).toBe(true);
    // Сотрудник без команд ниже видит свою команду, чужую команду открыть нельзя
    const own = (await teamPanel({ id: alisa.personId, role: alisa.role }, (await teamOf("Токов")).id))!;
    expect(own.team.name).toBe("Сектор автострахования");
  });
});

describe("изменилось за неделю и история статусов", () => {
  it("новые, закрытые, перенесённые и сменившие статус задачи с автором; дни в каждом статусе", async () => {
    const sector = await teamOf("Антонов");
    const antonov = await actor("Антонов");
    const alisa = await actor("Чемоданова");
    const t = await newTask(antonov, "Подготовить релиз формы", alisa.slug, sector.id);
    await svc.changeStatus(alisa, t.number, "clarify");
    await svc.transferDue(antonov, t.number, addDays(future, 3), "Ждём дизайн");
    await svc.changeStatus(alisa, t.number, "done", "Релиз вышел");
    const { changes } = await recentChanges(reader(antonov), [sector.id]);
    const mine = changes.filter((c) => c.number === t.number);
    expect(mine.map((c) => c.kind).sort()).toEqual(["closed", "due", "new", "status"]);
    expect(mine.find((c) => c.kind === "closed")).toMatchObject({ before: "Требует уточнений", by: alisa.fullName });
    // Соседняя команда в выборку не попадает
    const other = await recentChanges(reader(antonov), [(await teamOf("Токов")).id]);
    expect(other.changes.some((c) => c.number === t.number)).toBe(false);
    const spans = await taskStatusSpans(t.number);
    expect(spans.map((s) => s.status)).toEqual(["in-progress", "clarify", "done"]);
    expect(spans.find((s) => s.current)?.status).toBe("done");
  });
});

describe("правки по проверке кода", () => {
  it("адресат только принимает или отклоняет; отказ приходит автору как отказ", async () => {
    const sector = await teamOf("Антонов");
    const alisa = await actor("Чемоданова");
    const ivanova = await actor("Иванова");
    const t = await newTask(alisa, "Проверить формулу скидки", ivanova.slug, sector.id);
    await expectRule(svc.changeStatus(ivanova, t.number, "done", "Готово"), /принять в работу или отклонить/);
    await svc.changeStatus(ivanova, t.number, "cancelled", "Это не наша зона");
    const ev = await prisma.inboxEvent.findFirstOrThrow({ where: { kind: "TASK_CONFIRMED", recipientId: alisa.personId, subject: `task:${t.number}` } });
    expect(ev.text).toBe("Предложение отклонено: Это не наша зона");
  });

  it("руководитель ответственного комментирует задачу своего человека в чужой команде", async () => {
    const sector = await teamOf("Антонов");
    const t = await newTask(await actor("Чемоданова"), "Свести данные по отказам", await slugOf("Иванова"), sector.id);
    expect((await svc.addComment(await actor("Токов"), t.number, "Возьмём на следующей неделе")).task.number).toBe(t.number);
  });

  it("подписчик, которого убрали из команды, событий больше не получает; архивную задачу не подписать и не показать в изменениях", async () => {
    const sector = await teamOf("Антонов");
    const antonov = await actor("Антонов");
    const alisa = await actor("Чемоданова");
    const petrov = await actor("Петров");
    const t = await newTask(antonov, "Собрать отзывы о форме", alisa.slug, sector.id);
    await svc.watchTask(petrov, t.number, true);
    await org.removeTeamMember(await owner(), sector.id, petrov.slug);
    await svc.changeStatus(alisa, t.number, "clarify");
    expect(await prisma.inboxEvent.count({ where: { kind: "TASK_WATCH", recipientId: petrov.personId, subject: `task:${t.number}` } })).toBe(0);
    await org.addTeamMember(await owner(), sector.id, petrov.slug);
    // Участник команды без отношения к задаче её историю не видит, руководитель видит
    expect((await recentChanges(reader(petrov), [sector.id])).changes.some((c) => c.number === t.number)).toBe(false);
    expect((await recentChanges(reader(antonov), [sector.id])).changes.some((c) => c.number === t.number)).toBe(true);
    await svc.archiveTask(await owner(), t.number, true);
    await expectRule(svc.watchTask(antonov, t.number, true), /в архиве/);
    await expectRule(svc.requestUpdate(antonov, t.number), /в архиве|Задачи/);
    expect((await recentChanges(reader(antonov), [sector.id])).changes.some((c) => c.number === t.number)).toBe(false);
  });
});
