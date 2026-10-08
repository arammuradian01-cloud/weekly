import { describe, expect, it } from "vitest";
import { cleanText, cleanTopic, linkBetween, nextMeetingDate, pairIdOfSubject, pairLinks, pairSubject, personalLogin } from "@/lib/one-on-one/rules";
import { eventPhrase, pathOf } from "@/lib/letters/phrases";
import { pushPayload } from "@/lib/push/rules";

// Встречи один на один (этап 28): кто с кем встречается, приватность входа, даты и тексты

const node = (id: string, leaderId: string | null, members: string[], active = true) => ({ id, leaderId, members, active });
const nodes = [
  node("top", "aram", ["reva", "loginova", "golovkin"]),
  node("cpo", "reva", ["antonov", "tokov"]),
  node("sector", "antonov", ["alisa", "petrov", "antonov"]),
  node("old", "gone", ["reva"], false),
  node("noleader", null, ["ivanova"]),
];

describe("кто с кем встречается", () => {
  it("руководитель команды с каждым её участником, участник со своим руководителем", () => {
    const keys = (id: string) => pairLinks(nodes, id).map((l) => `${l.managerId}>${l.reportId}@${l.teamId}`).sort();
    expect(keys("aram")).toEqual(["aram>golovkin@top", "aram>loginova@top", "aram>reva@top"]);
    // Рева встречается и с Арамом, и со своими руководителями отделов
    expect(keys("reva")).toEqual(["aram>reva@top", "reva>antonov@cpo", "reva>tokov@cpo"]);
    // Руководитель в списке участников своей же команды сам с собой не встречается
    expect(keys("antonov")).toEqual(["antonov>alisa@sector", "antonov>petrov@sector", "reva>antonov@cpo"]);
    // Выключенная команда и команда без руководителя пар не дают
    expect(keys("ivanova")).toEqual([]);
  });

  it("связь двух людей в любом порядке; не в одной команде: нет", () => {
    expect(linkBetween(nodes, "reva", "aram")).toEqual({ managerId: "aram", reportId: "reva", teamId: "top" });
    expect(linkBetween(nodes, "alisa", "antonov")).toMatchObject({ managerId: "antonov", reportId: "alisa" });
    // Коллеги по топ-команде и человек через уровень: не пара
    expect(linkBetween(nodes, "reva", "loginova")).toBeNull();
    expect(linkBetween(nodes, "aram", "antonov")).toBeNull();
    expect(linkBetween(nodes, "reva", "reva")).toBeNull();
  });
});

describe("личный вход", () => {
  it("общий логин team и неизвестный способ входа встречи не открывают", () => {
    expect(personalLogin("PASSWORD")).toBe(true);
    expect(personalLogin("EMAIL")).toBe(true);
    expect(personalLogin("INVITE")).toBe(true);
    expect(personalLogin("TEAM")).toBe(false);
    expect(personalLogin(null)).toBe(false);
    expect(personalLogin(undefined)).toBe(false);
  });
});

describe("даты и тексты", () => {
  it("следующая встреча через неделю, но не раньше завтра", () => {
    expect(nextMeetingDate("2026-10-08", "2026-10-08")).toBe("2026-10-15");
    // Встречу провели с опозданием: через неделю от неё уже прошло, берём завтра
    expect(nextMeetingDate("2026-09-20", "2026-10-08")).toBe("2026-10-09");
  });

  it("тема одной строкой без длинного тире, итог с переносами строк", () => {
    expect(cleanTopic("  Бюджет —  на   ноябрь → обсудить ")).toBe("Бюджет - на ноябрь - обсудить");
    expect(cleanTopic("т".repeat(600))).toHaveLength(500);
    expect(cleanTopic(undefined)).toBe("");
    expect(cleanText("Первое\r\nВторое — ок\n", 2000)).toBe("Первое\nВторое - ок");
  });

  it("предмет события «Мне» и ссылка ведут на страницу пары", () => {
    expect(pairSubject("p1")).toBe("1on1:p1");
    expect(pairIdOfSubject("1on1:p1")).toBe("p1");
    expect(pairIdOfSubject("task:47")).toBeNull();
    expect(pathOf({ taskNumber: null, entryId: null, subject: "1on1:p1" })).toBe("/one-on-one?pair=p1");
    expect(eventPhrase({ kind: "ONE_ON_ONE", actorName: "Рева Тарас", taskNumber: null, entryId: null, commentId: null })).toBe("Рева Тарас: встреча один на один");
    const p = pushPayload([{ kind: "ONE_ON_ONE", actorName: "Рева Тарас", taskNumber: null, entryId: null, commentId: null, subject: "1on1:p1", createdAt: new Date() }]);
    // В уведомлении только кто и что, без текста темы
    expect(p).toEqual({ title: "Weekly", body: "Рева Тарас: встреча один на один", url: "/one-on-one?pair=p1", tag: "1on1:p1" });
  });
});
