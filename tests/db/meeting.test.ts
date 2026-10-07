// Этап 23: встреча 2.0 (модуль М7). Повестка собирается сама, живой режим, решения, протокол письмом, права,
// приём из Notion.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as weekly from "@/lib/weekly/service";
import * as req from "@/lib/requests/service";
import * as org from "@/lib/org/service";
import * as m from "@/lib/meeting/service";
import * as discuss from "@/lib/discuss/service";
import { setMailTransport, type Mail } from "@/lib/mail";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";
import { shiftWeek } from "@/lib/weekly/weeks";
import { TOP_TEAM } from "@/lib/org/scope";
import type { WeekKey } from "@/domain/types";

const actor = {
  owner: () => tasks.actorFor("muradyan", "OWNER"),
  ownerPlain: () => tasks.actorFor("muradyan"),
  reva: () => tasks.actorFor("reva"),
  loginova: () => tasks.actorFor("loginova"),
  team: async (): Promise<tasks.Actor> => ({ ...(await tasks.actorFor("reva")), via: "TEAM" }),
};
const id = async (slug: string) => (await prisma.person.findUniqueOrThrow({ where: { slug } })).id;
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

let key: WeekKey;
let revaTeam: string;

beforeAll(async () => {
  key = await weekly.currentReportingKey();
  process.env.APP_URL = "http://localhost:3100";
  // Команда Ревы: руководитель Рева, участник Логинова
  const created = await org.createTeam(await actor.owner(), { name: "Тест: команда Ревы", leader: "reva" });
  revaTeam = created.id;
  await org.addTeamMember(await actor.owner(), revaTeam, "loginova");
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
  setMailTransport(null);
});
afterAll(async () => {
  await prisma.decision.deleteMany();
  await prisma.meeting.deleteMany();
  await prisma.task.deleteMany();
  await prisma.team.deleteMany({ where: { id: revaTeam } });
  await prisma.$disconnect();
});

const mk = async (title: string, patch: Partial<Parameters<typeof tasks.createTask>[1]> = {}) =>
  (await tasks.createTask(await actor.owner(), { title, outcome: "Результат", owner: "reva", direction: "kasko", due: addDays(moscowToday(), 10), team: TOP_TEAM, ...patch })).task;

describe("повестка", () => {
  it("собирается из поручений прошлой встречи, блокеров и риска, критичных и просроченных, зависших просьб, вопросов и лидеров; владелец последним", async () => {
    const owner = await actor.owner();
    const reva = await actor.reva();
    // Поручение прошлой встречи: источник «встреча», дата прошлой встречи топ-команды
    const prevMeeting = addDays(shiftWeek(key, -1), 8);
    const follow = await mk("Поручение с прошлой встречи", { source: "meeting" });
    await prisma.task.update({ where: { number: follow.number }, data: { sourceDate: new Date(`${prevMeeting}T00:00:00Z`) } });
    const blocked = await mk("Заблокированная");
    const other = await mk("Та, которую ждут");
    await tasks.changeState(reva, blocked.number, "blocked", null, { waitTask: other.number });
    const critical = await mk("Критичная", { priority: "critical" });
    const overdue = await mk("Давно просрочена", { due: addDays(moscowToday(), 1) });
    await prisma.task.update({ where: { number: overdue.number }, data: { due: new Date(`${addDays(moscowToday(), -10)}T00:00:00Z`) } });
    const r = await req.createRequest(await actor.loginova(), { to: "reva", text: "Выгрузка по убыткам", due: addDays(moscowToday(), 1) });
    await prisma.helpRequest.update({ where: { number: r.number }, data: { createdAt: new Date(Date.now() - 5 * 86_400_000) } });
    const entry = await weekly.saveEntry(reva, { week: key, direction: "osago", block: "product", type: "event", what: "Запустили тест" });
    await discuss.reactToEntry(owner, { entryId: entry.id }, "discuss", "Масштабируем ли тест на все регионы?");

    const view = await m.buildAgenda(owner, TOP_TEAM, key);
    const kinds = view.items.map((i) => i.kind);
    expect(kinds.filter((k) => k === "follow-up")).toHaveLength(1);
    expect(view.items.find((i) => i.kind === "follow-up")?.task?.number).toBe(follow.number);
    expect(view.items.filter((i) => i.kind === "task-state").map((i) => i.task?.number)).toEqual([blocked.number]);
    expect(view.items.filter((i) => i.kind === "task-attention").map((i) => i.task?.number).sort()).toEqual([critical.number, overdue.number].sort());
    expect(view.items.find((i) => i.kind === "request")?.request?.number).toBe(r.number);
    expect(view.items.find((i) => i.kind === "question")?.title).toBe("Масштабируем ли тест на все регионы?");
    const people = view.items.filter((i) => i.kind === "person").map((i) => i.person);
    expect(people.length).toBeGreaterThan(2);
    expect(people[people.length - 1]).toBe("muradyan");
    // Порядок: поручения, потом риски и помощь, потом лидеры
    expect(kinds.indexOf("follow-up")).toBeLessThan(kinds.indexOf("task-state"));
    expect(kinds.indexOf("request")).toBeLessThan(kinds.indexOf("person"));
    expect(view.status).toBe("planned");
    expect(view.canLead).toBe(true);
  });

  it("пересборка не дублирует пункты, убранный не возвращается, ушедший из данных уходит, ручной остаётся", async () => {
    const owner = await actor.owner();
    const blocked = await mk("Заблокированная");
    const other = await mk("Та, которую ждут");
    await tasks.changeState(await actor.reva(), blocked.number, "blocked", null, { waitTask: other.number });
    let view = await m.buildAgenda(owner, TOP_TEAM, key);
    const count = view.items.length;
    view = await m.addAgendaItem(owner, view.id, "Запускаем ли КАСКО для такси?");
    const personItem = view.items.find((i) => i.kind === "person")!;
    view = await m.removeAgendaItem(owner, view.id, personItem.id);
    await tasks.changeState(await actor.reva(), blocked.number, "on-track");
    view = await m.buildAgenda(owner, TOP_TEAM, key);
    expect(view.items.length).toBe(count + 1 - 1 - 1);
    expect(view.items.some((i) => i.id === personItem.id)).toBe(false);
    expect(view.items.some((i) => i.kind === "task-state")).toBe(false);
    expect(view.items.some((i) => i.kind === "manual" && i.title === "Запускаем ли КАСКО для такси?")).toBe(true);
  });

  it("повестку собирает руководитель команды или управление, не лидер и не общий логин; чужую команду не видно", async () => {
    await expectRule(m.buildAgenda(await actor.loginova(), TOP_TEAM, key), /ведёт встречу руководитель/);
    await expectRule(m.buildAgenda(await actor.team(), TOP_TEAM, key), /при личном входе/);
    await expectRule(m.buildAgenda(await actor.team(), revaTeam, key), /не видите/);
    const view = await m.buildAgenda(await actor.reva(), revaTeam, key);
    expect(view.team).toBe(revaTeam);
    expect(view.canLead).toBe(true);
    // Логинова участник команды Ревы: видит, но не ведёт
    const seen = await m.getMeeting(await actor.loginova(), revaTeam, key);
    expect(seen?.canLead).toBe(false);
  });

  it("повестки собираются сами после срока сдачи по всем командам", async () => {
    const week = await weekly.ensureWeek(prisma, key);
    expect(await m.agendaPass(new Date(week.deadline.getTime() - 60_000))).toBe(0);
    const built = await m.agendaPass(new Date(week.deadline.getTime() + 60_000));
    expect(built).toBeGreaterThanOrEqual(2);
    expect(await m.agendaPass(new Date(week.deadline.getTime() + 120_000))).toBe(0);
  });
});

describe("живой режим и решения", () => {
  it("ведущий начинает, листает, отмечает «обсуждено», участник видит текущий пункт; вторая встреча не начинается", async () => {
    const owner = await actor.owner();
    let view = await m.buildAgenda(owner, TOP_TEAM, key);
    view = await m.startMeeting(owner, view.id);
    expect(view.status).toBe("live");
    expect(view.leader).toBe("muradyan");
    expect(view.currentItemId).toBe(view.items[0]!.id);
    await expectRule(m.startMeeting(owner, view.id), /уже ведёт/);
    const second = view.items[1]!;
    view = await m.goToItem(owner, view.id, second.id);
    expect(view.currentItemId).toBe(second.id);
    const seen = await m.getMeeting(await actor.reva(), TOP_TEAM, key);
    expect(seen?.currentItemId).toBe(second.id);
    await expectRule(m.goToItem(await actor.reva(), view.id, second.id), /ведёт встречу/);
    view = await m.setItemDiscussed(owner, view.id, second.id, true);
    expect(view.items.find((i) => i.id === second.id)?.discussed).toBe(true);
    await expectRule(m.goToItem(owner, view.id, "nope"), /уже нет/);
  });

  it("«обсуждено» у вопроса снимает отметку в обсуждении записи", async () => {
    const owner = await actor.owner();
    const reva = await actor.reva();
    const entry = await weekly.saveEntry(reva, { week: key, direction: "osago", block: "product", type: "event", what: "Запустили тест" });
    await discuss.reactToEntry(owner, { entryId: entry.id }, "discuss", "Масштабируем?");
    let view = await m.buildAgenda(owner, TOP_TEAM, key);
    const q = view.items.find((i) => i.kind === "question")!;
    view = await m.setItemDiscussed(owner, view.id, q.id, true);
    const reaction = await prisma.reaction.findFirst({ where: { kind: "DISCUSS" } });
    expect(reaction?.discussedAt).toBeTruthy();
  });

  it("решение с владельцем и задачами: событие владельцу и ответственному задачи, отмена с причиной, поиск по словоформам", async () => {
    const owner = await actor.owner();
    const t = await mk("Запуск тарифа для такси");
    let view = await m.buildAgenda(owner, TOP_TEAM, key);
    await expectRule(m.addDecision(owner, view.id, { text: " " }), /одной фразой/);
    await expectRule(m.addDecision(owner, view.id, { text: "Решение", taskNumbers: [99999] }), /нет/);
    view = await m.addDecision(owner, view.id, { text: "Запускаем КАСКО для такси в ноябре — пилот в двух регионах", owner: "loginova", taskNumbers: [t.number], itemId: view.items[0]!.id });
    expect(view.decisions).toHaveLength(1);
    expect(view.decisions[0]).toMatchObject({ text: "Запускаем КАСКО для такси в ноябре - пилот в двух регионах", owner: "loginova", status: "active", tasks: [{ number: t.number }] });
    expect(view.items[0]!.decisions).toHaveLength(1);
    const toLoginova = await prisma.inboxEvent.findMany({ where: { recipientId: await id("loginova"), kind: "MEETING" } });
    expect(toLoginova.map((e) => e.text)).toEqual([expect.stringContaining("Вы владелец решения")]);
    const toReva = await prisma.inboxEvent.findMany({ where: { recipientId: await id("reva"), kind: "MEETING" } });
    expect(toReva.map((e) => e.text)).toEqual([expect.stringContaining("Решение встречи по задаче")]);
    // Поиск: «такси» в любой форме, «запуск» находит «запускаем»
    expect((await m.listDecisions(await actor.reva(), { query: "такси" })).length).toBe(1);
    expect((await m.listDecisions(await actor.reva(), { query: "запуск" })).length).toBe(1);
    expect((await m.listDecisions(await actor.reva(), { query: "ипотека" })).length).toBe(0);
    // Отмена: только с причиной, только ведущим; отменённое остаётся в журнале
    await expectRule(m.cancelDecision(await actor.loginova(), view.decisions[0]!.id, "Передумали"), /ведёт встречу/);
    await expectRule(m.cancelDecision(owner, view.decisions[0]!.id, ""), /почему/);
    const cancelled = await m.cancelDecision(owner, view.decisions[0]!.id, "Партнёр не готов");
    expect(cancelled).toMatchObject({ status: "cancelled", cancelReason: "Партнёр не готов" });
    expect((await m.listDecisions(owner, { status: "active" })).length).toBe(0);
    expect((await m.listDecisions(owner, { status: "all" })).length).toBe(1);
  });

  it("закрытие собирает протокол с решениями, новыми задачами и изменениями, шлёт письма участникам с почтой и событие остальным", async () => {
    const owner = await actor.owner();
    const reva = await actor.reva();
    await prisma.person.update({ where: { slug: "reva" }, data: { email: "reva@example.ru" } });
    const sent: Mail[] = [];
    setMailTransport(async (mail) => {
      sent.push(mail);
    });
    const before = await mk("Задача до встречи");
    let view = await m.buildAgenda(owner, TOP_TEAM, key);
    view = await m.startMeeting(owner, view.id);
    await new Promise((r) => setTimeout(r, 5));
    const created = await mk("Поставлена на встрече", { source: "meeting" });
    await tasks.changeStatus(reva, before.number, "done", "Готово");
    view = await m.addDecision(owner, view.id, { text: "Запускаем пилот" });
    view = await m.closeMeeting(owner, view.id);
    expect(view.status).toBe("done");
    expect(view.protocol).toContain("Решения\n- Запускаем пилот");
    expect(view.protocol).toContain(`- ${created.number}. Поставлена на встрече`);
    expect(view.protocol).toContain(`- Задача ${before.number}: статус: Выполнена. Готово`);
    expect(view.protocolSentAt).toBeTruthy();
    expect(sent.map((s) => s.to)).toEqual(["reva@example.ru"]);
    expect(sent[0]!.subject).toContain("Протокол встречи");
    const events = await prisma.inboxEvent.findMany({ where: { kind: "MEETING", text: { contains: "Протокол" } } });
    expect(events.length).toBeGreaterThan(1);
    await expectRule(m.closeMeeting(owner, view.id), /уже закрыта/);
    await expectRule(m.addAgendaItem(owner, view.id, "Ещё?"), /закрыта/);
    view = await m.reopenMeeting(owner, view.id);
    expect(view.status).toBe("live");
    await prisma.person.update({ where: { slug: "reva" }, data: { email: null } });
  });

  it("приём из Notion создаёт задачи встречи и решения одной транзакцией", async () => {
    const owner = await actor.owner();
    let view = await m.buildAgenda(owner, TOP_TEAM, key);
    const res = await m.intake(
      owner,
      view.id,
      [
        { kind: "task", title: "Прислать выгрузку по убыткам", owner: "loginova", due: addDays(moscowToday(), 5), direction: "red" },
        { kind: "decision", text: "Не трогаем тарифы ОСАГО до конца месяца", owner: null },
      ],
      "https://www.notion.so/razbor",
    );
    expect(res.tasks).toHaveLength(1);
    expect(res.decisions).toBe(1);
    const t = await prisma.task.findUniqueOrThrow({ where: { number: res.tasks[0]! } });
    expect(t).toMatchObject({ sourceCode: "meeting", teamId: TOP_TEAM });
    expect(res.meeting.notionUrl).toBe("https://www.notion.so/razbor");
    await expectRule(m.intake(owner, view.id, []), /Отметьте/);
    await expectRule(m.setNotionUrl(owner, view.id, "https://evil.example/x"), /Notion/);
    view = await m.setNotionUrl(owner, view.id, null);
    expect(view.notionUrl).toBeUndefined();
  });
});
