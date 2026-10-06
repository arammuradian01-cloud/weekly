// «Мне» на настоящей базе (этап 11): кто получает события, склейка по задаче, «Разобрано», «Напомнить».
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as inbox from "@/lib/inbox/service";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";

const future = addDays(moscowToday(), 10);
const actor = {
  owner: () => tasks.actorFor("muradyan", "OWNER"),
  admin: () => tasks.actorFor("golovkin", "ADMIN"),
  reva: () => tasks.actorFor("reva"),
  loginova: () => tasks.actorFor("loginova"),
  fatyanov: () => tasks.actorFor("fatyanov"),
};
const id = async (slug: string) => (await prisma.person.findUniqueOrThrow({ where: { slug } })).id;
const items = async (slug: string, now = new Date()) => (await inbox.listInbox(await id(slug), now)).items;

beforeEach(async () => {
  await prisma.task.deleteMany();
  await prisma.inboxEvent.deleteMany();
  await prisma.person.updateMany({ where: { slug: { notIn: ["analyst", "ceo"] } }, data: { active: true } });
});
afterAll(() => prisma.$disconnect());

describe("кто получает события", () => {
  it("владелец ставит задачу: ответственному «Новая задача», соисполнителю «Вы соисполнитель», себе ничего", async () => {
    const { task } = await tasks.createTask(await actor.owner(), { title: "Отчёт по КАСКО", outcome: "Отчёт", owner: "reva", coExecutors: ["fatyanov"], direction: "kasko", due: future });
    expect((await items("reva")).map((i) => [i.taskNumber, i.text, i.actorName])).toEqual([[task.number, "Новая задача для вас", "Мурадян Арам"]]);
    expect((await items("fatyanov")).map((i) => i.text)).toEqual(["Вы соисполнитель"]);
    expect(await items("muradyan")).toEqual([]);

    // Себе задачу ставят без события
    await tasks.createTask(await actor.reva(), { title: "Себе", outcome: "Готово", owner: "reva", direction: "product", due: future });
    expect(await items("reva")).toHaveLength(1);
  });

  it("предложение коллеге: ему «Вам предложена задача», после подтверждения обоим «Задача подтверждена»", async () => {
    const { task } = await tasks.createTask(await actor.reva(), { title: "Логиновой", outcome: "Готово", owner: "loginova", direction: "red", due: future });
    expect((await items("loginova")).map((i) => i.text)).toEqual(["Вам предложена задача, её подтвердит владелец или администратор"]);
    await tasks.changeStatus(await actor.admin(), task.number, "in-progress");
    expect((await items("loginova"))[0]).toMatchObject({ text: "Задача подтверждена", count: 2, actorName: "Головкин Владислав" });
    expect((await items("reva")).map((i) => i.text)).toEqual(["Задача подтверждена"]);
  });

  it("комментарий видят ответственный, соисполнители и автор задачи, но не тот, кто написал", async () => {
    const { task } = await tasks.createTask(await actor.owner(), { title: "Общая", outcome: "Готово", owner: "reva", coExecutors: ["fatyanov"], direction: "product", due: future });
    await prisma.inboxEvent.deleteMany();
    // Пробелы и переносы схлопываются, длинный текст обрезается до 120 знаков
    await tasks.addComment(await actor.fatyanov(), task.number, "Посмотрите   расчёт,\n там важное исправление");
    expect((await items("reva")).map((i) => i.text)).toEqual(["Комментарий: «Посмотрите расчёт, там важное исправление»"]);
    await tasks.addComment(await actor.fatyanov(), task.number, "а".repeat(300));
    expect((await items("reva"))[0]!.text).toBe(`Комментарий: «${"а".repeat(119)}…»`);
    expect((await items("muradyan")).map((i) => i.actorName)).toEqual(["Фатьянов Евгений"]);
    expect(await items("fatyanov")).toEqual([]);
  });

  it("передача задачи, новый соисполнитель и перенос срока чужими руками", async () => {
    const { task } = await tasks.createTask(await actor.owner(), { title: "Передача", outcome: "Готово", owner: "reva", direction: "product", due: future });
    await tasks.assignOwner(await actor.admin(), task.number, "loginova");
    expect((await items("loginova")).map((i) => i.text)).toEqual(["Задача передана вам"]);
    await tasks.setCoExecutors(await actor.admin(), task.number, ["fatyanov"]);
    expect((await items("fatyanov")).map((i) => i.text)).toEqual(["Вы соисполнитель"]);
    await tasks.transferDue(await actor.admin(), task.number, addDays(future, 7), "Ждём данные от СК");
    expect((await items("loginova"))[0]).toMatchObject({ count: 2 });
    expect((await items("loginova"))[0]!.text).toMatch(/^Срок перенесён на \d+ [а-я]+: Ждём данные от СК$/);
    // Свой перенос себе не сообщается
    await prisma.inboxEvent.deleteMany();
    await tasks.transferDue(await actor.loginova(), task.number, addDays(future, 8), "Сама переношу");
    expect(await items("loginova")).toEqual([]);
  });

  it("выключенный человек событий не получает, отменённый комментарий убирает событие", async () => {
    const { task } = await tasks.createTask(await actor.owner(), { title: "Выключенный", outcome: "Готово", owner: "reva", coExecutors: ["afanasyev"], direction: "product", due: future });
    await prisma.inboxEvent.deleteMany();
    await prisma.person.update({ where: { slug: "afanasyev" }, data: { active: false } });
    const r = await tasks.addComment(await actor.owner(), task.number, "Комментарий, который отменят");
    expect(await items("afanasyev")).toEqual([]);
    expect(await items("reva")).toHaveLength(1);
    await tasks.undoChange(await actor.owner(), r.undo!);
    expect(await items("reva")).toEqual([]);
  });
});

describe("разбор", () => {
  it("события одной задачи склеены, «Разобрано» убирает строку, новое событие возвращает её", async () => {
    const { task } = await tasks.createTask(await actor.owner(), { title: "Склейка", outcome: "Готово", owner: "reva", direction: "product", due: future });
    await tasks.addComment(await actor.owner(), task.number, "Первый");
    await tasks.addComment(await actor.owner(), task.number, "Второй");
    const reva = await actor.reva();
    expect(await items("reva")).toMatchObject([{ taskNumber: task.number, text: "Комментарий: «Второй»", count: 3 }]);
    expect(await inbox.inboxCount(reva.personId)).toBe(1);

    expect(await inbox.markDone(reva, inbox.taskSubject(task.number))).toBe(3);
    expect(await items("reva")).toEqual([]);
    await expect(inbox.markDone(reva, inbox.taskSubject(task.number))).rejects.toThrow(/уже разобрано/);

    await tasks.addComment(await actor.owner(), task.number, "Третий");
    expect(await items("reva")).toMatchObject([{ text: "Комментарий: «Третий»", count: 1 }]);
    // Разобрать можно только своё
    await expect(inbox.markDone(await actor.fatyanov(), inbox.taskSubject(task.number))).rejects.toThrow(/уже разобрано/);
  });

  it("«Напомнить» прячет до утра, утром строка возвращается; новое событие возвращает её сразу", async () => {
    // Вторник 06.10.2026, 15:00 по Москве
    const now = new Date("2026-10-06T12:00:00Z");
    expect(inbox.snoozeMoment("tomorrow", now).toISOString()).toBe("2026-10-07T06:00:00.000Z");
    expect(inbox.snoozeMoment("monday", now).toISOString()).toBe("2026-10-12T06:00:00.000Z");
    // В понедельник «в понедельник» значит следующий
    expect(inbox.snoozeMoment("monday", new Date("2026-10-12T05:00:00Z")).toISOString()).toBe("2026-10-19T06:00:00.000Z");

    const { task } = await tasks.createTask(await actor.owner(), { title: "Отложить", outcome: "Готово", owner: "reva", direction: "product", due: future });
    const reva = await actor.reva();
    const subject = inbox.taskSubject(task.number);
    const t = new Date();
    await inbox.snooze(reva, subject, "tomorrow", t);
    expect((await inbox.listInbox(reva.personId, t)).items).toEqual([]);
    expect((await inbox.listInbox(reva.personId, t)).snoozed).toBe(1);
    expect(await inbox.inboxCount(reva.personId, t)).toBe(0);
    const morning = inbox.snoozeMoment("tomorrow", t);
    expect(await items("reva", new Date(morning.getTime() + 1000))).toHaveLength(1);

    await tasks.addComment(await actor.owner(), task.number, "Срочно");
    expect((await inbox.listInbox(reva.personId, new Date())).items).toMatchObject([{ text: "Комментарий: «Срочно»", count: 1 }]);
  });

  it("«Разобрать всё» закрывает все строки человека и не трогает чужие", async () => {
    const a = await tasks.createTask(await actor.owner(), { title: "Раз", outcome: "Готово", owner: "reva", coExecutors: ["fatyanov"], direction: "product", due: future });
    await tasks.createTask(await actor.owner(), { title: "Два", outcome: "Готово", owner: "reva", direction: "product", due: future });
    expect(await items("reva")).toHaveLength(2);
    expect(await inbox.markAllDone(await actor.reva())).toBe(2);
    expect(await items("reva")).toEqual([]);
    expect((await items("fatyanov")).map((i) => i.taskNumber)).toEqual([a.task.number]);
  });
});
