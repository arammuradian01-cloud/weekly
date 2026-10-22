// Этап 65: задачи к целям перетаскиванием. Права на связь по правилам сервиса задач, перевязка, отвязка, журнал,
// отмена, несколько задач разом, подбор цели по тексту не перетирает связь, поставленную руками, и данные экрана
// «Связать задачи с целями»: цели человека и его команд, «Мои задачи» с причинами, видимость и квартал.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import * as goals from "@/lib/goals/service";
import { goalLinkBoard } from "@/lib/goals/link-board";
import { TOP_TEAM } from "@/lib/org/scope";
import { quarterOf } from "@/lib/goals/parse";
import { quarterRange } from "@/lib/goals/links";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";

const STRUCTURE = [
  ["ФИО", "Должность", "Управление", "Отдел", "Сектор", "Руководитель", "Руководит"],
  ["Рева Тарас", "CPO", "Управление развития продуктов", "", "", "Мурадян Арам", "да"],
  ["Антонов Дмитрий", "PO OSAGO", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "Рева Тарас", "да"],
  ["Чемоданова Алиса", "Product Designer", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "", ""],
  ["Токов Никита", "Team Lead", "Управление развития продуктов", "Продуктовая аналитика", "", "Рева Тарас", "да"],
  ["Иванова Мария", "Аналитик", "Управление развития продуктов", "Продуктовая аналитика", "", "", ""],
]
  .map((r) => r.join("\t"))
  .join("\n");

const Q = quarterOf(moscowToday());
const future = addDays(moscowToday(), 10);
const owner = () => svc.actorFor("muradyan", "OWNER");
const slugOf = async (start: string) => (await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } } })).slug;
const actor = async (start: string) => svc.actorFor(await slugOf(start));
const teamOf = async (leaderStart: string) => prisma.team.findFirstOrThrow({ where: { leader: { fullName: { startsWith: leaderStart } } } });
const who = (a: svc.Actor, limited = false) => ({ personId: a.personId, role: a.role, management: a.management, limited });
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(svc.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
const newTask = async (a: svc.Actor, title: string, ownerSlug: string, team?: string, extra: Partial<svc.NewTaskInput> = {}) =>
  (await svc.createTask(a, { title, outcome: "Результат", owner: ownerSlug, direction: "department", due: future, team, ...extra })).task;
const goalIdOf = async (number: number) => (await prisma.task.findUniqueOrThrow({ where: { number }, select: { goalId: true } })).goalId;
const goalLog = (number: number) => prisma.auditLog.findMany({ where: { entity: "task", entityId: String(number), field: { in: ["Цель", "Цель (отмена)"] } }, orderBy: { id: "asc" } });

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

const g: Record<string, string> = {};
const t: Record<string, number> = {};

beforeAll(async () => {
  await clean();
  const o = await owner();
  await org.applyStructure(o, STRUCTURE);
  const revaTeam = await teamOf("Рева");
  const sector = await teamOf("Антонов");
  const analytics = await teamOf("Токов");
  g.d1 = (await goals.createGoal(o, { quarter: Q, code: "D1", title: "Маржа департамента 150 млн", base: "120", target: "150", team: TOP_TEAM })).id;
  g.p1 = (await goals.createGoal(await svc.actorFor("reva"), { quarter: Q, code: "P1", title: "Конверсия расчёта в покупку", team: revaTeam.id, parent: g.d1 })).id;
  g.s1 = (await goals.createGoal(await actor("Антонов"), { quarter: Q, code: "1", title: "Новая форма расчёта на всём трафике", team: sector.id, parent: g.p1 })).id;
  g.a1 = (await goals.createGoal(await actor("Токов"), { quarter: Q, title: "Витрина воронки", team: analytics.id, parent: g.p1 })).id;
  const antonov = await actor("Антонов");
  const alisa = await actor("Чемоданова");
  t.own = (await newTask(antonov, "Свёрстать новую форму", alisa.slug, sector.id)).number;
  t.leader = (await newTask(antonov, "Согласовать макет с юристами", antonov.slug, sector.id)).number;
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("права на связь задачи с целью", () => {
  it("ответственный привязывает, перевязывает и отвязывает; журнал пишет было и стало", async () => {
    const alisa = await actor("Чемоданова");
    const r = await svc.setTaskGoal(alisa, t.own, g.s1);
    expect(r.task.goal?.id).toBe(g.s1);
    expect(r.undo).toBeTruthy();
    await svc.setTaskGoal(alisa, t.own, g.p1);
    expect(await goalIdOf(t.own)).toBe(g.p1);
    await svc.setTaskGoal(alisa, t.own, null);
    expect(await goalIdOf(t.own)).toBeNull();
    const log = await goalLog(t.own);
    expect(log.map((l) => [l.action, l.before ?? null, l.after ?? null, l.actorId])).toEqual([
      ["task.update", null, "Новая форма расчёта на всём трафике", alisa.personId],
      ["task.update", "Новая форма расчёта на всём трафике", "Конверсия расчёта в покупку", alisa.personId],
      ["task.update", "Конверсия расчёта в покупку", null, alisa.personId],
    ]);
    await expectRule(svc.setTaskGoal(alisa, t.own, null), /Цель уже такая/);
  });

  it("участник команды без роли в задаче, чужая ветка и наблюдатель цель не меняют", async () => {
    const alisa = await actor("Чемоданова");
    await expectRule(svc.setTaskGoal(alisa, t.leader, g.s1), /Цель задаче выбирают ответственный, соисполнители, тот, кто поставил задачу, руководитель команды/);
    // Чужая ветка задачу не видит: номер не подтверждаем
    await expectRule(svc.setTaskGoal(await actor("Токов"), t.leader, g.s1), new RegExp(`Задачи ${t.leader} нет`));
    await expectRule(svc.setTaskGoal(await svc.actorFor("ceo"), t.leader, g.s1), /Наблюдатель только смотрит/);
    expect(await goalIdOf(t.leader)).toBeNull();
  });

  it("соисполнитель занимается задачей и меняет её цель; убрали из соисполнителей: уже нет", async () => {
    const alisa = await actor("Чемоданова");
    const antonov = await actor("Антонов");
    await svc.setCoExecutors(antonov, t.leader, [alisa.slug]);
    await svc.setTaskGoal(alisa, t.leader, g.s1);
    expect(await goalIdOf(t.leader)).toBe(g.s1);
    expect((await goalLog(t.leader)).at(-1)!.actorId).toBe(alisa.personId);
    // На экране «Связать задачи с целями» задача у соисполнителя среди тех, что можно привязать
    const row = (await goalLinkBoard(who(alisa), { quarter: Q })).tasks.find((x) => x.number === t.leader)!;
    expect([row.reasons[0], row.canLink]).toEqual(["co", true]);
    await svc.setCoExecutors(antonov, t.leader, []);
    await expectRule(svc.setTaskGoal(alisa, t.leader, null), /Цель задаче выбирают/);
    await svc.setTaskGoal(antonov, t.leader, null);
  });

  it("руководитель команды выше и режим управления меняют цель задачи команды", async () => {
    await svc.setTaskGoal(await svc.actorFor("reva"), t.leader, g.p1);
    expect(await goalIdOf(t.leader)).toBe(g.p1);
    await svc.setTaskGoal(await owner(), t.leader, g.d1);
    expect(await goalIdOf(t.leader)).toBe(g.d1);
    await svc.setTaskGoal(await actor("Антонов"), t.leader, null);
  });

  it("цель чужой ветки, снятая цель, цель другого квартала и задача в архиве не подходят", async () => {
    const alisa = await actor("Чемоданова");
    await expectRule(svc.setTaskGoal(alisa, t.own, g.a1), /своей команды или команды выше/);
    const sector = await teamOf("Антонов");
    const dropped = (await goals.createGoal(await actor("Антонов"), { quarter: Q, title: "Снятая цель", team: sector.id })).id;
    await goals.updateGoal(await actor("Антонов"), dropped, { result: "DROPPED" });
    await expectRule(svc.setTaskGoal(alisa, t.own, dropped), /Цель снята/);
    const next = Q.endsWith("Q4") ? `${Number(Q.slice(0, 4)) + 1}-Q1` : `${Q.slice(0, 5)}Q${Number(Q.slice(6)) + 1}`;
    const later = (await goals.createGoal(await actor("Антонов"), { quarter: next, title: "Цель следующего квартала", team: sector.id })).id;
    // Срок задачи в этом квартале (если до конца квартала больше 10 дней): цель следующего не подходит
    if (quarterOf(future) === Q) await expectRule(svc.setTaskGoal(alisa, t.own, later), /задачу привязывают к цели текущего квартала или квартала срока/);
    const archived = (await newTask(await actor("Антонов"), "Задача в архив", alisa.slug, sector.id)).number;
    await svc.archiveTask(await owner(), archived);
    await expectRule(svc.setTaskGoal(await owner(), archived, g.s1), new RegExp(`Задача ${archived} в архиве`));
  });

  it("общий логин без режима управления: только свои задачи, задачи команды нет", async () => {
    const o = await owner();
    const revaOwn = (await newTask(o, "Задача Ревы в топ-команде", "reva", TOP_TEAM)).number;
    const fatyanov = (await newTask(o, "Задача Фатьянова в топ-команде", "fatyanov", TOP_TEAM)).number;
    const shared = { ...(await svc.actorFor("reva")), via: "TEAM" as const };
    await svc.setTaskGoal(shared, revaOwn, g.d1);
    expect(await goalIdOf(revaOwn)).toBe(g.d1);
    await expectRule(svc.setTaskGoal(shared, fatyanov, g.d1), /Цель задаче выбирают/);
    // Задачи сектора общий вход не видит вовсе, хотя лично Рева руководит управлением выше
    await expectRule(svc.setTaskGoal(shared, t.leader, g.p1), new RegExp(`Задачи ${t.leader} нет`));
    // С режимом управления общий вход меняет цель любой задачи
    await svc.setTaskGoal({ ...(await owner()), via: "TEAM" as const }, fatyanov, g.d1);
    expect(await goalIdOf(fatyanov)).toBe(g.d1);
  });

  it("карточка задачи идёт тем же путём: linkTaskGoal пишет через сервис задач", async () => {
    const alisa = await actor("Чемоданова");
    expect((await goals.linkTaskGoal(alisa, t.own, g.s1)).goal).toBe("Новая форма расчёта на всём трафике");
    expect((await goals.linkTaskGoal(alisa, t.own, null)).goal).toBeNull();
    await expectRule(goals.linkTaskGoal(alisa, t.leader, g.s1), /Цель задаче выбирают/);
  });
});

describe("отмена и несколько задач разом", () => {
  it("отмена возвращает прежнюю цель и пишет журнал; после чужой правки отменить нельзя", async () => {
    const alisa = await actor("Чемоданова");
    await svc.setTaskGoal(alisa, t.own, g.s1);
    const r = await svc.setTaskGoal(alisa, t.own, g.p1);
    const back = await svc.undoChange(alisa, r.undo!);
    expect(back.task?.goal?.id).toBe(g.s1);
    expect(await goalIdOf(t.own)).toBe(g.s1);
    const last = (await goalLog(t.own)).at(-1)!;
    expect([last.action, last.field, last.before, last.after]).toEqual(["task.undo", "Цель (отмена)", "Конверсия расчёта в покупку", "Новая форма расчёта на всём трафике"]);
    // Отмена отвязки
    const off = await svc.setTaskGoal(alisa, t.own, null);
    await svc.undoChange(alisa, off.undo!);
    expect(await goalIdOf(t.own)).toBe(g.s1);
    // Задачу поменяли после связи: отмена не затирает чужую правку
    const again = await svc.setTaskGoal(alisa, t.own, g.p1);
    await svc.changePriority(await actor("Антонов"), t.own, "high");
    await expectRule(svc.undoChange(alisa, again.undo!), /уже изменили/);
    expect(await goalIdOf(t.own)).toBe(g.p1);
  });

  it("прежнюю цель удалили: отменить нельзя, задача не ломается", async () => {
    const antonov = await actor("Антонов");
    const sector = await teamOf("Антонов");
    const tmp = (await goals.createGoal(antonov, { quarter: Q, title: "Временная цель", team: sector.id })).id;
    await svc.setTaskGoal(antonov, t.leader, tmp);
    const r = await svc.setTaskGoal(antonov, t.leader, g.s1);
    await goals.deleteGoal(antonov, tmp);
    await expectRule(svc.undoChange(antonov, r.undo!), /Прежней цели уже нет/);
    expect(await goalIdOf(t.leader)).toBe(g.s1);
  });

  it("несколько задач к цели: каждая по своим правам, неудачи с причиной", async () => {
    const alisa = await actor("Чемоданова");
    const sector = await teamOf("Антонов");
    const second = (await newTask(alisa, "Подготовить тексты формы", alisa.slug, sector.id)).number;
    await svc.setTaskGoal(alisa, t.own, null);
    const r = await svc.setTasksGoal(alisa, [t.own, second, t.leader, 999_999], g.s1);
    expect(r.done.map((d) => d.number).sort()).toEqual([t.own, second].sort());
    expect(r.done.every((d) => !!d.undo)).toBe(true);
    expect(r.failed.map((f) => f.number)).toEqual([t.leader, 999_999]);
    expect(r.failed[0]!.error).toMatch(/Цель задаче выбирают/);
    expect(r.failed[1]!.error).toBe("Задачи 999999 нет");
    expect(await goalIdOf(second)).toBe(g.s1);
    // Цель уже такая (её успел поставить кто-то другой): успех без отмены, а не отказ
    const again = await svc.setTasksGoal(alisa, [second], g.s1);
    expect(again).toEqual({ done: [{ number: second }], failed: [] });
    await expectRule(svc.setTasksGoal(alisa, [], g.s1), /Выберите задачи/);
    await expectRule(svc.setTasksGoal(await svc.actorFor("ceo"), [t.own], null), /Наблюдатель/);
  });
});

describe("подбор цели по тексту не перетирает связь, поставленную руками", () => {
  it("правка текста, подсказки и закрытие задачи цель не меняют; сервер сам цель не подставляет", async () => {
    const antonov = await actor("Антонов");
    const alisa = await actor("Чемоданова");
    const sector = await teamOf("Антонов");
    const manual = (await newTask(antonov, "Свёрстать гайд", alisa.slug, sector.id)).number;
    // Человек сам выбрал цель управления, хотя по тексту ближе цель сектора
    await svc.setTaskGoal(alisa, manual, g.p1);
    await svc.editTask(antonov, manual, { title: "Новая форма расчёта на всём трафике", outcome: "Форма расчёта на всём трафике" });
    const options = await goals.goalOptions(who(alisa), manual);
    expect(options[0]!.id).toBe(g.s1);
    expect(options[0]!.suggested).toBe(true);
    const suggested = await goals.suggestGoals(who(antonov), { team: sector.id, due: future, title: "Новая форма расчёта на всём трафике", outcome: "", owner: alisa.slug });
    expect(suggested.best).toBe(g.s1);
    await svc.changeStatus(alisa, manual, "done", "Гайд готов");
    expect(await goalIdOf(manual)).toBe(g.p1);
    // Новая задача без цели в запросе остаётся без цели: подставляет только форма, и человек это видит
    const plain = (await newTask(antonov, "Новая форма расчёта на всём трафике", alisa.slug, sector.id)).number;
    expect(await goalIdOf(plain)).toBeNull();
  });
});

describe("данные экрана «Связать задачи с целями»", () => {
  it("цели человека и его команд, цели выше, свои личные; чужие личные только руководителю их команды", async () => {
    const alisa = await actor("Чемоданова");
    const sector = await teamOf("Антонов");
    const analytics = await teamOf("Токов");
    // Личная цель Алисы из борда лидера и личная цель Ивановой в аналитике
    const ivanova = await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: "Иванова" } } });
    g.alisaOwn = (await prisma.goal.create({ data: { quarter: Q, code: "ЧА-1", title: "Гайд по форме", teamId: sector.id, ownerId: alisa.personId, source: "leader-board:Цели Алиса" } })).id;
    g.ivanova = (await prisma.goal.create({ data: { quarter: Q, code: "ИМ-1", title: "Дашборд воронки", teamId: analytics.id, ownerId: ivanova.id, source: "leader-board:Цели Иванова" } })).id;
    const board = await goalLinkBoard(who(alisa), { quarter: Q });
    // Свои цели первыми, потом цели своей команды, потом цели выше сверху вниз: департамент, управление
    expect(board.goals.map((x) => [x.id, x.group])).toEqual([
      [g.alisaOwn, "mine"],
      [g.s1, "team"],
      [g.d1, "above"],
      [g.p1, "above"],
    ]);
    const mine = board.goals.find((x) => x.id === g.alisaOwn)!;
    expect([mine.boardOwner, mine.personal]).toEqual([alisa.slug, true]);
    // Снятые цели и цели чужих веток не показываются
    expect(board.goals.some((x) => x.id === g.a1 || x.id === g.ivanova || x.title === "Снятая цель")).toBe(false);
    // Руководитель сектора видит личную цель Алисы в своей команде, руководитель аналитики нет
    const antonovBoard = await goalLinkBoard(who(await actor("Антонов")), { quarter: Q });
    expect(antonovBoard.goals.find((x) => x.id === g.alisaOwn)?.group).toBe("team");
    const tokovBoard = await goalLinkBoard(who(await actor("Токов")), { quarter: Q });
    expect(tokovBoard.goals.some((x) => x.id === g.alisaOwn)).toBe(false);
    expect(tokovBoard.goals.find((x) => x.id === g.ivanova)?.personal).toBe(true);
  });

  it("«Мои задачи»: веду, поставил, комментировал, упомянут, слежу; закрытые только за квартал; чужое не видно", async () => {
    const antonov = await actor("Антонов");
    const alisa = await actor("Чемоданова");
    const sector = await teamOf("Антонов");
    const revaTeam = await teamOf("Рева");
    const commented = (await newTask(antonov, "Задача, где Алиса комментировала", antonov.slug, sector.id)).number;
    await svc.addComment(alisa, commented, "Посмотрю макет");
    const mentioned = (await newTask(antonov, "Задача, где Алису упомянули", antonov.slug, sector.id)).number;
    const mentionedRow = await prisma.task.findUniqueOrThrow({ where: { number: mentioned } });
    await prisma.taskComment.create({ data: { taskId: mentionedRow.id, authorId: antonov.personId, text: "Алиса, глянь", mentions: [alisa.personId] } });
    const watched = (await newTask(antonov, "Задача, за которой Алиса следит", antonov.slug, sector.id)).number;
    await svc.watchTask(alisa, watched, true);
    // Задача управления: Алису упомянули, но задачу она не видит
    const hidden = (await newTask(await svc.actorFor("reva"), "Задача управления", "reva", revaTeam.id)).number;
    const hiddenRow = await prisma.task.findUniqueOrThrow({ where: { number: hidden } });
    await prisma.taskComment.create({ data: { taskId: hiddenRow.id, authorId: hiddenRow.ownerId!, text: "Для Алисы", mentions: [alisa.personId] } });
    // Закрытая в этом квартале, закрытая раньше квартала, отменённая
    const closedNow = (await newTask(antonov, "Закрыта в этом квартале", alisa.slug, sector.id)).number;
    await svc.changeStatus(alisa, closedNow, "done", "Сделано");
    const closedBefore = (await newTask(antonov, "Закрыта в прошлом квартале", alisa.slug, sector.id)).number;
    await svc.changeStatus(alisa, closedBefore, "done", "Сделано");
    await prisma.task.update({ where: { number: closedBefore }, data: { closedAt: new Date(`${addDays(quarterRange(Q)!.start, -5)}T12:00:00+03:00`) } });
    const cancelled = (await newTask(antonov, "Отменённая", alisa.slug, sector.id)).number;
    await svc.changeStatus(antonov, cancelled, "cancelled", "Не нужна");

    const board = await goalLinkBoard(who(alisa), { quarter: Q });
    const by = new Map(board.tasks.map((x) => [x.number, x]));
    expect(by.get(t.own)!.reasons).toEqual(["owner", "team"]);
    expect(by.get(t.own)!.canLink).toBe(true);
    expect(by.get(commented)!.reasons[0]).toBe("comment");
    expect(by.get(mentioned)!.reasons[0]).toBe("mention");
    expect(by.get(watched)!.reasons[0]).toBe("watch");
    expect(by.get(watched)!.canLink).toBe(false);
    expect(by.get(t.leader)!.reasons).toEqual(["team"]);
    expect(by.has(hidden)).toBe(false);
    expect(by.get(closedNow)?.closed).toBe(true);
    expect(by.has(closedBefore)).toBe(false);
    expect(by.has(cancelled)).toBe(false);
    expect(by.get(t.own)!.chain).toEqual(expect.arrayContaining([sector.id, revaTeam.id, TOP_TEAM]));
    expect(board.tasks.every((x) => x.mine)).toBe(true);
    expect(board.observer).toBe(false);
  });

  it("руководитель видит цели и задачи команд ниже и привязывает задачи подчинённых команд к их целям", async () => {
    const reva = await svc.actorFor("reva");
    const sector = await teamOf("Антонов");
    const analytics = await teamOf("Токов");
    const board = await goalLinkBoard(who(reva), { quarter: Q });
    const group = (id: string) => board.goals.find((x) => x.id === id)?.group;
    // Свои команды (управление и топ-команда), ниже сектор и аналитика вместе с личными целями их людей
    expect([group(g.p1), group(g.d1), group(g.s1), group(g.a1), group(g.alisaOwn), group(g.ivanova)]).toEqual(["team", "team", "below", "below", "below", "below"]);
    const order = board.goals.map((x) => x.group);
    expect(order.indexOf("below")).toBeGreaterThan(order.lastIndexOf("team"));
    const row = board.tasks.find((x) => x.number === t.own)!;
    expect([row.mine, row.reasons, row.canLink]).toEqual([true, ["below"], true]);
    expect(row.chain).toContain(sector.id);
    // Привязка по правилам сервиса: руководитель команды выше меняет цель задачи сектора на цель сектора
    await svc.setTaskGoal(reva, t.own, null);
    await svc.setTaskGoal(reva, t.own, g.s1);
    expect(await goalIdOf(t.own)).toBe(g.s1);
    // Руководитель сектора аналитику не видит: ни целей, ни задач
    const antonovBoard = await goalLinkBoard(who(await actor("Антонов")), { quarter: Q });
    expect(antonovBoard.goals.some((x) => x.team.id === analytics.id)).toBe(false);
    expect(antonovBoard.goals.some((x) => x.group === "below")).toBe(false);
  });

  it("свои задачи руководителя приходят все, предел только к задачам команд и команд ниже", async () => {
    const reva = await svc.actorFor("reva");
    const revaTeam = await teamOf("Рева");
    const far = addDays(moscowToday(), 60);
    const own: number[] = [];
    for (const title of ["Своя задача Ревы один", "Своя задача Ревы два", "Своя задача Ревы три"]) own.push((await newTask(reva, title, reva.slug, revaTeam.id, { due: far })).number);
    const board = await goalLinkBoard(who(reva), { quarter: Q, limits: { open: 1, closed: 1 } });
    // Задач команд и команд ниже больше предела: экран об этом пишет, но свои задачи с дальним сроком не вытеснены
    expect(board.truncated).toBe(true);
    const by = new Map(board.tasks.map((x) => [x.number, x]));
    for (const n of own) expect(by.get(n)?.reasons[0]).toBe("owner");
    const teamOnly = board.tasks.filter((x) => x.mine && x.reasons.every((r) => r === "team" || r === "below"));
    expect(teamOnly.length).toBeLessThanOrEqual(2);
    // Без предела в тесте приходят и все задачи команды ниже
    const full = await goalLinkBoard(who(reva), { quarter: Q });
    expect(full.truncated).toBe(false);
    expect(full.tasks.filter((x) => x.mine).length).toBeGreaterThan(board.tasks.filter((x) => x.mine).length);
    for (const n of own) await svc.changeStatus(reva, n, "cancelled", "Тест предела");
  });

  it("задача под целью, которую человек видит, но не ведёт, видна в карточке цели, а не в «Моих задачах»", async () => {
    const reva = await svc.actorFor("reva");
    const alisa = await actor("Чемоданова");
    const tokov = await actor("Токов");
    const ivanova = await actor("Иванова");
    const analytics = await teamOf("Токов");
    // Алиса функциональный руководитель Ивановой: видит её задачи в аналитике, но не ведёт их и не в той команде
    await prisma.person.update({ where: { id: ivanova.personId }, data: { functionalManagerId: alisa.personId } });
    const elsewhere = (await newTask(tokov, "Дашборд воронки для формы", ivanova.slug, analytics.id)).number;
    await svc.setTaskGoal(tokov, elsewhere, g.p1);
    const board = await goalLinkBoard(who(alisa), { quarter: Q });
    const row = board.tasks.find((x) => x.number === elsewhere)!;
    expect(row.mine).toBe(false);
    expect(row.goal?.id).toBe(g.p1);
    // Цель этой задачи меняют Иванова, Токов, Рева и режим управления, не Алиса
    expect(row.canLink).toBe(false);
    expect(board.goals.find((x) => x.id === g.p1)?.group).toBe("above");
    // Карточка цели считает задачи из того же набора, что видит человек, отменённые не приходят вовсе
    await svc.changeStatus(tokov, elsewhere, "cancelled", "Не нужна");
    expect((await goalLinkBoard(who(alisa), { quarter: Q })).tasks.some((x) => x.number === elsewhere)).toBe(false);
    await prisma.person.update({ where: { id: ivanova.personId }, data: { functionalManagerId: null } });
    // Общий логин Ревы видит только топ-команду: задачи сектора и цели управления к нему не приходят как свои
    const shared = await goalLinkBoard(who(reva, true), { quarter: Q });
    expect(shared.limited).toBe(true);
    expect(shared.tasks.some((x) => x.number === t.own)).toBe(false);
    // Наблюдатель видит экран, но ничего не меняет
    const ceo = await goalLinkBoard(who(await svc.actorFor("ceo")), { quarter: Q });
    expect(ceo.observer).toBe(true);
    expect(ceo.tasks.every((x) => !x.canLink)).toBe(true);
  });
});
