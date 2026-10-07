// Этап 21: просьбы коллегам (модуль М4). Путь просьбы, кто что может, напоминания, задача из просьбы,
// зависшие просьбы и предложения для встречи, кто видит просьбу.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as req from "@/lib/requests/service";
import * as inbox from "@/lib/inbox/service";
import * as org from "@/lib/org/service";
import { TOP_TEAM } from "@/lib/org/scope";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays, formatShort } from "@/domain/dates";

const t0 = new Date();
const today = moscowToday(t0);
const future = addDays(today, 10);
const later = (hours: number) => new Date(t0.getTime() + hours * 3_600_000);
const actors = {
  owner: () => svc.actorFor("muradyan", "OWNER"),
  admin: () => svc.actorFor("golovkin", "ADMIN"),
  adminPlain: () => svc.actorFor("golovkin"),
  reva: () => svc.actorFor("reva"),
  loginova: () => svc.actorFor("loginova"),
  fatyanov: () => svc.actorFor("fatyanov"),
  observer: async (): Promise<svc.Actor> => ({ ...(await svc.actorFor("ceo")), role: "OBSERVER" }),
};
const id = async (slug: string) => (await prisma.person.findUniqueOrThrow({ where: { slug } })).id;
const texts = async (slug: string, now = later(1)) => (await inbox.listInbox(await id(slug), now)).items.map((i) => i.text);
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(svc.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
const newTask = async (a: svc.Actor, title: string, owner: string, team?: string) =>
  (await svc.createTask(a, { title, outcome: "Результат", owner, direction: "kasko", due: future, team })).task;

async function clean() {
  await prisma.helpRequest.deleteMany();
  await prisma.task.deleteMany();
  await prisma.inboxEvent.deleteMany();
}

beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("путь просьбы", () => {
  it("просьба к задаче: адресату событие, он принимает со сроком и выполняет, автор узнаёт о каждом ответе", async () => {
    const task = await newTask(await actors.reva(), "Оценить рынок КАСКО", "reva");
    const created = await req.createRequest(await actors.reva(), { to: "loginova", text: "Нужны данные по трафику КАСКО за сентябрь", due: future, task: task.number }, t0);
    expect(created).toMatchObject({ status: "open", author: "reva", addressee: "loginova", task: { number: task.number }, stuck: false });
    expect(created.can).toMatchObject({ withdraw: true, remind: true, accept: false, done: false });
    const box = (await inbox.listInbox(await id("loginova"), later(1))).items;
    expect(box[0]).toMatchObject({ subject: `request:${created.number}`, kind: "REQUEST", requestNumber: created.number });
    expect(box[0]!.text).toBe(`Просит: Нужны данные по трафику КАСКО за сентябрь. Срок ${formatShort(future)}`);

    const loginova = await actors.loginova();
    expect((await req.getRequest(loginova, created.number, t0))!.can).toMatchObject({ accept: true, decline: true, done: true, toTask: true, withdraw: false, remind: false });
    const accepted = await req.acceptRequest(loginova, created.number, addDays(today, 3), t0);
    // Адресат ответил: его событие о просьбе разобрано само
    expect(await texts("loginova")).toEqual([]);
    expect(accepted).toMatchObject({ status: "accepted", acceptedDue: addDays(today, 3) });
    expect(await texts("reva")).toEqual([expect.stringMatching(/^Просьба принята, срок /)]);
    await expectRule(req.acceptRequest(loginova, created.number, addDays(today, 3), t0), /Срок уже такой/);
    const moved = await req.acceptRequest(loginova, created.number, addDays(today, 5), t0);
    expect(moved.acceptedDue).toBe(addDays(today, 5));

    const done = await req.completeRequest(loginova, created.number, "Выгрузка в папке команды", t0);
    expect(done).toMatchObject({ status: "done", answer: "Выгрузка в папке команды" });
    expect(Object.values(done.can).every((v) => v === false)).toBe(true);
    await expectRule(req.declineRequest(loginova, created.number, "Поздно", t0), /уже выполнена/);
    const journal = await prisma.auditLog.findMany({ where: { entity: "request", entityId: String(created.number) }, orderBy: { id: "asc" } });
    expect(journal.map((j) => j.action)).toEqual(["request.create", "request.accept", "request.accept", "request.done"]);
  });

  it("правила: себе, в прошлое, без текста и наблюдателю нельзя; отказ только с причиной; отозвать может автор", async () => {
    const reva = await actors.reva();
    await expectRule(req.createRequest(reva, { to: "reva", text: "Себе", due: future }), /Себя просить не нужно/);
    await expectRule(req.createRequest(reva, { to: "loginova", text: "Вчера", due: addDays(today, -1) }), /в прошлом/);
    await expectRule(req.createRequest(reva, { to: "loginova", text: "  ", due: future }), /Напишите, что нужно/);
    await expectRule(req.createRequest(reva, { to: "nobody", text: "Кому-то", due: future }), /из списка/);
    await expectRule(req.createRequest(await actors.observer(), { to: "loginova", text: "Посмотреть", due: future }), /Наблюдатель/);

    const r = await req.createRequest(reva, { to: "loginova", text: "Проверить расчёт", due: future });
    await expectRule(req.declineRequest(await actors.loginova(), r.number, "  "), /причину/);
    await expectRule(req.withdrawRequest(await actors.loginova(), r.number), /автор/);
    await expectRule(req.completeRequest(await actors.fatyanov(), r.number, null), /Просьбы \d+ нет/);
    const declined = await req.declineRequest(await actors.loginova(), r.number, "Это вопрос к аналитике");
    expect(declined).toMatchObject({ status: "declined", answer: "Это вопрос к аналитике" });
    expect(await texts("reva")).toEqual(["Просьба отклонена: Это вопрос к аналитике"]);

    const second = await req.createRequest(reva, { to: "loginova", text: "Уже не нужно", due: future });
    expect((await req.withdrawRequest(reva, second.number)).status).toBe("withdrawn");
    await expectRule(req.acceptRequest(await actors.loginova(), second.number, future), /уже отозвана/);
  });

  it("напомнить можно раз в сутки, только автору и только по открытой просьбе", async () => {
    const reva = await actors.reva();
    const r = await req.createRequest(reva, { to: "loginova", text: "Согласовать макет", due: future }, t0);
    await prisma.inboxEvent.deleteMany();
    expect((await req.remindRequest(reva, r.number, later(2))).can.remind).toBe(false);
    expect(await texts("loginova", later(3))).toEqual(["Напоминает о просьбе: Согласовать макет"]);
    await expectRule(req.remindRequest(reva, r.number, later(10)), /раз в сутки/);
    await expectRule(req.remindRequest(await actors.loginova(), r.number, later(10)), /автор/);
    expect((await req.remindRequest(reva, r.number, later(23))).remindedAt).not.toBeNull();
  });

  it("режим управления решает за адресата: адресат и автор оба узнают", async () => {
    const r = await req.createRequest(await actors.reva(), { to: "loginova", text: "Подготовить слайд", due: future });
    await expectRule(req.acceptRequest(await actors.adminPlain(), r.number, future), /адресат/);
    await prisma.inboxEvent.deleteMany();
    await req.acceptRequest(await actors.admin(), r.number, future);
    expect(await texts("reva")).toHaveLength(1);
    expect(await texts("loginova")).toHaveLength(1);
  });
});

describe("задача из просьбы", () => {
  it("адресат делает просьбу своей задачей; выполнил задачу, и просьба закрылась сама", async () => {
    const reva = await actors.reva();
    const source = await newTask(reva, "Найм в КАСКО", "reva");
    const r = await req.createRequest(reva, { to: "loginova", text: "Провести два интервью с кандидатами на позицию аналитика КАСКО до конца недели", due: future, task: source.number });
    await expectRule(req.requestToTask(reva, r.number, null), /адресат/);
    const loginova = await actors.loginova();
    const { request, task } = await req.requestToTask(loginova, r.number, null);
    expect(request).toMatchObject({ status: "accepted", acceptedDue: future, resultTask: { number: task } });
    const made = (await svc.getTask(task))!;
    expect(made).toMatchObject({ owner: "loginova", status: "in-progress", due: future, direction: "kasko" });
    expect(made.title.length).toBeLessThanOrEqual(120);
    expect(await texts("reva")).toContain(`Просьба стала задачей ${task}, срок ${formatShort(future)}`);
    await expectRule(req.requestToTask(loginova, r.number, null), /уже сделана задача/);

    await svc.changeStatus(loginova, task, "done", "Интервью проведены");
    const closed = (await req.getRequest(reva, r.number))!;
    expect(closed).toMatchObject({ status: "done", answer: `Задача ${task} выполнена` });
    expect(await texts("reva")).toContain(`Просьба выполнена: задача ${task} закрыта`);
  });

  it("без задачи-источника направление обязательно", async () => {
    const r = await req.createRequest(await actors.reva(), { to: "loginova", text: "Собрать отзывы клиентов", due: future });
    await expectRule(req.requestToTask(await actors.loginova(), r.number, null), /направление/);
    const { task } = await req.requestToTask(await actors.loginova(), r.number, "red");
    expect((await svc.getTask(task))!.direction).toBe("red");
  });
});

describe("просьба идёт за задачей (правки по проверке кода)", () => {
  it("отмена «Выполнена» возвращает просьбу; отменённая задача отклоняет просьбу с причиной; открыли снова, и просьба снова принята", async () => {
    const reva = await actors.reva();
    const loginova = await actors.loginova();
    const r = await req.createRequest(reva, { to: "loginova", text: "Сверить выгрузку", due: future });
    const { task } = await req.requestToTask(loginova, r.number, "red");
    const closed = await svc.changeStatus(loginova, task, "done", "Сверено");
    expect((await req.getRequest(reva, r.number))!.status).toBe("done");
    await svc.undoChange(loginova, closed.undo!);
    expect((await req.getRequest(reva, r.number))!).toMatchObject({ status: "accepted", answer: null });
    expect(await texts("reva")).toContain(`Задача ${task} снова в работе: просьба снова принята`);

    await svc.changeStatus(loginova, task, "cancelled", "Данные не нужны");
    expect((await req.getRequest(reva, r.number))!).toMatchObject({ status: "declined", answer: `Задача ${task} отменена: Данные не нужны` });
    await svc.changeStatus(await actors.admin(), task, "in-progress");
    expect((await req.getRequest(reva, r.number))!.status).toBe("accepted");
  });

  it("перенос срока задачи переносит срок просьбы; у просьбы-задачи срок и ответ меняются только через задачу", async () => {
    const reva = await actors.reva();
    const loginova = await actors.loginova();
    const r = await req.createRequest(reva, { to: "loginova", text: "Собрать требования", due: future });
    const { task, request } = await req.requestToTask(loginova, r.number, "red");
    expect(request.can).toMatchObject({ accept: false, decline: false, done: false, toTask: false });
    await expectRule(req.acceptRequest(loginova, r.number, addDays(today, 20)), /Срок просьбы идёт за задачей/);
    await expectRule(req.completeRequest(loginova, r.number, null), /закройте задачу/);
    await svc.transferDue(loginova, task, addDays(today, 15), "Ждём данные");
    expect((await req.getRequest(reva, r.number))!.acceptedDue).toBe(addDays(today, 15));
    expect(await texts("reva")).toContain(`Новый срок по просьбе: ${formatShort(addDays(today, 15))}, за сроком задачи ${task}`);
  });

  it("отозванную просьбу задача не переписывает; адресат узнаёт, что задачу можно отменить", async () => {
    const reva = await actors.reva();
    const loginova = await actors.loginova();
    const r = await req.createRequest(reva, { to: "loginova", text: "Подготовить сравнение", due: future });
    const { task } = await req.requestToTask(loginova, r.number, "red");
    await req.withdrawRequest(reva, r.number);
    expect(await texts("loginova")).toContain(`Просьбу отозвали: делать не нужно. Задачу ${task} можно отменить`);
    await svc.changeStatus(loginova, task, "done", "Сделано");
    expect((await req.getRequest(reva, r.number))!.status).toBe("withdrawn");
  });

  it("задача из просьбы не цепляется к записи автора; своя просьба у владельца не получает кнопок адресата", async () => {
    const owner = await actors.owner();
    const own = await req.createRequest(owner, { to: "reva", text: "Свой вопрос", due: future });
    expect(own.can).toMatchObject({ accept: false, decline: false, done: false, withdraw: true });
    const r = await req.createRequest(await actors.reva(), { to: "loginova", text: "Без записи", due: future });
    const { task } = await req.requestToTask(await actors.loginova(), r.number, "red");
    expect((await prisma.task.findUniqueOrThrow({ where: { number: task } })).weeklyEntryId).toBeNull();
  });

  it("просьбы в карточке задачи видят только участники просьбы; огромный номер просто не найден", async () => {
    const reva = await actors.reva();
    const source = await newTask(reva, "Общая задача топ-команды", "reva");
    await req.createRequest(reva, { to: "loginova", text: "Личная просьба", due: future, task: source.number });
    expect(await req.requestsForTask(reva, source.number)).toHaveLength(1);
    expect(await req.requestsForTask(await actors.fatyanov(), source.number)).toHaveLength(0);
    expect(await req.getRequest(reva, 99_999_999_999)).toBeNull();
    await expectRule(req.acceptRequest(await actors.loginova(), 99_999_999_999, future), /Нет такой просьбы/);
  });
});

describe("списки и встреча", () => {
  it("«Просьбы ко мне» и «Жду от коллег»: открытые, а закрытые автору ещё неделю", async () => {
    const reva = await actors.reva();
    const a = await req.createRequest(reva, { to: "loginova", text: "Первая", due: future });
    const b = await req.createRequest(reva, { to: "fatyanov", text: "Вторая", due: future });
    await req.declineRequest(await actors.fatyanov(), b.number, "Нет времени");
    const mine = await req.myRequests(reva);
    expect(mine.outgoing.map((r) => [r.number, r.status])).toEqual([
      [a.number, "open"],
      [b.number, "declined"],
    ]);
    expect(mine.incoming).toEqual([]);
    expect((await req.myRequests(await actors.loginova())).incoming.map((r) => r.number)).toEqual([a.number]);
    expect((await req.myRequests(reva, later(8 * 24))).outgoing.map((r) => r.number)).toEqual([a.number]);
  });

  it("на встречу попадают просьбы без ответа больше 2 рабочих дней, просроченные принятые и предложения без ответа 3 дня", async () => {
    const reva = await actors.reva();
    const old = new Date(t0.getTime() - 7 * 86_400_000);
    const stale = await req.createRequest(reva, { to: "loginova", text: "Старая просьба", due: addDays(moscowToday(old), 1) }, old);
    const fresh = await req.createRequest(reva, { to: "fatyanov", text: "Свежая просьба", due: future }, t0);
    const accepted = await req.createRequest(reva, { to: "fatyanov", text: "Принятая", due: future }, t0);
    await req.acceptRequest(await actors.fatyanov(), accepted.number, addDays(today, 1), t0);
    const offer = await newTask(await actors.loginova(), "Сверить отчёт по ДВС", "reva");
    await prisma.task.update({ where: { number: offer.number }, data: { createdAt: new Date(t0.getTime() - 4 * 86_400_000) } });

    const now = later(3 * 24);
    const { requests, proposals } = await req.stuckForMeeting(await actors.owner(), [TOP_TEAM], now);
    expect(requests.map((r) => r.number).sort()).toEqual([stale.number, accepted.number].sort());
    expect(requests.every((r) => r.stuck)).toBe(true);
    expect(requests.map((r) => r.number)).not.toContain(fresh.number);
    expect(proposals.map((p) => [p.number, p.owner, p.createdBy])).toEqual([[offer.number, "reva", "loginova"]]);
    expect(proposals[0]!.days).toBeGreaterThanOrEqual(4);
  });
});

describe("кто видит просьбу", () => {
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

  async function cleanOrg() {
    await clean();
    await prisma.teamMember.deleteMany({ where: { teamId: { not: TOP_TEAM } } });
    await prisma.team.deleteMany({ where: { id: { not: TOP_TEAM } } });
    await prisma.person.updateMany({ data: { unitId: null, managerId: null, functionalManagerId: null, position: null } });
    await prisma.person.deleteMany({ where: { role: "EMPLOYEE" } });
    await prisma.vacancy.deleteMany();
    await prisma.orgUnit.deleteMany({ where: { kind: { not: "DEPARTMENT" } } });
    await prisma.orgUnit.deleteMany();
  }
  beforeAll(async () => {
    await cleanOrg();
    await org.applyStructure(await actors.owner(), STRUCTURE);
  });
  afterAll(cleanOrg);

  it("автор, адресат и их руководители видят просьбу, посторонний нет; чужая задача в просьбе не раскрывается", async () => {
    const ivanova = await actor("Иванова");
    const petrov = await actor("Петров");
    const analytics = await prisma.team.findFirstOrThrow({ where: { leader: { fullName: { startsWith: "Токов" } } } });
    const own = await newTask(ivanova, "Посчитать конверсию шага оплаты", ivanova.slug, analytics.id);
    const r = await req.createRequest(ivanova, { to: petrov.slug, text: "Нужен макет экрана оплаты", due: future, task: own.number });
    expect((await req.getRequest(await actor("Токов"), r.number))?.task).toEqual({ number: own.number, title: "Посчитать конверсию шага оплаты" });
    // Адресат видит просьбу, но не задачу чужой команды
    const forPetrov = await req.getRequest(petrov, r.number);
    expect(forPetrov).toMatchObject({ number: r.number, task: null });
    expect(await req.getRequest(await actor("Антонов"), r.number)).not.toBeNull();
    expect(await req.getRequest(await actors.fatyanov(), r.number)).toBeNull();
    expect(await req.getRequest(await actors.owner(), r.number)).not.toBeNull();
    // Чужую задачу к просьбе не привязать
    await expectRule(req.createRequest(petrov, { to: ivanova.slug, text: "Посмотреть цифры", due: future, task: own.number }), /Задачи \d+ нет/);
  });

  it("общий логин видит и создаёт только просьбы между людьми топ-команды", async () => {
    const team = async (slug: string): Promise<svc.Actor> => ({ ...(await svc.actorFor(slug)), via: "TEAM" });
    const ivanova = await actor("Иванова");
    const outside = await req.createRequest(ivanova, { to: "reva", text: "Подписать заявку", due: future });
    expect(await req.getRequest(await team("reva"), outside.number)).toBeNull();
    await expectRule(req.createRequest(await team("reva"), { to: ivanova.slug, text: "Срочно", due: future }), /топ-команды/);
    const inside = await req.createRequest(await team("reva"), { to: "loginova", text: "Внутри команды", due: future });
    expect(await req.getRequest(await team("loginova"), inside.number)).not.toBeNull();
  });
});
