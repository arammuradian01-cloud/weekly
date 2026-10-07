// Этап 21б: блокеры со ссылкой, связи задач, фраза для «Есть риск», передача задачи (модуль М5).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as req from "@/lib/requests/service";
import * as inbox from "@/lib/inbox/service";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays, formatLong } from "@/domain/dates";
import { lateWaits } from "@/lib/tasks/rules";
import * as org from "@/lib/org/service";
import { TOP_TEAM } from "@/lib/org/scope";

const today = moscowToday();
const future = addDays(today, 10);
const actors = {
  owner: () => svc.actorFor("muradyan", "OWNER"),
  reva: () => svc.actorFor("reva"),
  loginova: () => svc.actorFor("loginova"),
  fatyanov: () => svc.actorFor("fatyanov"),
};
const id = async (slug: string) => (await prisma.person.findUniqueOrThrow({ where: { slug } })).id;
const texts = async (slug: string) => (await inbox.listInbox(await id(slug))).items.map((i) => i.text);
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(svc.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
/** Задача человеку от владельца: сразу «В работе» */
const task = async (owner: string, title: string, due = future) => (await svc.createTask(await actors.owner(), { title, outcome: "Результат", owner, direction: "kasko", due })).task;

beforeEach(async () => {
  await prisma.helpRequest.deleteMany();
  await prisma.task.deleteMany();
  await prisma.inboxEvent.deleteMany();
});
afterAll(async () => {
  await prisma.helpRequest.deleteMany();
  await prisma.task.deleteMany();
  await prisma.$disconnect();
});

describe("«Заблокирована» со ссылкой", () => {
  it("ждёт задачу: появляется связь, ответственному той задачи событие, без пояснения подпись по номеру", async () => {
    const mine = await task("reva", "Запуск нового тарифа");
    const other = await task("loginova", "Данные по убыткам");
    await expectRule(svc.changeState(await actors.reva(), mine.number, "blocked"), /кого ждёт задача/);
    const blocked = await svc.changeState(await actors.reva(), mine.number, "blocked", null, { waitTask: other.number });
    expect(blocked.task).toMatchObject({ state: "blocked", blockedBy: `Ждёт задачу ${other.number}`, waitsFor: [{ number: other.number, due: future, closed: false }] });
    expect(await texts("loginova")).toContain(`Вашу задачу ждёт задача ${mine.number}`);
    // Связь уже есть: снова заблокировать можно с одним пояснением
    await svc.changeState(await actors.reva(), mine.number, "on-track");
    const again = await svc.changeState(await actors.reva(), mine.number, "blocked", "Ждём выгрузку из DWH");
    expect(again.task.blockedBy).toBe("Ждём выгрузку из DWH");
  });

  it("сама себя, круг и несуществующая задача не связываются", async () => {
    const a = await task("reva", "Первая");
    const b = await task("reva", "Вторая");
    const c = await task("reva", "Третья");
    const reva = await actors.reva();
    await expectRule(svc.addDependency(reva, a.number, a.number), /сама себя/);
    await svc.addDependency(reva, a.number, b.number);
    await svc.addDependency(reva, b.number, c.number);
    await expectRule(svc.addDependency(reva, c.number, a.number), /круг/);
    await expectRule(svc.addDependency(reva, a.number, b.number), /уже есть/);
    await expectRule(svc.addDependency(reva, a.number, 999_999), /Задачи 999999 нет/);
    await expectRule(svc.addDependency(await actors.fatyanov(), a.number, b.number), /Связи задачи меняет/);
    await svc.removeDependency(reva, a.number, b.number);
    await expectRule(svc.removeDependency(reva, a.number, b.number), /уже нет/);
  });

  it("ждёт человека: просьба уходит и задача блокируется одной транзакцией", async () => {
    const mine = await task("reva", "Договор с партнёром");
    const { task: t, request } = await req.blockOnPerson(await actors.reva(), mine.number, { to: "loginova", text: "Согласовать юридический текст", due: future });
    expect(t.task).toMatchObject({ state: "blocked", blockedBy: "Ждёт ответа: Логинова Светлана" });
    expect(request).toMatchObject({ addressee: "loginova", task: { number: mine.number }, status: "open" });
    // Без прав на состояние ни просьбы, ни блокировки
    await expectRule(req.blockOnPerson(await actors.fatyanov(), mine.number, { to: "loginova", text: "Ещё", due: future }), /Состояние меняет/);
    expect(await prisma.helpRequest.count()).toBe(1);
  });

  it("«Есть риск» только с фразой, что вернёт в график; «В графике» её снимает; отмена возвращает", async () => {
    const mine = await task("reva", "Отчёт по КАСКО");
    const reva = await actors.reva();
    await expectRule(svc.changeState(reva, mine.number, "at-risk"), /что вернёт задачу в график/);
    const risky = await svc.changeState(reva, mine.number, "at-risk", "Договоримся с партнёром о данных до пятницы");
    expect(risky.task.riskNote).toBe("Договоримся с партнёром о данных до пятницы");
    const back = await svc.changeState(reva, mine.number, "on-track");
    expect(back.task.riskNote).toBeUndefined();
    await svc.undoChange(reva, back.undo!);
    expect((await svc.getTask(mine.number))!.riskNote).toBe("Договоримся с партнёром о данных до пятницы");
  });
});

describe("связи и сроки", () => {
  it("перенос срока ждущей задачи позже её срока и закрытие приходят ответственному зависимой", async () => {
    const mine = await task("reva", "Запуск", addDays(today, 7));
    const blocker = await task("loginova", "Подготовка данных", addDays(today, 5));
    await svc.changeState(await actors.reva(), mine.number, "blocked", null, { waitTask: blocker.number });
    await prisma.inboxEvent.deleteMany();
    const loginova = await actors.loginova();
    await svc.transferDue(loginova, blocker.number, addDays(today, 6), "Выгрузка задерживается");
    expect(await texts("reva")).toEqual([]);
    await svc.transferDue(loginova, blocker.number, addDays(today, 9), "Ещё задержка");
    expect(await texts("reva")).toEqual([`Срок задачи ${blocker.number}, которую ждёт ваша задача ${mine.number}, перенесён на ${formatLong(addDays(today, 9))}: позже вашего срока`]);
    const late = (await svc.getTask(mine.number))!;
    expect(lateWaits(late)).toEqual([blocker.number]);
    const links = (await svc.taskLinks(await actors.reva(), mine.number))!;
    expect(links.waitsFor).toEqual([expect.objectContaining({ number: blocker.number, late: true, title: "Подготовка данных" })]);
    expect((await svc.taskLinks(loginova, blocker.number))!.blocks).toEqual([expect.objectContaining({ number: mine.number, late: true })]);
    await svc.changeStatus(loginova, blocker.number, "done", "Данные в папке");
    expect(await texts("reva")).toContain(`Задача ${blocker.number}, которую ждёт ваша задача ${mine.number}: выполнена`);
    expect(lateWaits((await svc.getTask(mine.number))!)).toEqual([]);
  });
});

describe("передача задачи", () => {
  it("ответственный передаёт коллеге из команды с комментарием: прежний соисполнитель, история и события", async () => {
    const mine = await task("reva", "Анализ оттока");
    const reva = await actors.reva();
    await expectRule(svc.handOver(reva, mine.number, "loginova", "  "), /почему передаёте/);
    await expectRule(svc.handOver(reva, mine.number, "reva", "Себе"), /уже у этого человека/);
    await expectRule(svc.handOver(await actors.fatyanov(), mine.number, "loginova", "Чужую"), /Передаёт задачу/);
    const moved = await svc.handOver(reva, mine.number, "loginova", "Это зона RED, у Светы есть данные");
    expect(moved.task).toMatchObject({ owner: "loginova", coExecutors: ["reva"] });
    expect(await texts("loginova")).toContain("Задача передана вам: Это зона RED, у Светы есть данные");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entity: "task", entityId: String(mine.number), action: "task.handover" } });
    expect(log).toMatchObject({ field: "Ответственный", before: "Рева Тарас", after: "Логинова Светлана. Причина: Это зона RED, у Светы есть данные" });
    // Закрытую и предложенную не передают
    await svc.changeStatus(await actors.loginova(), mine.number, "done", "Готово");
    await expectRule(svc.handOver(await actors.loginova(), mine.number, "fatyanov", "Дальше"), /Закрытую задачу не передают/);
    const offer = (await svc.createTask(await actors.fatyanov(), { title: "Предложение", outcome: "Результат", owner: "loginova", direction: "kasko", due: future })).task;
    await expectRule(svc.handOver(await actors.owner(), offer.number, "reva", "Сразу дальше"), /сначала принимают/);
  });

  it("режим управления передаёт и снимает с человека событие о соисполнительстве", async () => {
    const mine = await task("fatyanov", "Оценка рынка");
    await prisma.inboxEvent.deleteMany();
    await svc.handOver(await actors.owner(), mine.number, "reva", "Тарас ведёт продукт");
    expect(await texts("fatyanov")).toEqual(["Задачу передали: Рева Тарас. Вы соисполнитель"]);
    expect(await texts("reva")).toEqual(["Задача передана вам: Тарас ведёт продукт"]);
  });
});

describe("правки по проверке кода", () => {
  it("закрытую задачу ждать нельзя, архивная не считается ссылкой; последнюю ссылку заблокированной задачи не снять", async () => {
    const mine = await task("reva", "Запуск");
    const done = await task("loginova", "Уже сделано");
    await svc.changeStatus(await actors.owner(), done.number, "done", "Готово");
    await expectRule(svc.addDependency(await actors.reva(), mine.number, done.number), /уже закрыта/);
    const other = await task("loginova", "Подготовка");
    const blocked = await svc.changeState(await actors.reva(), mine.number, "blocked", null, { waitTask: other.number });
    // Новая связь: отмена такой правки не предлагается
    expect(blocked.undo).toBeUndefined();
    await expectRule(svc.removeDependency(await actors.reva(), mine.number, other.number), /больше ничего не ждёт/);
    await prisma.task.update({ where: { number: other.number }, data: { archivedAt: new Date() } });
    expect((await svc.getTask(mine.number))!.waitsFor).toEqual([expect.objectContaining({ number: other.number, closed: true })]);
    await svc.changeState(await actors.reva(), mine.number, "on-track");
    await expectRule(svc.changeState(await actors.reva(), mine.number, "blocked", "Ждём"), /кого ждёт задача/);
  });

  it("блокировка на человека не отменяется кнопкой: просьба уже ушла", async () => {
    const mine = await task("reva", "Договор");
    const { task: t } = await req.blockOnPerson(await actors.reva(), mine.number, { to: "loginova", text: "Посмотреть договор", due: future });
    expect(t.undo).toBeUndefined();
    // Открытая просьба: повторная блокировка без новой ссылки проходит
    await svc.changeState(await actors.reva(), mine.number, "on-track");
    expect((await svc.changeState(await actors.reva(), mine.number, "blocked")).task.blockedBy).toBe("Ждёт ответа: Логинова Светлана");
    expect((await svc.taskLinks(await actors.reva(), mine.number))!.existing).toBe("Ждёт ответа: Логинова Светлана");
  });

  it("передача: по общему логину нельзя, соисполнители в истории", async () => {
    const mine = await task("reva", "Сводка");
    const team = { ...(await actors.reva()), via: "TEAM" as const };
    await expectRule(svc.handOver(team, mine.number, "loginova", "Передаю"), /при личном входе/);
    await svc.handOver(await actors.reva(), mine.number, "loginova", "Передаю");
    const co = await prisma.auditLog.findFirstOrThrow({ where: { entity: "task", entityId: String(mine.number), field: "Соисполнители" } });
    expect(co).toMatchObject({ before: "нет", after: "Рева Тарас" });
  });

  describe("по структуре", () => {
    const STRUCTURE = [
      ["ФИО", "Должность", "Управление", "Отдел", "Сектор", "Руководитель", "Руководит"],
      ["Рева Тарас", "CPO", "Управление развития продуктов", "", "", "Мурадян Арам", "да"],
      ["Антонов Дмитрий", "PO OSAGO", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "Рева Тарас", "да"],
      ["Петров Олег", "Product Designer", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "", ""],
      ["Токов Никита", "Team Lead", "Управление развития продуктов", "Продуктовая аналитика", "", "Рева Тарас", "да"],
      ["Иванова Мария", "Аналитик", "Управление развития продуктов", "Продуктовая аналитика", "", "", ""],
    ]
      .map((r) => r.join("\t"))
      .join("\n");
    const slugOf = async (start: string) => (await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } } })).slug;
    const actor = async (start: string) => svc.actorFor(await slugOf(start));
    const teamLedBy = async (start: string) => prisma.team.findFirstOrThrow({ where: { leader: { fullName: { startsWith: start } } } });
    async function cleanOrg() {
      await prisma.helpRequest.deleteMany();
      await prisma.task.deleteMany();
      await prisma.teamMember.deleteMany({ where: { teamId: { not: TOP_TEAM } } });
      await prisma.team.deleteMany({ where: { id: { not: TOP_TEAM } } });
      await prisma.person.updateMany({ data: { unitId: null, managerId: null, functionalManagerId: null, position: null } });
      await prisma.person.deleteMany({ where: { role: "EMPLOYEE" } });
      await prisma.vacancy.deleteMany();
      await prisma.orgUnit.deleteMany({ where: { kind: { not: "DEPARTMENT" } } });
      await prisma.orgUnit.deleteMany();
    }

    it("чужую задачу не связать, а в связях она без названия; ответственный не отдаёт задачу топ-команды своим людям", async () => {
      await cleanOrg();
      await org.applyStructure(await actors.owner(), STRUCTURE);
      const analytics = await teamLedBy("Токов");
      const sector = await teamLedBy("Антонов");
      const ivanova = await actor("Иванова");
      const petrov = await actor("Петров");
      const hers = (await svc.createTask(ivanova, { title: "Конверсия шага оплаты", outcome: "Отчёт", owner: ivanova.slug, direction: "kasko", due: future, team: analytics.id })).task;
      const his = (await svc.createTask(petrov, { title: "Макет экрана оплаты", outcome: "Макет", owner: petrov.slug, direction: "kasko", due: future, team: sector.id })).task;
      await expectRule(svc.addDependency(petrov, his.number, hers.number), new RegExp(`Задачи ${hers.number} нет`));
      // Связь ставит тот, кто видит обе, а Петров видит её без названия и ответственного
      await svc.addDependency(await actors.owner(), his.number, hers.number);
      const links = (await svc.taskLinks(petrov, his.number))!;
      expect(links.waitsFor).toEqual([expect.objectContaining({ number: hers.number, title: null, owner: null })]);
      // Рева руководит управлением, но задачу топ-команды отдаёт только людям топ-команды
      const top = await task("reva", "Стратегия продукта");
      await expectRule(svc.handOver(await actors.reva(), top.number, ivanova.slug, "Пусть посчитает"), /из команды задачи/);
      // Руководитель команды задачи может забрать её себе или отдать человеку команды
      const moved = await svc.handOver(await actor("Токов"), hers.number, await slugOf("Токов"), "Беру на себя");
      expect(moved.task.coExecutors).toContain(ivanova.slug);
      await cleanOrg();
    });
  });
});
