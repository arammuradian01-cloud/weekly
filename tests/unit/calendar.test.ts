import { describe, expect, it } from "vitest";
import { buildIcs, escapeText, foldLine, icsMoment } from "@/lib/calendar/ics";
import { feedEvents, meetingTeams, personTag, type FeedInput, type FeedNode } from "@/lib/calendar/rules";
import { DEFAULT_RHYTHM } from "@/lib/org/rhythm";

// Календарь сроков (этап 29): формат файла и какие события в него попадают

const node = (id: string, name: string, leaderId: string | null, members: string[], rhythm = DEFAULT_RHYTHM, active = true): FeedNode => ({ id, name, leaderId, members, active, rhythm });
const nodes = [
  node("top", "Топ-команда", "aram", ["reva", "loginova"]),
  node("cpo", "Развитие продуктов", "reva", ["antonov"], { deadline: null, meeting: { week: 1, weekday: 3, time: "11:30" }, specialists: false }),
  node("solo", "Один в поле", "loginova", []),
];
const week = (key: string, absent = false) => ({
  key,
  deadline: new Date(`${key}T15:00:00Z`),
  meetingDate: key,
  absent,
  meetings: new Map<string, string>(),
});
/** Ключ события с отпечатком человека */
const u = (kind: string, person = "reva") => `${kind}-${personTag(person)}@weekly`;
const input = (over: Partial<FeedInput> = {}): FeedInput => ({
  personId: "reva",
  withTitles: false,
  base: "https://weekly.example/",
  tasks: [{ id: "t1", number: 412, title: "Запуск ОСАГО, секретный партнёр", due: "2026-10-31" }],
  weeks: [{ ...week("2026-10-05"), deadline: new Date("2026-10-12T15:00:00Z"), meetingDate: "2026-10-13" }],
  nodes,
  oneOnOnes: [{ id: "m1", pairId: "pair-1", date: "2026-10-15", otherName: "Антонов Дмитрий" }],
  ...over,
});

describe("формат файла календаря", () => {
  it("экранирует запятую, точку с запятой, обратную косую черту и перенос строки", () => {
    expect(escapeText("а,б;в\\г\nд")).toBe("а\\,б\\;в\\\\г\\nд");
  });

  it("управляющие символы из текста убираются: из-за них календарь отбросил бы весь файл", () => {
    expect(escapeText("Задача\u000bс\u0000мусором\tи табуляцией")).toBe("Задачасмусором\tи табуляцией");
  });

  it("перенос не режет смайлик из четырёх байт", () => {
    const line = `SUMMARY:${"Запуск 🚀 ".repeat(12)}`;
    const parts = foldLine(line).split("\r\n");
    for (const p of parts) expect(Buffer.byteLength(p, "utf8")).toBeLessThanOrEqual(75);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(line);
  });

  it("длинная строка переносится не длиннее 75 байт, русские буквы не разрезаются", () => {
    const line = `SUMMARY:${"Срок задачи про очень длинное название ".repeat(5)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) expect(Buffer.byteLength(p, "utf8")).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((p) => p.startsWith(" "))).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(line);
    expect(folded).not.toContain("�");
  });

  it("файл: строки через CRLF, событие на весь день кончается на следующий день, через границу месяца", () => {
    const ics = buildIcs([{ uid: u("task-1"), summary: "Срок задачи №1", date: "2026-10-31" }], { name: "Сроки weekly", stamp: new Date("2026-10-08T10:00:00Z") });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261031\r\nDTEND;VALUE=DATE:20261101");
    expect(ics).toContain("DTSTAMP:20261008T100000Z");
    expect(ics).toContain("TRANSP:TRANSPARENT");
    expect(icsMoment(new Date("2026-10-12T15:00:00.123Z"))).toBe("20261012T150000Z");
  });
});

describe("события календаря", () => {
  it("по умолчанию без названий задач и имён: только номер, слово «срок» и ссылка", () => {
    const events = feedEvents(input());
    const text = JSON.stringify(events);
    expect(text).not.toContain("ОСАГО");
    expect(text).not.toContain("Антонов");
    expect(text).not.toContain("Развитие продуктов");
    const task = events.find((e) => e.uid === u("task-t1"))!;
    expect(task.summary).toBe("Срок задачи №412");
    expect(task.url).toBe("https://weekly.example/tasks/412");
    expect(task.date).toBe("2026-10-31");
    // Встреча один на один по ссылке с ключом пары, без короткого имени человека в адресе
    const oo = events.find((e) => e.uid === u("one-on-one-m1"))!;
    expect(oo.summary).toBe("Встреча один на один");
    expect(oo.url).toBe("https://weekly.example/one-on-one?pair=pair-1");
  });

  it("с названиями: название задачи, имя собеседника и название команды", () => {
    const events = feedEvents(input({ withTitles: true }));
    expect(events.find((e) => e.uid === u("task-t1"))!.summary).toBe("№412 Запуск ОСАГО, секретный партнёр");
    expect(events.find((e) => e.uid === u("one-on-one-m1"))!.summary).toBe("Один на один: Антонов Дмитрий");
    expect(events.some((e) => e.summary === "Встреча команды «Развитие продуктов», неделя 41")).toBe(true);
  });

  it("срок weekly: когда от человека ждут weekly и он не в отпуске; встречи: топ-команда на весь день, команда со временем по Москве", () => {
    const events = feedEvents(input());
    const deadline = events.find((e) => e.uid === u("weekly-2026-10-05"))!;
    expect(deadline.summary).toBe("Срок weekly, неделя 41");
    expect(deadline.start?.toISOString()).toBe("2026-10-12T15:00:00.000Z");
    const top = events.find((e) => e.uid === u("meeting-top-2026-10-05"))!;
    // Без названий топ-команда тоже просто «команда»
    expect(top.summary).toBe("Встреча команды, неделя 41");
    expect(top.date).toBe("2026-10-13");
    // Своя команда Ревы: среда следующей недели в 11:30 по Москве
    const own = events.find((e) => e.uid === u("meeting-cpo-2026-10-05"))!;
    expect(own.start?.toISOString()).toBe("2026-10-14T08:30:00.000Z");
    expect(own.minutes).toBe(60);

    const away = feedEvents(input({ weeks: [{ ...week("2026-10-05", true), deadline: new Date("2026-10-12T15:00:00Z"), meetingDate: "2026-10-13" }] }));
    expect(away.some((e) => e.uid.startsWith("weekly-"))).toBe(false);
    // Специалист без weekly: срока weekly нет, встреча своей команды есть
    const antonov = feedEvents(input({ personId: "antonov", oneOnOnes: [], tasks: [] }));
    expect(antonov.some((e) => e.uid.startsWith("weekly-"))).toBe(false);
    expect(antonov.map((e) => e.uid)).toEqual([u("meeting-cpo-2026-10-05", "antonov")]);
  });

  it("встреча уже создана с другой датой: в календаре её дата; команда из одного человека в календарь не попадает", () => {
    const w = { ...week("2026-10-05"), meetingDate: "2026-10-13", meetings: new Map([["top", "2026-10-16"]]) };
    expect(feedEvents(input({ weeks: [w] })).find((e) => e.uid === u("meeting-top-2026-10-05"))!.date).toBe("2026-10-16");
    expect(meetingTeams("loginova", nodes).map((n) => n.id)).toEqual(["top"]);
    expect(meetingTeams("aram", [...nodes, node("off", "Выключенная", "aram", ["x"], DEFAULT_RHYTHM, false)]).map((n) => n.id)).toEqual(["top"]);
  });

  it("ключи событий у разных людей разные, у одного человека постоянные", () => {
    expect(personTag("reva")).toMatch(/^[0-9a-f]{10}$/);
    expect(personTag("reva")).toBe(personTag("reva"));
    expect(personTag("reva")).not.toBe(personTag("antonov"));
    expect(personTag("reva")).not.toContain("reva");
  });

  it("события идут по времени, адрес ресурса без лишней косой черты", () => {
    const events = feedEvents(input());
    expect(events.every((e) => !e.url?.includes("example//"))).toBe(true);
    const order = events.map((e) => e.uid);
    expect(order.indexOf(u("weekly-2026-10-05"))).toBeLessThan(order.indexOf(u("one-on-one-m1")));
    expect(order.at(-1)).toBe(u("task-t1"));
  });
});
