// Этап 28: встречи один на один. Пары по структуре, приватность (только участники и только личный вход), темы и их
// перенос, встреча, заметки общие и личные, задача из темы, события «Мне» без утечки по общему логину, журнал без текста.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import * as oo from "@/lib/one-on-one/service";
import { listInbox } from "@/lib/inbox/service";
import { TOP_TEAM } from "@/lib/org/scope";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";
import type { LoginMethod } from "@/generated/prisma/enums";

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

const SECRET = "Секретная тема про ФОТ сектора";
const slugOf = async (start: string) => (await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } } })).slug;
/** Человек при личном входе (или по общему логину team) */
const as = async (start: string, via: LoginMethod = "PASSWORD", management: "OWNER" | "ADMIN" | null = null): Promise<tasks.Actor> => ({ ...(await tasks.actorFor(await slugOf(start), management)), via });
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
const today = () => moscowToday();

async function clean() {
  await prisma.oneOnOnePair.deleteMany();
  await prisma.inboxEvent.deleteMany();
  await prisma.taskWatch.deleteMany();
  await prisma.task.deleteMany();
  await prisma.teamMember.deleteMany({ where: { teamId: { not: TOP_TEAM } } });
  await prisma.goal.deleteMany();
  await prisma.team.deleteMany({ where: { id: { not: TOP_TEAM } } });
  await prisma.person.updateMany({ data: { unitId: null, managerId: null, functionalManagerId: null, position: null } });
  await prisma.person.deleteMany({ where: { role: "EMPLOYEE" } });
  await prisma.vacancy.deleteMany();
  await prisma.orgUnit.deleteMany({ where: { kind: { not: "DEPARTMENT" } } });
  await prisma.orgUnit.deleteMany();
}

beforeAll(async () => {
  await clean();
  await org.applyStructure(await tasks.actorFor("muradyan", "OWNER"), STRUCTURE);
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("кто видит встречу", () => {
  it("руководитель и человек его команды; посторонний, общий логин и режим управления нет", async () => {
    const antonov = await slugOf("Антонов");
    const reva = await as("Рева");
    const view = await oo.getPair(reva, antonov);
    expect(view).toMatchObject({ pairId: null, role: "manager", report: { slug: antonov }, open: [], planned: null });
    expect((await oo.getPair(await as("Антонов"), "reva")).role).toBe("report");
    // Аналитик другой команды Антонову не подчинён
    await expectRule(oo.getPair(await as("Иванова"), antonov), /не в одной команде/);
    // Общий логин: профиль выбирают сами, встречи закрыты даже с режимом управления
    await expectRule(oo.getPair(await as("Рева", "TEAM"), antonov), /только при личном входе/);
    await expectRule(oo.getPair(await as("Мурадян", "TEAM", "OWNER"), "reva"), /только при личном входе/);
    // Владелец при личном входе видит только свои пары: с Ревой да, с Антоновым нет
    expect((await oo.getPair(await as("Мурадян", "PASSWORD", "OWNER"), "reva")).role).toBe("manager");
    await expectRule(oo.getPair(await as("Мурадян", "PASSWORD", "OWNER"), antonov), /не в одной команде/);
  });

  it("список пар: Рева встречается с руководителем и со своими людьми", async () => {
    const list = await oo.listPairs(await as("Рева"));
    expect(list.filter((p) => p.role === "report").map((p) => p.other.slug)).toEqual(["muradyan"]);
    expect(list.filter((p) => p.role === "manager").map((p) => p.other.fullName).sort()).toEqual(["Антонов Дмитрий", "Токов Никита"]);
    await expectRule(oo.listPairs(await as("Рева", "TEAM")), /только при личном входе/);
  });
});

describe("повестка, встреча и заметки", () => {
  it("тему ставит человек, руководитель получает событие; правит и убирает только автор", async () => {
    const antonovActor = await as("Антонов");
    const revaActor = await as("Рева");
    const t = await oo.addTopic(antonovActor, "reva", SECRET);
    expect(t).toMatchObject({ text: SECRET, status: "open", mine: true });
    const pair = await prisma.oneOnOnePair.findFirstOrThrow();
    const ev = await prisma.inboxEvent.findFirstOrThrow({ where: { recipientId: revaActor.personId, kind: "ONE_ON_ONE" } });
    expect(ev.subject).toBe(`1on1:${pair.id}`);
    // В событии только кто и что: текст темы в «Мне», письма и уведомления не уходит
    expect(ev.text).toBe("Новая тема в повестке встречи один на один");
    await expectRule(oo.editTopic(revaActor, t.id, "Чужая правка"), /правит её автор/);
    await expectRule(oo.deleteTopic(revaActor, t.id), /Убрать тему может её автор/);
    expect((await oo.editTopic(antonovActor, t.id, `${SECRET} — уточнение`)).text).toBe(`${SECRET} - уточнение`);
    const own = await oo.addTopic(revaActor, await slugOf("Антонов"), "План на квартал");
    await oo.deleteTopic(revaActor, own.id);
    expect((await oo.getPair(revaActor, await slugOf("Антонов"))).open.map((x) => x.text)).toEqual([`${SECRET} - уточнение`]);
    // Посторонний не правит тему по id
    await expectRule(oo.closeTopic(await as("Иванова"), t.id, "dropped"), /Такой встречи один на один нет/);
  });

  it("итог темы записывается к назначенной встрече; дата не в прошлом; перенос встречи даёт событие", async () => {
    const revaActor = await as("Рева");
    const antonov = await slugOf("Антонов");
    const [topic] = (await oo.getPair(revaActor, antonov)).open;
    await expectRule(oo.closeTopic(revaActor, topic.id, "discussed", "Договорились"), /Сначала назначьте встречу/);
    await expectRule(oo.scheduleMeeting(revaActor, antonov, addDays(today(), -1)), /сегодня или позже/);
    const m = await oo.scheduleMeeting(revaActor, antonov, addDays(today(), 2));
    // Двойное нажатие: та же встреча, а не вторая
    const again = await oo.scheduleMeeting(revaActor, antonov, addDays(today(), 3));
    expect(again.id).toBe(m.id);
    expect(await prisma.oneOnOne.count({ where: { status: "PLANNED" } })).toBe(1);
    const antonovId = (await as("Антонов")).personId;
    const texts = (await prisma.inboxEvent.findMany({ where: { recipientId: antonovId, kind: "ONE_ON_ONE" }, orderBy: { createdAt: "asc" } })).map((e) => e.text);
    expect(texts.some((x) => /назначена/.test(x))).toBe(true);
    expect(texts.some((x) => /перенесена/.test(x))).toBe(true);
    const done = await oo.closeTopic(await as("Антонов"), topic.id, "discussed", "Договорились — вернуться в ноябре");
    expect(done).toMatchObject({ status: "discussed", outcome: "Договорились - вернуться в ноябре" });
    const back = await oo.closeTopic(revaActor, topic.id, "open");
    expect(back.status).toBe("open");
    await oo.closeTopic(revaActor, topic.id, "discussed");
  });

  it("общие заметки видят оба, личные только автор; устаревшее сохранение общих заметок не затирает чужое", async () => {
    const revaActor = await as("Рева");
    const antonovActor = await as("Антонов");
    const antonov = await slugOf("Антонов");
    const planned = (await oo.getPair(revaActor, antonov)).planned!;
    await oo.saveNotes(revaActor, planned.id, { shared: "Общая заметка", mine: "Личное Ревы", base: "" });
    await oo.saveNotes(antonovActor, planned.id, { mine: "Личное Антонова" });
    const fromAntonov = (await oo.getPair(antonovActor, "reva")).planned!;
    expect(fromAntonov).toMatchObject({ notes: "Общая заметка", myNote: "Личное Антонова" });
    expect((await oo.getPair(revaActor, antonov)).planned!.myNote).toBe("Личное Ревы");
    await expectRule(oo.saveNotes(antonovActor, planned.id, { shared: "Затираю", base: "" }), /поменялись у собеседника/);
    // Спор об общих заметках не мешает сохранить личную, если общие не трогали
    expect((await oo.saveNotes(antonovActor, planned.id, { mine: "Личное Антонова, дополнено" })).myNote).toBe("Личное Антонова, дополнено");
    await oo.saveNotes(antonovActor, planned.id, { mine: "Личное Антонова" });
    await expectRule(oo.saveNotes(await as("Токов"), planned.id, { mine: "Подглядываю" }), /Такой встречи один на один нет/);
  });

  it("завершение: открытые темы переходят дальше, обсуждённые в истории, следующая встреча через неделю", async () => {
    const revaActor = await as("Рева");
    const antonovActor = await as("Антонов");
    const antonov = await slugOf("Антонов");
    await oo.addTopic(antonovActor, "reva", "Тема, которую не успели");
    const planned = (await oo.getPair(revaActor, antonov)).planned!;
    const r = await oo.completeMeeting(antonovActor, planned.id, undefined);
    // Встречу провели раньше назначенного дня: в истории она стоит сегодняшним днём, следующая через неделю от него
    const held = planned.date > today() ? today() : planned.date;
    expect(r.next?.date).toBe(addDays(held, 7));
    await expectRule(oo.completeMeeting(revaActor, planned.id, null), /уже завершена/);
    // Тему, закрытую на прошлой встрече, нельзя перезакрыть: сначала вернуть в повестку
    const old = await prisma.oneOnOneTopic.findFirstOrThrow({ where: { status: "DISCUSSED" } });
    await expectRule(oo.closeTopic(revaActor, old.id, "dropped"), /закрыта на прошлой встрече/);
    const view = await oo.getPair(revaActor, antonov);
    expect(view.planned?.date).toBe(addDays(held, 7));
    expect(view.history[0].meeting.date).toBe(held);
    expect(view.open.map((t) => t.text)).toEqual(["Тема, которую не успели"]);
    expect(view.history).toHaveLength(1);
    expect(view.history[0].topics.map((t) => [t.status, t.outcome])).toEqual([["discussed", "Договорились - вернуться в ноябре"]]);
    expect(view.history[0].meeting).toMatchObject({ notes: "Общая заметка", myNote: "Личное Ревы" });
  });

  it("задача из темы: ответственный один из двоих, задача в команде руководителя, повторно нельзя", async () => {
    const revaActor = await as("Рева");
    const antonov = await slugOf("Антонов");
    const [topic] = (await oo.getPair(revaActor, antonov)).open;
    const input = { title: "Подготовить план по ноябрю", outcome: "План согласован", owner: await slugOf("Иванова"), direction: "osago", due: addDays(today(), 7) };
    await expectRule(oo.topicToTask(revaActor, topic.id, input), /вы или ваш собеседник/);
    await expectRule(oo.topicToTask(revaActor, topic.id, { ...input, owner: antonov, due: addDays(today(), -1) }), /не раньше сегодня/);
    const r = await oo.topicToTask(revaActor, topic.id, { ...input, owner: antonov });
    const task = await prisma.task.findUniqueOrThrow({ where: { number: r.task }, include: { owner: true } });
    const cpo = await prisma.team.findFirstOrThrow({ where: { leader: { fullName: { startsWith: "Рева" } } } });
    expect(task).toMatchObject({ teamId: cpo.id, sourceNote: "Встреча один на один", owner: { slug: antonov } });
    expect(r.topic.task?.number).toBe(r.task);
    await expectRule(oo.topicToTask(revaActor, topic.id, { ...input, owner: antonov }), /уже поставлена задача/);
  });
});

describe("приватность событий и журнала", () => {
  it("по общему логину события о встречах в «Мне» не видны; ссылка из «Мне» открывается только участнику", async () => {
    const reva = await as("Рева");
    const personal = await listInbox(reva.personId);
    expect(personal.items.some((i) => i.subject.startsWith("1on1:"))).toBe(true);
    const shared = await listInbox(reva.personId, new Date(), { id: reva.personId, role: reva.role, limited: true, shared: true });
    expect(shared.items.some((i) => i.subject.startsWith("1on1:"))).toBe(false);
    // Общий логин с режимом управления: тоже не видно, разобрать нельзя
    const managed = await listInbox(reva.personId, new Date(), { id: reva.personId, role: reva.role, limited: false, shared: true });
    expect(managed.items.some((i) => i.subject.startsWith("1on1:"))).toBe(false);
    const pairRow = await prisma.oneOnOnePair.findFirstOrThrow();
    const { markDone } = await import("@/lib/inbox/service");
    await expectRule(markDone({ ...reva, via: "TEAM", management: "ADMIN" }, `1on1:${pairRow.id}`), /уже разобрано/);
    const pair = await prisma.oneOnOnePair.findFirstOrThrow();
    expect(await oo.pairPath(reva, pair.id)).toBe(`/one-on-one/${await slugOf("Антонов")}`);
    expect(await oo.pairPath(await as("Антонов"), pair.id)).toBe("/one-on-one/reva");
    expect(await oo.pairPath(await as("Токов"), pair.id)).toBeNull();
    expect(await oo.pairPath(await as("Рева", "TEAM"), pair.id)).toBeNull();
  });

  it("собеседника выключили: история видна обоим, правки закрыты", async () => {
    const alisaId = (await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: "Чемоданова" } } })).id;
    const antonovActor = await as("Антонов");
    const alisa = await slugOf("Чемоданова");
    await oo.addTopic(antonovActor, alisa, "Отпуск в ноябре");
    await prisma.person.update({ where: { id: alisaId }, data: { active: false } });
    const view = await oo.getPair(antonovActor, alisa);
    expect(view.report.active).toBe(false);
    expect(view.open.map((t) => t.text)).toEqual(["Отпуск в ноябре"]);
    await expectRule(oo.addTopic(antonovActor, alisa, "Ещё тема"), /только для чтения/);
    await expectRule(oo.closeTopic(antonovActor, view.open[0].id, "dropped"), /только для чтения/);
    await prisma.person.update({ where: { id: alisaId }, data: { active: true } });
  });

  it("в журнал текст тем и заметок не попадает", async () => {
    const rows = await prisma.auditLog.findMany({ where: { at: { gte: new Date(Date.now() - 60 * 60 * 1000) } } });
    const dump = JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? String(v) : v));
    expect(dump).not.toContain("Секретная тема");
    expect(dump).not.toContain("Личное Ревы");
  });
});
