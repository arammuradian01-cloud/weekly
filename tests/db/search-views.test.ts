// Этап 25 (модуль М10): общий поиск с правами, сохранённые виды, массовые действия, чек-лист, повторяющиеся задачи.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as weekly from "@/lib/weekly/service";
import * as org from "@/lib/org/service";
import * as m from "@/lib/meeting/service";
import * as discuss from "@/lib/discuss/service";
import { search, plainSnippet } from "@/lib/search/service";
import { deleteView, listViews, saveView, ViewRuleError } from "@/lib/views/service";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";
import { TOP_TEAM } from "@/lib/org/scope";
import type { WeekKey } from "@/domain/types";

const actor = {
  owner: () => tasks.actorFor("muradyan", "OWNER"),
  reva: () => tasks.actorFor("reva"),
  loginova: () => tasks.actorFor("loginova"),
  team: async (): Promise<tasks.Actor> => ({ ...(await tasks.actorFor("reva")), via: "TEAM" }),
};
const id = async (slug: string) => (await prisma.person.findUniqueOrThrow({ where: { slug } })).id;
const subject = async (slug: string, limited = false) => ({ id: await id(slug), role: (await prisma.person.findUniqueOrThrow({ where: { slug } })).role, limited });
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

let key: WeekKey;
let revaTeam: string;
let employee: string;

beforeAll(async () => {
  key = await weekly.currentReportingKey();
  // Команда Ревы с сотрудником вне топ-команды: он видит только свою команду
  const created = await org.createTeam(await actor.owner(), { name: "Тест: поиск", leader: "reva" });
  revaTeam = created.id;
  const p = await prisma.person.create({ data: { slug: "search-emp", fullName: "Поисков Сотрудник", shortName: "Сотрудник", role: "EMPLOYEE", zone: "", position: "Аналитик" } });
  employee = p.id;
  await org.addTeamMember(await actor.owner(), revaTeam, "search-emp");
});

beforeEach(async () => {
  await prisma.decision.deleteMany();
  await prisma.meeting.deleteMany();
  await prisma.helpRequest.deleteMany();
  await prisma.task.deleteMany();
  await prisma.reaction.deleteMany();
  await prisma.weeklyEntry.deleteMany();
  await prisma.weeklyReport.deleteMany();
  await prisma.inboxEvent.deleteMany();
  await prisma.savedView.deleteMany();
});
afterAll(async () => {
  await prisma.task.deleteMany();
  await prisma.savedView.deleteMany();
  await prisma.team.deleteMany({ where: { id: revaTeam } });
  await prisma.person.delete({ where: { id: employee } });
  await prisma.$disconnect();
});

const mk = async (title: string, patch: Partial<Parameters<typeof tasks.createTask>[1]> = {}) =>
  (await tasks.createTask(await actor.owner(), { title, outcome: "Результат", owner: "reva", direction: "kasko", due: addDays(moscowToday(), 10), team: TOP_TEAM, ...patch })).task;

describe("общий поиск", () => {
  it("находит задачи по словоформам и началу слова, записи, комментарии, решения и людей; номер открывает задачу", async () => {
    const owner = await actor.owner();
    const reva = await actor.reva();
    const t = await mk("Запросить доступ к выгрузке убытков", { outcome: "Выгрузка по убыткам у аналитика" });
    await mk("Другая задача");
    await tasks.addComment(reva, t.number, "Доступ запросили у СК, ждём ответа до пятницы");
    const entry = await weekly.saveEntry(reva, { week: key, direction: "osago", block: "product", type: "event", what: "Получили доступ к витрине убытков" });
    await discuss.addEntryComment(owner, entry.id, "Доступ выдали быстро, отличная выгрузка");
    const meeting = await m.buildAgenda(owner, TOP_TEAM, key);
    await m.startMeeting(owner, meeting.id);
    await m.addDecision(owner, meeting.id, { text: "Доступ к убыткам запрашивает Тарас", owner: "reva" });

    const r = await search(await subject("muradyan"), "доступа", "page");
    const kinds = r.hits.map((h) => h.kind);
    expect(kinds).toContain("task");
    expect(kinds).toContain("entry");
    expect(kinds).toContain("comment");
    expect(kinds).toContain("decision");
    const taskHit = r.hits.find((h) => h.kind === "task");
    expect(taskHit && taskHit.kind === "task" ? taskHit.number : null).toBe(t.number);
    expect(plainSnippet(r.hits.find((h) => h.kind === "entry")!.snippet)).toContain("доступ");
    // Комментарии к задаче и к записи, оба
    expect(r.hits.filter((h) => h.kind === "comment").length).toBe(2);

    // Начало слова
    const prefix = await search(await subject("muradyan"), "выгру");
    expect(prefix.hits.some((h) => h.kind === "task")).toBe(true);
    expect(prefix.hits.some((h) => h.kind === "comment")).toBe(true);

    // Номер задачи: только она, записи с такими цифрами не шумят
    const byNumber = await search(await subject("muradyan"), String(t.number));
    expect(byNumber.hits.map((h) => h.kind)).toEqual(["task"]);

    // Люди: по имени и по должности
    const people = await search(await subject("muradyan"), "аналит");
    expect(people.hits.some((h) => h.kind === "person" && h.slug === "search-emp")).toBe(true);

    // Короткий запрос: пусто без обращения к базе
    expect((await search(await subject("muradyan"), "д")).hits).toEqual([]);
    // Одни стоп-слова: словарю искать нечего, работает подстрока по названию
    await mk("Что и как");
    const stop = await search(await subject("muradyan"), "и как");
    expect(stop.hits.some((h) => h.kind === "task" && h.title === "Что и как")).toBe(true);
    // Знаки подстановки экранируются: «%%» ничего не находит
    expect((await search(await subject("muradyan"), "%%")).hits).toEqual([]);
  });

  it("показывает только то, что человек видит: сотрудник не находит задачи и записи топ-команды, общий логин только топ-команду", async () => {
    const top = await mk("Секретная задача топ-команды про тарифы");
    // Задачу в команде Ревы ставит владелец: при общем логине Рева её не видит, при личном входе видит как руководитель
    const own = (await tasks.createTask(await actor.owner(), { title: "Тарифы для команды Ревы", outcome: "Результат", owner: "search-emp", direction: "kasko", due: addDays(moscowToday(), 5), team: revaTeam })).task;
    await weekly.saveEntry(await actor.owner(), { week: key, direction: "osago", block: "product", type: "event", what: "Тарифы топ-команды обсудили с CEO" });

    const emp = await search(await subject("search-emp"), "тариф", "page");
    const empTasks = emp.hits.filter((h) => h.kind === "task").map((h) => (h.kind === "task" ? h.number : 0));
    expect(empTasks).toEqual([own.number]);
    expect(emp.hits.some((h) => h.kind === "entry")).toBe(false);

    const all = await search(await subject("muradyan"), "тариф", "page");
    expect(all.hits.filter((h) => h.kind === "task").map((h) => (h.kind === "task" ? h.number : 0)).sort()).toEqual([top.number, own.number].sort());
    const revaSees = await search(await subject("reva"), "тариф", "page");
    expect(revaSees.hits.filter((h) => h.kind === "task").length).toBe(2);

    // Общий логин видит задачи топ-команды и её людей, но не людей других команд
    const limited = await search(await subject("reva", true), "тариф", "page");
    expect(limited.hits.filter((h) => h.kind === "task").map((h) => (h.kind === "task" ? h.number : 0))).toEqual([top.number]);
    const limitedPeople = await search(await subject("reva", true), "Поисков");
    expect(limitedPeople.hits.some((h) => h.kind === "person")).toBe(false);
    const fullPeople = await search(await subject("muradyan"), "Поисков");
    expect(fullPeople.hits.some((h) => h.kind === "person")).toBe(true);

    // Архив не ищется
    await tasks.archiveTask(await actor.owner(), top.number);
    const afterArchive = await search(await subject("muradyan"), "секретная");
    expect(afterArchive.hits.filter((h) => h.kind === "task")).toEqual([]);
  });
});

describe("сохранённые виды", () => {
  it("вид сохраняется в каноническом виде, то же имя заменяет фильтры, чужой вид не удалить, лимит имени", async () => {
    const reva = await id("reva");
    const v = await saveView(reva, { path: "/tasks", name: "  Мои   критичные ", query: "?sort=due&f=mine,critical&task=47" });
    expect(v.name).toBe("Мои критичные");
    expect(v.query).toBe("f=mine%2Ccritical&sort=due");
    const again = await saveView(reva, { path: "/tasks", name: "Мои критичные", query: "f=mine" });
    expect(again.id).toBe(v.id);
    expect((await listViews(reva, "/tasks")).map((x) => x.query)).toEqual(["f=mine"]);
    await expect(saveView(reva, { path: "/tasks", name: "Пусто", query: "task=47" })).rejects.toBeInstanceOf(ViewRuleError);
    await expect(saveView(reva, { path: "/weekly", name: "Не туда", query: "f=mine" })).rejects.toThrow(/Задачи/);
    await expect(saveView(reva, { path: "/tasks", name: "х".repeat(61), query: "f=mine" })).rejects.toThrow(/60/);
    await expect(deleteView(await id("loginova"), v.id)).rejects.toThrow(/нет/);
    await deleteView(reva, v.id);
    expect(await listViews(reva, "/tasks")).toEqual([]);
  });
});

describe("массовые действия", () => {
  it("меняют статус, приоритет, срок и ответственного у нескольких задач; задачи без права попадают в список неудач", async () => {
    const owner = await actor.owner();
    const reva = await actor.reva();
    const a = await mk("Первая");
    const b = await mk("Вторая");
    const c = await mk("Чужая для Ревы", { owner: "loginova" });
    // Журнал только дописывается, а номера задач в тестах могут повторяться: считаем прирост
    const logWhere = { entity: "task", entityId: { in: [String(a.number), String(b.number), String(c.number)] }, field: "Приоритет" };
    const logBefore = await prisma.auditLog.count({ where: logWhere });

    const pr = await tasks.bulkChange(owner, [a.number, b.number], { kind: "priority", next: "critical" });
    expect(pr.done.map((t) => t.priority)).toEqual(["critical", "critical"]);
    expect(pr.failed).toEqual([]);

    // Рева меняет статус своих, чужую не может: она в списке неудач с причиной
    const st = await tasks.bulkChange(reva, [a.number, c.number], { kind: "status", next: "done", note: "Сделано разом" });
    expect(st.done.map((t) => t.number)).toEqual([a.number]);
    expect(st.failed).toHaveLength(1);
    expect(st.failed[0]!.number).toBe(c.number);
    expect(st.failed[0]!.error).toMatch(/Статус меняет/);

    // Без итога «Выполнена» не проходит ни у одной
    const noNote = await tasks.bulkChange(owner, [b.number], { kind: "status", next: "done" });
    expect(noNote.done).toEqual([]);
    expect(noNote.failed[0]!.error).toMatch(/итог/);

    const due = addDays(moscowToday(), 20);
    const tr = await tasks.bulkChange(owner, [b.number, c.number], { kind: "due", to: due, reason: "Сдвиг по просьбе СК" });
    expect(tr.done.map((t) => t.due)).toEqual([due, due]);
    expect(tr.done[0]!.transfers[0]!.reason).toBe("Сдвиг по просьбе СК");

    const ow = await tasks.bulkChange(owner, [b.number, c.number], { kind: "owner", owner: "golovkin" });
    expect(ow.done.map((t) => t.owner)).toEqual(["golovkin", "golovkin"]);
    // Ответственного меняет только режим управления
    const owFail = await tasks.bulkChange(reva, [b.number], { kind: "owner", owner: "reva" });
    expect(owFail.failed).toHaveLength(1);

    // Журнал: запись по каждой задаче
    expect((await prisma.auditLog.count({ where: logWhere })) - logBefore).toBe(2);

    await expectRule(tasks.bulkChange(owner, [], { kind: "priority", next: "high" }), /Выберите/);
    await expectRule(tasks.bulkChange(owner, Array.from({ length: 101 }, (_, i) => i + 1), { kind: "priority", next: "high" }), /100/);
  });
});

describe("чек-лист", () => {
  it("пункты добавляет, отмечает и убирает ответственный или управление, не наблюдатель; у закрытой не добавить; журнал пишется", async () => {
    const reva = await actor.reva();
    const loginova = await actor.loginova();
    const owner = await actor.owner();
    const t = await mk("С чек-листом");
    const logWhere = { entity: "task", entityId: String(t.number), field: "Чек-лист" };
    const logBefore = await prisma.auditLog.count({ where: logWhere });
    let r = await tasks.addChecklistItem(reva, t.number, "  Собрать данные ");
    expect(r.task.checklist).toEqual([{ id: expect.any(String), text: "Собрать данные", done: false }]);
    r = await tasks.addChecklistItem(owner, t.number, "Согласовать с СК");
    expect(r.task.checklist).toHaveLength(2);
    const first = r.task.checklist![0]!;
    // Логинова не участник задачи
    await expectRule(tasks.toggleChecklistItem(loginova, t.number, first.id, true), /ведут/);
    r = await tasks.toggleChecklistItem(reva, t.number, first.id, true);
    expect(r.task.checklist![0]).toMatchObject({ done: true, by: "reva" });
    await expectRule(tasks.toggleChecklistItem(reva, t.number, first.id, true), /уже отмечен/);
    r = await tasks.editChecklistItem(reva, t.number, first.id, "Собрать данные по убыткам");
    expect(r.task.checklist![0]!.text).toBe("Собрать данные по убыткам");
    await expectRule(tasks.addChecklistItem(reva, t.number, ""), /Напишите/);
    await expectRule(tasks.addChecklistItem(reva, t.number, "х".repeat(201)), /200/);
    r = await tasks.removeChecklistItem(reva, t.number, r.task.checklist![1]!.id);
    expect(r.task.checklist).toHaveLength(1);
    await tasks.changeStatus(reva, t.number, "done", "Готово");
    await expectRule(tasks.addChecklistItem(reva, t.number, "Ещё"), /закрытой/);
    await expectRule(tasks.toggleChecklistItem(reva, t.number, first.id, false), /закрытой/);
    expect((await prisma.auditLog.count({ where: logWhere })) - logBefore).toBe(5);
    // Соисполнитель тоже ведёт чек-лист
    const t2 = await mk("Вторая с чек-листом", { coExecutors: ["loginova"] });
    await tasks.addChecklistItem(loginova, t2.number, "Пункт соисполнителя");
    // Наблюдатель нет
    const observer = await prisma.person.findFirst({ where: { role: "OBSERVER", active: true } });
    if (observer) await expectRule(tasks.addChecklistItem(await tasks.actorFor(observer.slug), t2.number, "Нельзя"), /ведут/);
  });
});

describe("повторяющиеся задачи", () => {
  it("при закрытии создаётся следующая с новым сроком, копией чек-листа без отметок и событием в «Мне»; второй раз не создаётся", async () => {
    const owner = await actor.owner();
    const reva = await actor.reva();
    const due = addDays(moscowToday(), 3);
    const t = await mk("Еженедельно: прогноз месяца", { due, repeat: { kind: "weekly" }, coExecutors: ["loginova"] });
    expect(t.repeat).toMatchObject({ kind: "weekly", mode: "on-close", active: true });
    await tasks.addChecklistItem(reva, t.number, "Собрать цифры");
    const item = (await tasks.getTask(t.number))!.checklist![0]!;
    await tasks.toggleChecklistItem(reva, t.number, item.id, true);
    await prisma.inboxEvent.deleteMany();

    const closed = await tasks.changeStatus(reva, t.number, "done", "Прогноз сдан");
    expect(closed.task.repeat?.next).toBeDefined();
    // Отмена закрытия не убрала бы созданный повтор, поэтому кнопки «Отменить» у такого закрытия нет
    expect(closed.undo).toBeUndefined();
    const next = (await tasks.getTask(closed.task.repeat!.next!))!;
    expect(next.title).toBe(t.title);
    expect(next.owner).toBe("reva");
    expect(next.coExecutors).toEqual(["loginova"]);
    expect(next.due).toBe(addDays(due, 7));
    expect(next.status).toBe("in-progress");
    expect(next.source.note).toBe(`Повтор задачи ${t.number}`);
    expect(next.checklist).toEqual([{ id: expect.any(String), text: "Собрать цифры", done: false }]);
    expect(next.repeat).toMatchObject({ kind: "weekly", active: true, of: t.number });
    // Ответственный узнал, хотя закрывал сам, и соисполнитель тоже
    const inbox = await prisma.inboxEvent.findMany({ where: { taskId: (await prisma.task.findUniqueOrThrow({ where: { number: next.number } })).id }, include: { recipient: { select: { slug: true } } } });
    expect(inbox.map((e) => e.kind)).toEqual(["TASK_ASSIGNED", "TASK_ASSIGNED"]);
    expect(inbox.map((e) => e.recipient.slug).sort()).toEqual(["loginova", "reva"]);
    expect(inbox[0]!.text).toContain(`Повтор задачи ${t.number}`);
    // В журнале закрытия видно, какая задача создана
    const closeLog = await prisma.auditLog.findFirst({ where: { entity: "task", entityId: String(t.number), field: "Статус", after: { string_contains: `Создан повтор: задача ${next.number}` } } });
    expect(closeLog).not.toBeNull();

    // Открыли и закрыли снова: вторая следующая не создаётся
    await tasks.changeStatus(owner, t.number, "in-progress");
    await tasks.changeStatus(owner, t.number, "done", "Снова");
    expect(await prisma.task.count({ where: { repeatOfId: (await prisma.task.findUniqueOrThrow({ where: { number: t.number } })).id } })).toBe(1);

    // Выключить повтор: у следующей
    const off = await tasks.setRepeat(owner, next.number, null);
    expect(off.task.repeat?.active).toBe(false);
    await expectRule(tasks.setRepeat(owner, next.number, null), /уже/);
    await expectRule(tasks.setRepeat(await actor.loginova(), next.number, { kind: "monthly" }), /задаёт/);
    const monthly = await tasks.setRepeat(owner, next.number, { kind: "monthly", mode: "schedule" });
    expect(monthly.task.repeat).toMatchObject({ kind: "monthly", mode: "schedule", active: true });

    // «Отменена» останавливает серию: повтора нет и у самой задачи, следующая не создаётся
    const cancelled = await tasks.changeStatus(owner, next.number, "cancelled", "Больше не нужно");
    expect(cancelled.task.repeat?.active).toBe(false);
    expect(cancelled.task.repeat?.next).toBeUndefined();
    expect(await prisma.task.count({ where: { repeatOfId: (await prisma.task.findUniqueOrThrow({ where: { number: next.number } })).id } })).toBe(0);
    // Повтор можно выключить и у закрытой задачи
    const t3 = await mk("Закрытая с повтором", { repeat: { kind: "weekly" } });
    await tasks.changeStatus(owner, t3.number, "failed", "Не успели");
    const t3next = (await tasks.getTask(t3.number))!.repeat!.next!;
    expect(t3next).toBeDefined();
    const t3off = await tasks.setRepeat(owner, t3next, null);
    expect(t3off.task.repeat?.active).toBe(false);
  });

  it("предложенная задача с повтором серию не продолжает: отклонение и расписание ничего не создают", async () => {
    const owner = await actor.owner();
    const loginova = await actor.loginova();
    // Логинова предлагает Реве задачу с повтором по расписанию и сроком сегодня
    const proposed = (await tasks.createTask(loginova, { title: "Предложенная с повтором", outcome: "Результат", owner: "reva", direction: "kasko", due: moscowToday(), team: TOP_TEAM, repeat: { kind: "weekly", mode: "schedule" } })).task;
    expect(proposed.status).toBe("proposed");
    expect(await tasks.repeatPass()).toBe(0);
    const declined = await tasks.changeStatus(owner, proposed.number, "cancelled", "Не берём");
    expect(declined.task.repeat?.next).toBeUndefined();
    expect(await prisma.task.count({ where: { repeatOfId: (await prisma.task.findUniqueOrThrow({ where: { number: proposed.number } })).id } })).toBe(0);
  });

  it("по расписанию следующая создаётся в день срока, пока эта открыта; проход идемпотентен", async () => {
    const owner = await actor.owner();
    const today = moscowToday();
    const t = await mk("По расписанию", { due: addDays(today, 1), repeat: { kind: "weekly", mode: "schedule" } });
    // Срок ещё не пришёл: ничего
    expect(await tasks.repeatPass()).toBe(0);
    await prisma.task.update({ where: { number: t.number }, data: { due: new Date(`${today}T00:00:00Z`) } });
    expect(await tasks.repeatPass()).toBe(1);
    expect(await tasks.repeatPass()).toBe(0);
    const next = (await tasks.getTask(t.number))!.repeat!.next!;
    const created = (await tasks.getTask(next))!;
    expect(created.due).toBe(addDays(today, 7));
    expect(created.repeat).toMatchObject({ mode: "schedule", active: true, of: t.number });
    // Закрытие исходной после расписания второй не создаёт
    await tasks.changeStatus(owner, t.number, "done", "Готово");
    expect(await prisma.task.count({ where: { repeatOfId: (await prisma.task.findUniqueOrThrow({ where: { number: t.number } })).id } })).toBe(1);
    // Журнал: «создана повтором» от ресурса по расписанию, без человека; ответственный узнал в «Мне»
    const log = await prisma.auditLog.findFirst({ where: { entity: "task", entityId: String(next), field: "Задача создана повтором" } });
    expect(log?.actorName).toBe("Ресурс по расписанию");
    expect(log?.actorId).toBeNull();
    const inbox = await prisma.inboxEvent.findMany({ where: { taskId: (await prisma.task.findUniqueOrThrow({ where: { number: next } })).id } });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.actorId).toBeNull();
  });
});
