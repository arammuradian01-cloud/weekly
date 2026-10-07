// Этап 20: упоминания, обсуждение записей weekly, реакции и вопросы к встрече, правка и удаление комментариев,
// письма о непрочитанном, напоминания о сдаче, дайджест, настройки писем, сигналы живых обновлений.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import * as weekly from "@/lib/weekly/service";
import * as discuss from "@/lib/discuss/service";
import * as letters from "@/lib/letters/service";
import { listInbox, markSeen } from "@/lib/inbox/service";
import { TOP_TEAM } from "@/lib/org/scope";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";
import { setMailTransport, type Mail } from "@/lib/mail";
import { readEntryUndoToken, issueEntryUndoToken } from "@/lib/weekly/undo";

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
const observer = async (): Promise<svc.Actor> => ({ ...(await svc.actorFor("ceo")), role: "OBSERVER" });
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(svc.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
const entryInput = (week: string, what: string, extra: Partial<weekly.EntryInput> = {}) => ({ week, direction: "osago", block: "product", type: "result", what, ...extra });
const events = (personId: string, kind?: string) => prisma.inboxEvent.findMany({ where: { recipientId: personId, ...(kind ? { kind: kind as never } : {}) }, orderBy: { createdAt: "asc" } });
/** Москва: UTC+3 */
const msk = (iso: string) => new Date(`${iso}+03:00`);

let week: string;

async function clean() {
  await prisma.mailMark.deleteMany();
  await prisma.reaction.deleteMany();
  await prisma.entryWatch.deleteMany();
  await prisma.entryComment.deleteMany();
  await prisma.taskWatch.deleteMany();
  await prisma.weeklyPromotion.deleteMany();
  await prisma.teamWeekClose.deleteMany();
  await prisma.task.deleteMany();
  await prisma.absence.deleteMany();
  await prisma.inboxEvent.deleteMany();
  await prisma.weeklyEntry.deleteMany({ where: { OR: [{ author: { role: "EMPLOYEE" } }, { author: { slug: { in: ["reva", "loginova"] } } }] } });
  await prisma.weeklyReport.deleteMany({ where: { OR: [{ author: { role: "EMPLOYEE" } }, { author: { slug: { in: ["reva", "loginova"] } } }] } });
  await prisma.teamMember.deleteMany({ where: { teamId: { not: TOP_TEAM } } });
  await prisma.goal.deleteMany();
  await prisma.team.deleteMany({ where: { id: { not: TOP_TEAM } } });
  await prisma.person.updateMany({ data: { unitId: null, managerId: null, functionalManagerId: null, position: null, email: null, mailPrefs: {} } });
  await prisma.person.deleteMany({ where: { role: "EMPLOYEE" } });
  await prisma.vacancy.deleteMany();
  await prisma.orgUnit.deleteMany({ where: { kind: { not: "DEPARTMENT" } } });
  await prisma.orgUnit.deleteMany();
  await prisma.setting.deleteMany({ where: { key: "mail.lock" } });
}

beforeAll(async () => {
  await clean();
  await org.applyStructure(await owner(), STRUCTURE);
  week = await weekly.currentReportingKey();
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("упоминания в комментариях к задачам", () => {
  it("упомянутый получает упоминание и подписку; тот, кто задачу не видит, не получает ничего", async () => {
    const t = (await svc.createTask(await owner(), { title: "Сверить выплаты партнёрам", outcome: "Сверка", owner: "loginova", direction: "department", due: future })).task;
    const reva = await svc.actorFor("reva");
    const loginova = await svc.actorFor("loginova");
    const fatyanov = await svc.actorFor("fatyanov");
    const alisa = await actor("Чемоданова");
    await prisma.inboxEvent.deleteMany();
    const r = await svc.addComment(reva, t.number, "@Логинова Светлана, @Фатьянов Евгений и @Чемоданова Алиса, посмотрите сверку");
    expect(r.warning).toMatch(/Чемоданова Алиса не видит эту задачу/);
    // Ответственная получает упоминание вместо обычного комментария, без дублей
    expect((await events(loginova.personId)).map((e) => e.kind)).toEqual(["MENTION"]);
    expect((await events(fatyanov.personId)).map((e) => e.kind)).toEqual(["MENTION"]);
    expect(await events(alisa.personId)).toHaveLength(0);
    const comment = await prisma.taskComment.findFirstOrThrow({ where: { taskId: (await prisma.task.findUniqueOrThrow({ where: { number: t.number } })).id } });
    expect(comment.mentions.sort()).toEqual([loginova.personId, fatyanov.personId].sort());
    // Фатьянов не участник задачи: он подписан и видит дальнейшие изменения
    expect(await prisma.taskWatch.count({ where: { personId: fatyanov.personId } })).toBe(1);
    expect(await prisma.taskWatch.count({ where: { personId: loginova.personId } })).toBe(0);
    await svc.transferDue(await owner(), t.number, addDays(future, 3), "Ждём данные от партнёра");
    expect((await events(fatyanov.personId)).map((e) => e.kind)).toEqual(["MENTION", "TASK_WATCH"]);
    // Подписчик получает и комментарии
    await svc.addComment(loginova, t.number, "Сверила, расхождений нет");
    expect((await events(fatyanov.personId)).map((e) => e.kind)).toEqual(["MENTION", "TASK_WATCH", "TASK_WATCH"]);
  });

  it("свой комментарий правят 15 минут, новое упоминание приходит один раз, в журнале было и стало", async () => {
    const t = (await svc.createTask(await owner(), { title: "Обновить тарифы КАСКО", outcome: "Тарифы", owner: "fatyanov", direction: "kasko", due: future })).task;
    const reva = await svc.actorFor("reva");
    const cheychenets = await svc.actorFor("cheychenets");
    const { task } = await svc.addComment(reva, t.number, "Нужны новые коэффициенты");
    const c = task.comments[0]!;
    const edited = await svc.editComment(reva, t.number, c.id, "Нужны новые коэффициенты, @Чейченец Евгений подскажет");
    expect(edited.task.comments[0]!.edited).toBe(true);
    expect((await events(cheychenets.personId, "MENTION")).length).toBe(1);
    await svc.editComment(reva, t.number, c.id, "Нужны новые коэффициенты, @Чейченец Евгений подскажет сроки");
    expect((await events(cheychenets.personId, "MENTION")).length).toBe(1);
    const log = await prisma.auditLog.findMany({ where: { action: "task.comment.edit", entityId: String(t.number) }, orderBy: { id: "asc" } });
    expect(log.map((l) => [l.before, l.after])).toEqual([
      ["Нужны новые коэффициенты", "Нужны новые коэффициенты, @Чейченец Евгений подскажет"],
      ["Нужны новые коэффициенты, @Чейченец Евгений подскажет", "Нужны новые коэффициенты, @Чейченец Евгений подскажет сроки"],
    ]);
    await expectRule(svc.editComment(await svc.actorFor("fatyanov"), t.number, c.id, "Чужая правка"), /только свой комментарий/);
    const row = await prisma.taskComment.findUniqueOrThrow({ where: { id: c.id } });
    await expectRule(svc.editComment(reva, t.number, c.id, "Поздно", new Date(row.at.getTime() + 16 * 60_000)), /15 минут/);
  });

  it("удаляет автор или режим управления, текст остаётся в журнале", async () => {
    const t = (await svc.createTask(await owner(), { title: "Проверить отчёт RED", outcome: "Отчёт", owner: "loginova", direction: "red", due: future })).task;
    const reva = await svc.actorFor("reva");
    const first = (await svc.addComment(reva, t.number, "Черновик мысли")).task.comments[0]!;
    await expectRule(svc.deleteComment(await svc.actorFor("loginova"), t.number, first.id), /только свой комментарий/);
    expect((await svc.deleteComment(reva, t.number, first.id)).task.comments).toHaveLength(0);
    const second = (await svc.addComment(reva, t.number, "Ещё одна мысль")).task.comments[0]!;
    expect((await svc.deleteComment(await owner(), t.number, second.id)).task.comments).toHaveLength(0);
    const log = await prisma.auditLog.findMany({ where: { action: "task.comment.delete", entityId: String(t.number) }, orderBy: { id: "asc" } });
    expect(log.map((l) => l.before)).toEqual(["Черновик мысли", "Ещё одна мысль"]);
    expect(log.map((l) => l.field)).toEqual(["Комментарий удалён", "Комментарий удалён"]);
  });

  it("реакция на комментарий доходит до автора, снятая реакция убирает непрочитанное событие", async () => {
    const t = (await svc.createTask(await owner(), { title: "Запуск акции ОСАГО", outcome: "Акция", owner: "golovkin", direction: "osago", due: future })).task;
    const golovkin = await svc.actorFor("golovkin");
    const c = (await svc.addComment(golovkin, t.number, "Макеты готовы")).task.comments[0]!;
    const reva = await svc.actorFor("reva");
    const on = await svc.reactToComment(reva, t.number, c.id, "thanks");
    expect(on.task.comments[0]!.reactions?.map((r) => r.kind)).toEqual(["thanks"]);
    expect((await events(golovkin.personId, "REACTION")).map((e) => e.text)).toEqual(["«Спасибо» к вашему комментарию"]);
    const off = await svc.reactToComment(reva, t.number, c.id, "thanks");
    expect(off.task.comments[0]!.reactions).toBeUndefined();
    expect(await events(golovkin.personId, "REACTION")).toHaveLength(0);
    await expectRule(svc.reactToComment(reva, t.number, c.id, "discuss"), /Сформулируйте вопрос/);
    await expectRule(svc.reactToComment(reva, t.number, c.id, "лайк"), /Такой реакции нет/);
    await expectRule(svc.reactToComment(await observer(), t.number, c.id, "accepted"), /Наблюдатель/);
  });
});

describe("обсуждение записей weekly", () => {
  let entryId: string;

  it("комментарий к записи: автор и подписчики получают событие, упоминание доходит только до тех, кто запись видит", async () => {
    const alisa = await actor("Чемоданова");
    const antonov = await actor("Антонов");
    const reva = await svc.actorFor("reva");
    const tokov = await actor("Токов");
    const petrov = await actor("Петров");
    const saved = await weekly.saveEntry(alisa, entryInput(week, "Сделали новый экран оплаты"));
    entryId = saved.id;
    const first = await discuss.addEntryComment(antonov, entryId, "Отлично! @Рева Тарас, посмотри, @Токов Никита тоже");
    expect(first.warning).toMatch(/Токов Никита не видит эту запись/);
    expect((await events(alisa.personId)).map((e) => e.kind)).toEqual(["ENTRY_COMMENT"]);
    expect((await events(reva.personId)).map((e) => e.kind)).toEqual(["MENTION"]);
    expect(await events(tokov.personId)).toHaveLength(0);
    // Рева отвечает: автор записи и Антонов (уже писал в ветке) получают комментарий, остальные участники сектора нет
    await discuss.addEntryComment(reva, entryId, "Согласен, запускаем");
    expect((await events(alisa.personId)).map((e) => e.kind)).toEqual(["ENTRY_COMMENT", "ENTRY_COMMENT"]);
    expect((await events(antonov.personId)).map((e) => e.kind)).toEqual(["ENTRY_COMMENT"]);
    expect(await events(petrov.personId)).toHaveLength(0);
    // Подписка: Антонов и Рева
    const watchers = await prisma.entryWatch.findMany({ where: { entryId } });
    expect(watchers.map((w) => w.personId).sort()).toEqual([antonov.personId, reva.personId].sort());
    // В ленте у записи ветка
    const view = await weekly.getWeekView(week);
    expect(view.entries.find((e) => e.id === entryId)!.comments!.map((c) => c.text)).toEqual(["Отлично! @Рева Тарас, посмотри, @Токов Никита тоже", "Согласен, запускаем"]);
    expect(await prisma.auditLog.count({ where: { action: "weekly.comment", entityId: entryId } })).toBe(2);
  });

  it("чужую запись не обсуждают, наблюдатель только читает", async () => {
    await expectRule(discuss.addEntryComment(await svc.actorFor("fatyanov"), entryId, "Вопрос"), /Записи нет/);
    await expectRule(discuss.addEntryComment(await observer(), entryId, "Вопрос"), /Наблюдатель/);
    await expectRule(discuss.addEntryComment(await actor("Антонов"), "нет-такой", "Вопрос"), /Записи нет/);
    expect(await discuss.entryForPage(await svc.actorFor("fatyanov"), entryId)).toBeNull();
    expect((await discuss.entryForPage(await actor("Петров"), entryId))?.comments).toHaveLength(2);
  });

  it("комментарий к записи правят 15 минут и удаляют с журналом", async () => {
    const antonov = await actor("Антонов");
    const c = (await discuss.addEntryComment(antonov, entryId, "Опечатка")).comment!;
    const fixed = await discuss.editEntryComment(antonov, c.id, "Без опечатки");
    expect(fixed.comment).toMatchObject({ text: "Без опечатки", edited: true });
    const row = await prisma.entryComment.findUniqueOrThrow({ where: { id: c.id } });
    await expectRule(discuss.editEntryComment(antonov, c.id, "Поздно", new Date(row.at.getTime() + 16 * 60_000)), /15 минут/);
    await expectRule(discuss.editEntryComment(await svc.actorFor("reva"), c.id, "Чужое"), /только свой/);
    await expectRule(discuss.deleteEntryComment(await actor("Чемоданова"), c.id), /только свой/);
    await discuss.deleteEntryComment(antonov, c.id);
    expect(await prisma.entryComment.findUnique({ where: { id: c.id } })).toBeNull();
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "weekly.comment.delete", entityId: entryId } });
    expect(log.before).toBe("Без опечатки");
  });

  it("реакции на запись: автор видит реакцию в «Мне», «Обсудить на встрече» ставит вопрос в повестку", async () => {
    const alisa = await actor("Чемоданова");
    const reva = await svc.actorFor("reva");
    const antonov = await actor("Антонов");
    const petrov = await actor("Петров");
    await prisma.inboxEvent.deleteMany();
    const accepted = await discuss.reactToEntry(reva, { entryId }, "accepted");
    expect(accepted).toMatchObject({ on: true });
    expect((await events(alisa.personId, "REACTION")).map((e) => e.text)).toEqual(["«Принято» к вашей записи «Сделали новый экран оплаты»"]);
    await discuss.reactToEntry(reva, { entryId }, "accepted");
    expect(await events(alisa.personId, "REACTION")).toHaveLength(0);
    const asked = await discuss.reactToEntry(antonov, { entryId }, "discuss", "Успеем ли выпустить до конца месяца?");
    expect(asked.reactions.map((r) => [r.kind, r.question])).toEqual([["discuss", "Успеем ли выпустить до конца месяца?"]]);
    const questions = await discuss.meetingQuestions(antonov, week, { current: [entryId] }, []);
    expect(questions.map((q) => [q.question, q.entry?.what, q.discussed])).toEqual([["Успеем ли выпустить до конца месяца?", "Сделали новый экран оплаты", false]]);
    // Обсуждено отмечает ведущий, руководитель автора, автор записи или автор вопроса, не любой участник
    await expectRule(discuss.setDiscussed(petrov, questions[0]!.id, true), /обсуждено/);
    expect(await discuss.setDiscussed(reva, questions[0]!.id, true)).toEqual({ discussed: true });
    expect((await discuss.meetingQuestions(antonov, week, { current: [entryId] }, []))[0]!.discussed).toBe(true);
    // Вопрос с прошлой недели виден в повестке, пока его не обсудили
    const nextWeek = addDays(week, 7);
    expect(await discuss.meetingQuestions(antonov, nextWeek, { current: [] }, [])).toHaveLength(0);
    await discuss.setDiscussed(reva, questions[0]!.id, false);
    expect((await discuss.meetingQuestions(antonov, nextWeek, { current: [] }, [])).map((q) => q.week)).toEqual([week]);
    // Сосед из другой ветки этот вопрос не видит
    expect(await discuss.meetingQuestions(await actor("Токов"), nextWeek, { current: [] }, [])).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { action: "weekly.discuss", entityId: entryId } })).toBe(3);
  });

  it("упоминание в самой записи приходит один раз и только тем, кто запись видит", async () => {
    const alisa = await actor("Чемоданова");
    const antonov = await actor("Антонов");
    await prisma.inboxEvent.deleteMany();
    const saved = await weekly.saveEntry(alisa, entryInput(week, "Нужна помощь с дизайн-ревью", { details: "@Антонов Дмитрий, посмотри макеты" }));
    expect(saved.warning).toBeUndefined();
    expect((await events(antonov.personId, "MENTION")).map((e) => e.subject)).toEqual([`entry:${saved.id}`]);
    await weekly.saveEntry(alisa, { ...entryInput(week, "Нужна помощь с дизайн-ревью", { details: "@Антонов Дмитрий, посмотри макеты, пожалуйста" }), id: saved.id });
    expect(await events(antonov.personId, "MENTION")).toHaveLength(1);
    const lost = await weekly.saveEntry(alisa, { ...entryInput(week, "Нужна помощь с дизайн-ревью", { details: "@Антонов Дмитрий и @Фатьянов Евгений" }), id: saved.id });
    expect(lost.warning).toMatch(/Фатьянов Евгений не видит эту запись/);
    expect(await prisma.entryWatch.count({ where: { entryId: saved.id, personId: antonov.personId } })).toBe(1);
    // В «Мне» строка записи со ссылкой
    const inbox = await listInbox(antonov.personId);
    expect(inbox.items.map((i) => [i.entryId, i.entryTitle])).toEqual([[saved.id, "Нужна помощь с дизайн-ревью"]]);
    expect(await markSeen(antonov.personId, [`entry:${saved.id}`])).toBe(1);
    expect((await prisma.inboxEvent.findFirstOrThrow({ where: { recipientId: antonov.personId } })).seenAt).not.toBeNull();
  });

  it("удаление записи с обсуждением отменяется вместе с комментариями, реакциями и подписками", async () => {
    const alisa = await actor("Чемоданова");
    const before = await prisma.weeklyEntry.findUniqueOrThrow({ where: { id: entryId }, include: { comments: true, reactions: true, watches: true } });
    const snapshot = await weekly.deleteEntry(alisa, entryId);
    expect(await prisma.entryComment.count({ where: { entryId } })).toBe(0);
    const token = issueEntryUndoToken(snapshot, alisa.personId);
    const restored = await weekly.restoreEntry(alisa, readEntryUndoToken(token, alisa.personId)!);
    expect(restored.comments!.map((c) => c.id)).toEqual(before.comments.sort((a, b) => a.at.getTime() - b.at.getTime()).map((c) => c.id));
    expect(restored.reactions!.map((r) => r.kind)).toEqual(before.reactions.map((r) => (r.kind === "DISCUSS" ? "discuss" : r.kind.toLowerCase())));
    expect(await prisma.entryWatch.count({ where: { entryId } })).toBe(before.watches.length);
  });
});

describe("письма", () => {
  let sent: Mail[] = [];
  let fail = false;

  beforeAll(async () => {
    process.env.APP_URL = "https://weekly.example.ru";
    await prisma.inboxEvent.deleteMany();
    for (const slug of ["muradyan", "golovkin", "reva", "loginova", "fatyanov"]) {
      await prisma.person.update({ where: { slug }, data: { email: `${slug}@example.ru` } });
    }
    await prisma.person.update({ where: { slug: await slugOf("Антонов") }, data: { email: "antonov@example.ru" } });
    await prisma.person.update({ where: { slug: await slugOf("Чемоданова") }, data: { email: "alisa@example.ru" } });
    await prisma.person.update({ where: { slug: await slugOf("Иванова") }, data: { email: "ivanova@example.ru" } });
  });

  afterEach(() => {
    sent = [];
    fail = false;
  });

  beforeAll(() => {
    setMailTransport(async (mail) => {
      if (fail) throw new Error("SMTP недоступен");
      sent.push(mail);
    });
  });

  afterAll(() => {
    setMailTransport(null);
    delete process.env.APP_URL;
  });

  /** Событие в «Мне» на заданный момент */
  async function event(slug: string, at: Date, extra: { kind?: string; seen?: boolean; done?: boolean; number?: number } = {}) {
    const p = await prisma.person.findUniqueOrThrow({ where: { slug } });
    const reva = await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } });
    const task = extra.number ? await prisma.task.findUniqueOrThrow({ where: { number: extra.number } }) : null;
    return prisma.inboxEvent.create({
      data: {
        recipientId: p.id,
        kind: (extra.kind ?? "TASK_COMMENT") as never,
        actorId: reva.id,
        actorName: reva.fullName,
        subject: task ? `task:${task.number}` : "task:0",
        taskId: task?.id ?? null,
        text: "Комментарий: «секретное содержимое»",
        createdAt: at,
        seenAt: extra.seen ? at : null,
        doneAt: extra.done ? at : null,
      },
    });
  }

  it("письмо о непрочитанном через 15 минут, одно на человека, без содержимого; увиденное и разобранное не уходит", async () => {
    const t = (await svc.createTask(await owner(), { title: "Письма", outcome: "Письма", owner: "loginova", direction: "department", due: future })).task;
    await prisma.inboxEvent.deleteMany();
    const at = msk("2026-10-12T10:00:00");
    await event("loginova", at, { number: t.number });
    await event("loginova", new Date(at.getTime() + 60_000), { number: t.number, kind: "MENTION" });
    await event("golovkin", at, { number: t.number, seen: true });
    await event("fatyanov", at, { number: t.number, done: true });
    await event("cheychenets", at, { number: t.number });
    expect(await letters.eventMailPass(msk("2026-10-12T10:10:00"))).toEqual({ sent: 0, skipped: 0, failed: 0 });
    const result = await letters.eventMailPass(msk("2026-10-12T10:16:00"));
    expect(result.sent).toBe(1);
    expect(sent.map((m) => m.to)).toEqual(["loginova@example.ru"]);
    expect(sent[0]!.subject).toBe(`Weekly: Рева Тарас: упоминание в задаче ${t.number}`);
    expect(sent[0]!.text).toContain(`https://weekly.example.ru/tasks/${t.number}`);
    expect(sent[0]!.text).toContain("(и ещё 1)");
    expect(sent[0]!.text).not.toContain("секретное");
    // Повторно не уходит
    expect((await letters.eventMailPass(msk("2026-10-12T10:30:00"))).sent).toBe(0);
    expect(await prisma.inboxEvent.count({ where: { mailedAt: null } })).toBe(0);
  });

  it("вне рабочих часов события копятся до утренней сводки; сбой отправки возвращает их в очередь", async () => {
    await prisma.inboxEvent.deleteMany();
    await event("golovkin", msk("2026-10-12T21:30:00"));
    expect((await letters.eventMailPass(msk("2026-10-12T22:00:00"))).sent).toBe(0);
    fail = true;
    expect(await letters.eventMailPass(msk("2026-10-13T09:01:00"))).toMatchObject({ sent: 0, failed: 1 });
    expect(await prisma.inboxEvent.count({ where: { mailedAt: null } })).toBe(1);
    fail = false;
    expect((await letters.eventMailPass(msk("2026-10-13T09:02:00"))).sent).toBe(1);
    expect(sent[0]!.text).toContain("Пока вас не было в ресурсе");
  });

  it("настройки писем: выключенный тип не приходит, по общему логину их не поменять", async () => {
    await prisma.inboxEvent.deleteMany();
    const golovkin = { ...(await svc.actorFor("golovkin")), via: "EMAIL" as const };
    await expectRule(letters.saveMailPrefs({ ...golovkin, via: "TEAM" }, { tasks: false }), /личном входе/);
    expect(await letters.saveMailPrefs(golovkin, { tasks: false })).toMatchObject({ tasks: false, mentions: true });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "settings.mail", entityId: "golovkin" }, orderBy: { id: "desc" } })).after).toBe("Задачи: нет");
    await event("golovkin", msk("2026-10-12T10:00:00"));
    await event("golovkin", msk("2026-10-12T10:00:00"), { kind: "MENTION" });
    expect((await letters.eventMailPass(msk("2026-10-12T10:20:00"))).sent).toBe(1);
    expect(sent[0]!.subject).toMatch(/упоминание/);
    await letters.saveMailPrefs(golovkin, {});
  });

  it("напоминания о сдаче: за 6 часов и за час до срока, только тем, от кого ждут и кто не сдал", async () => {
    const now = msk("2026-10-12T12:00:00");
    const key = await weekly.currentReportingKey(now);
    const w = await weekly.ensureWeek(prisma, key);
    expect(w.deadline.toISOString()).toBe(msk("2026-10-12T18:00:00").toISOString());
    const reva = await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } });
    await prisma.weeklyReport.upsert({
      where: { weekId_authorId: { weekId: w.id, authorId: reva.id } },
      update: { state: "SUBMITTED", headline: "Сдал", submittedAt: now },
      create: { weekId: w.id, authorId: reva.id, state: "SUBMITTED", headline: "Сдал", submittedAt: now },
    });
    await prisma.absence.create({ data: { personId: (await prisma.person.findUniqueOrThrow({ where: { slug: "loginova" } })).id, weekId: w.id } });
    await prisma.person.update({ where: { slug: "fatyanov" }, data: { mailPrefs: { reminders: false } } });
    expect((await letters.reminderPass(msk("2026-10-12T11:59:00"))).sent).toBe(0);
    await letters.reminderPass(now);
    // От Антонова ждёт команда Ревы (он руководитель сектора), от Алисы weekly не ждут
    expect(sent.map((m) => m.to).sort()).toEqual(["antonov@example.ru", "golovkin@example.ru", "muradyan@example.ru"]);
    expect(sent[0]!.subject).toMatch(/напоминание о сдаче до понедельник, 12 октября, 18:00/);
    sent = [];
    expect((await letters.reminderPass(msk("2026-10-12T12:30:00"))).sent).toBe(0);
    await letters.reminderPass(msk("2026-10-12T17:00:00"));
    expect(sent.map((m) => m.to).sort()).toEqual(["antonov@example.ru", "golovkin@example.ru", "muradyan@example.ru"]);
    expect(sent[0]!.text).toContain("Остался час");
    sent = [];
    expect((await letters.reminderPass(msk("2026-10-12T17:30:00"))).sent).toBe(0);
    expect((await letters.reminderPass(msk("2026-10-12T18:01:00"))).sent).toBe(0);
    expect(await prisma.mailMark.count({ where: { week: w.start } })).toBe(6);
    await prisma.person.update({ where: { slug: "fatyanov" }, data: { mailPrefs: {} } });
  });

  it("дайджест в день встречи: «Мне», вопросы к встрече, кто не сдал в командах руководителя; один раз", async () => {
    await prisma.inboxEvent.deleteMany();
    const now = msk("2026-10-13T09:05:00");
    expect((await letters.digestPass(msk("2026-10-13T08:55:00"))).sent).toBe(0);
    await letters.digestPass(now);
    const toReva = sent.find((m) => m.to === "reva@example.ru")!;
    expect(toReva.text).toMatch(/Не сдали weekly в ваших командах: (Антонов Дмитрий, Токов Никита|Токов Никита, Антонов Дмитрий)/);
    const toOwner = sent.find((m) => m.to === "muradyan@example.ru")!;
    expect(toOwner.text).toContain("Не сдали weekly в ваших командах");
    expect(toOwner.text).not.toContain("Рева Тарас,");
    // Ивановой сказать нечего: письма нет. У Алисы вопрос к её записи, если запись этой недели
    expect(sent.find((m) => m.to === "ivanova@example.ru")).toBeUndefined();
    const toAlisa = sent.find((m) => m.to === "alisa@example.ru");
    if (toAlisa) expect(toAlisa.text).toMatch(/Вопросов к встрече: 1[\s\S]*weekly\/meeting/);
    sent = [];
    expect((await letters.digestPass(msk("2026-10-13T09:10:00"))).sent).toBe(0);
  });

  it("проход писем идёт под арендой: пока её держит другой процесс, письма не уходят", async () => {
    await prisma.setting.upsert({
      where: { key: "mail.lock" },
      update: { value: { owner: "другой", until: new Date(Date.now() + 60_000).toISOString() } },
      create: { key: "mail.lock", value: { owner: "другой", until: new Date(Date.now() + 60_000).toISOString() } },
    });
    expect(await letters.mailTick(msk("2026-10-12T10:00:00"))).toBeNull();
    await prisma.setting.delete({ where: { key: "mail.lock" } });
    expect(await letters.mailTick(msk("2026-10-12T10:00:00"))).not.toBeNull();
  });
});

describe("сигналы живых обновлений", () => {
  it("база сообщает о событии «Мне» адресату и об изменении задач", async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const got: string[] = [];
    client.on("notification", (m) => got.push(m.payload ?? ""));
    await client.query("LISTEN weekly_live");
    const t = (await svc.createTask(await owner(), { title: "Живое обновление", outcome: "Сигнал", owner: "reva", direction: "department", due: future })).task;
    await svc.changePriority(await owner(), t.number, "high");
    await new Promise((r) => setTimeout(r, 300));
    await client.end();
    const reva = await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } });
    const parsed = got.map((g) => JSON.parse(g) as { t: string; p?: string });
    expect(parsed).toContainEqual({ t: "inbox", p: reva.id });
    expect(parsed).toContainEqual({ t: "tasks" });
    // В сигнале нет содержимого задачи
    expect(got.join(" ")).not.toContain("Живое обновление");
  });
});
