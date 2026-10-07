import { describe, expect, it } from "vitest";
import { findMentionSpans, findMentions, mentionQuery, mentionSuggestions, type MentionPerson } from "@/lib/discuss/mentions";
import { DEFAULT_PREFS, digestDue, inWorkHours, prefOfKind, prefsOf, reminderDue } from "@/lib/letters/schedule";
import { eventPhrase, eventsMail, isTransportDown, plural } from "@/lib/letters/service";
import { parseLive, relevant } from "@/lib/live-message";

const PEOPLE: MentionPerson[] = [
  { id: "reva", fullName: "Рева Тарас", shortName: "Тарас" },
  { id: "fat", fullName: "Фатьянов Евгений", shortName: "Евгений Ф." },
  { id: "che", fullName: "Чейченец Евгений", shortName: "Евгений Ч." },
  { id: "log", fullName: "Логинова Светлана", shortName: "Света" },
  { id: "ivan1", fullName: "Иванов Пётр", shortName: "Пётр" },
  { id: "ivan2", fullName: "Петров Пётр", shortName: "Пётр" },
];

describe("упоминания @имя", () => {
  it("находит полное имя, имя с фамилией и уникальное короткое имя", () => {
    expect(findMentions("Нужна помощь от @Рева Тарас", PEOPLE)).toEqual(["reva"]);
    expect(findMentions("@Тарас Рева, посмотри", PEOPLE)).toEqual(["reva"]);
    expect(findMentions("@Тарас, посмотри", PEOPLE)).toEqual(["reva"]);
    expect(findMentions("@света и @Логинова Светлана", PEOPLE)).toEqual(["log"]);
  });

  it("не путает людей с одинаковым именем и длинное имя с коротким", () => {
    expect(findMentions("@Евгений Ф. и @Евгений Ч.", PEOPLE)).toEqual(["fat", "che"]);
    // «Пётр» у двоих: короткое имя не упоминание, полное работает
    expect(findMentions("@Пётр, привет", PEOPLE)).toEqual([]);
    expect(findMentions("@Петров Пётр, привет", PEOPLE)).toEqual(["ivan2"]);
    expect(findMentions("@Петр Иванов", PEOPLE)).toEqual(["ivan1"]);
  });

  it("требует границу слова и не видит упоминаний в почте", () => {
    expect(findMentions("Спасибо @Тарасу за помощь", PEOPLE)).toEqual([]);
    expect(findMentions("пишите на tarас@Тарас.ru", PEOPLE)).toEqual([]);
    expect(findMentions("без упоминаний", PEOPLE)).toEqual([]);
  });

  it("отдаёт места упоминаний для подсветки", () => {
    const text = "Итог: @Рева Тарас и @Света.";
    const spans = findMentionSpans(text, PEOPLE);
    expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(["@Рева Тарас", "@Света"]);
  });

  it("понимает, что человек набирает упоминание, и подсказывает людей", () => {
    expect(mentionQuery("Привет @Ре", 10)).toEqual({ query: "Ре", start: 7 });
    expect(mentionQuery("почта a@b", 9)).toBeNull();
    expect(mentionQuery("@Рева Тарас\nдальше", 18)).toBeNull();
    expect(mentionSuggestions(PEOPLE, "евг").map((p) => p.id)).toEqual(["fat", "che"]);
    expect(mentionSuggestions(PEOPLE, "тарас").map((p) => p.id)).toEqual(["reva"]);
    expect(mentionSuggestions(PEOPLE, "")).toHaveLength(6);
  });
});

/** Москва: UTC+3 */
const msk = (iso: string) => new Date(`${iso}+03:00`);

describe("расписание писем", () => {
  it("рабочие часы с 9 до 20 по Москве в будни", () => {
    expect(inWorkHours(msk("2026-10-12T09:00:00"))).toBe(true);
    expect(inWorkHours(msk("2026-10-12T08:59:00"))).toBe(false);
    expect(inWorkHours(msk("2026-10-12T19:59:00"))).toBe(true);
    expect(inWorkHours(msk("2026-10-12T20:00:00"))).toBe(false);
    // Суббота
    expect(inWorkHours(msk("2026-10-10T12:00:00"))).toBe(false);
  });

  it("напоминания за 6 часов и за час до срока, не больше двух и не после срока", () => {
    const deadline = msk("2026-10-12T18:00:00");
    const none = { first: null, second: null };
    expect(reminderDue(msk("2026-10-12T11:59:00"), deadline, none)).toBeNull();
    expect(reminderDue(msk("2026-10-12T12:00:00"), deadline, none)).toBe(1);
    const first = { first: msk("2026-10-12T12:00:00"), second: null };
    expect(reminderDue(msk("2026-10-12T16:30:00"), deadline, first)).toBeNull();
    expect(reminderDue(msk("2026-10-12T17:00:00"), deadline, first)).toBe(2);
    expect(reminderDue(msk("2026-10-12T17:30:00"), deadline, { first: first.first, second: msk("2026-10-12T17:00:00") })).toBeNull();
    expect(reminderDue(msk("2026-10-12T18:00:00"), deadline, none)).toBeNull();
  });

  it("при раннем сроке приходит одно напоминание с начала рабочего дня", () => {
    const deadline = msk("2026-10-12T10:00:00");
    expect(reminderDue(msk("2026-10-12T08:30:00"), deadline, { first: null, second: null })).toBeNull();
    expect(reminderDue(msk("2026-10-12T09:01:00"), deadline, { first: null, second: null })).toBe(1);
    // Второе было бы в 9:00, но первое ушло в 9:01: меньше часа, не шлём
    expect(reminderDue(msk("2026-10-12T09:30:00"), deadline, { first: msk("2026-10-12T09:01:00"), second: null })).toBeNull();
  });

  it("дайджест в день встречи с 9 до 12", () => {
    const day = { year: 2026, month: 10, day: 13 };
    expect(digestDue(msk("2026-10-13T08:59:00"), day)).toBe(false);
    expect(digestDue(msk("2026-10-13T09:00:00"), day)).toBe(true);
    expect(digestDue(msk("2026-10-13T12:00:00"), day)).toBe(false);
    expect(digestDue(msk("2026-10-12T09:30:00"), day)).toBe(false);
  });

  it("настройки писем: по умолчанию всё, мусор не ломает", () => {
    expect(prefsOf(null)).toEqual(DEFAULT_PREFS);
    expect(prefsOf({ reactions: false, digest: "нет", extra: true })).toEqual({ ...DEFAULT_PREFS, reactions: false });
    expect(prefOfKind("MENTION")).toBe("mentions");
    expect(prefOfKind("ENTRY_COMMENT")).toBe("mentions");
    expect(prefOfKind("REACTION")).toBe("reactions");
    expect(prefOfKind("UPDATE_REQUEST")).toBe("tasks");
  });
});

describe("тексты писем", () => {
  it("в строке только кто и что, без содержимого", () => {
    expect(eventPhrase({ kind: "MENTION", actorName: "Рева Тарас", taskNumber: 47, entryId: null, commentId: "c" })).toBe("Рева Тарас: упоминание в задаче 47");
    expect(eventPhrase({ kind: "REACTION", actorName: "Мурадян Арам", taskNumber: null, entryId: "e", commentId: null })).toBe("Мурадян Арам: реакция на вашу запись weekly");
    expect(eventPhrase({ kind: "TASK_WATCH", actorName: "Bord", taskNumber: 3, entryId: null, commentId: null })).toBe("Bord: изменения в задаче 3, за которой вы следите");
    // Просьбы (этап 21): строка без текста просьбы, ссылка на страницу просьбы
    expect(eventPhrase({ kind: "REQUEST", actorName: "Рева Тарас", taskNumber: null, entryId: null, commentId: null, requestNumber: 4 })).toBe("Рева Тарас: просьба к вам");
    expect(eventPhrase({ kind: "REQUEST_ANSWER", actorName: "Логинова Светлана", taskNumber: null, entryId: null, commentId: null, requestNumber: 4 })).toBe("Логинова Светлана: изменения по просьбе");
    const mail = eventsMail({ shortName: "Тарас" }, [{ kind: "REQUEST_ANSWER", actorName: "Логинова Светлана", taskNumber: null, entryId: null, commentId: null, requestNumber: 4, subject: "request:4", createdAt: new Date("2026-10-12T08:00:00Z") }]);
    expect(mail.text).toContain("/requests/4");
    expect(prefOfKind("REQUEST")).toBe("tasks");
    expect(prefOfKind("REQUEST_ANSWER")).toBe("tasks");
  });

  it("склеивает события одного предмета и отмечает ночные как сводку", () => {
    const at = msk("2026-10-12T22:00:00");
    const mail = eventsMail({ shortName: "Света" }, [
      { kind: "TASK_COMMENT", actorName: "Рева Тарас", taskNumber: 47, entryId: null, commentId: "1", subject: "task:47", createdAt: at },
      { kind: "TASK_COMMENT", actorName: "Рева Тарас", taskNumber: 47, entryId: null, commentId: "2", subject: "task:47", createdAt: new Date(at.getTime() + 60_000) },
      { kind: "MENTION", actorName: "Мурадян Арам", taskNumber: null, entryId: "e1", commentId: null, subject: "entry:e1", createdAt: at },
    ]);
    expect(mail.subject).toBe("Weekly: 2 события ждут вас");
    expect(mail.text).toContain("Пока вас не было в ресурсе");
    expect(mail.text).toContain("Рева Тарас: комментарий в задаче 47 (и ещё 1)");
    expect(mail.text).toContain("/weekly/entry/e1");
    expect(mail.text).toContain("Здравствуйте, Света.");
  });

  it("склоняет «событие»", () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, ["событие", "события", "событий"]))).toEqual(["событие", "события", "событий", "событий", "событие", "события", "событий"]);
  });
});

describe("сообщения живых обновлений", () => {
  it("пропускает только известные виды", () => {
    expect(parseLive('{"t":"inbox","p":"x"}')).toEqual({ t: "inbox", p: "x" });
    expect(parseLive('{"t":"tasks"}')).toEqual({ t: "tasks" });
    expect(parseLive('{"t":"inbox"}')).toBeNull();
    expect(parseLive("мусор")).toBeNull();
    expect(parseLive(undefined)).toBeNull();
  });
});

describe("какие экраны обновлять", () => {
  it("по виду изменения и не на экране сдачи", () => {
    expect(relevant("tasks", "/tasks/board")).toBe(true);
    expect(relevant("tasks", "/weekly")).toBe(false);
    expect(relevant("weekly", "/weekly/entry/abc")).toBe(true);
    expect(relevant("weekly", "/weekly/submit")).toBe(false);
    expect(relevant("inbox", "/me")).toBe(true);
    expect(relevant("inbox", "/tasks")).toBe(false);
    expect(relevant("weekly", "/")).toBe(true);
  });
});

describe("сбой почты", () => {
  it("отклонённый адрес не повторяем, недоступный сервер повторяем", () => {
    expect(isTransportDown(Object.assign(new Error("x"), { code: "EENVELOPE" }))).toBe(false);
    expect(isTransportDown(Object.assign(new Error("x"), { code: "EMESSAGE", responseCode: 550 }))).toBe(false);
    expect(isTransportDown(Object.assign(new Error("x"), { code: "ECONNECTION" }))).toBe(true);
    expect(isTransportDown(Object.assign(new Error("x"), { code: "EAUTH", responseCode: 535 }))).toBe(true);
    expect(isTransportDown(new Error("нет связи"))).toBe(true);
  });
});
