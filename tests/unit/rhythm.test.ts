// Этап 15: ритм weekly команд. Срок команды, кто сдаёт weekly, срок человека, закрытие недели командой, кого можно поднять наверх
import { describe, expect, it } from "vitest";
import { closedFor, expectedOf, isSlot, leadersOf, personDeadline, promotableFrom, slotMoment, slotText, teamDeadline, teamMeeting, type RhythmNode } from "@/lib/org/rhythm";

const W41 = "2026-10-05";
// Срок департамента: понедельник следующей недели 18:00 по Москве
const DEPARTMENT = new Date("2026-10-12T15:00:00Z");

const node = (id: string, leaderId: string | null, members: string[], rhythm: Partial<RhythmNode["rhythm"]> = {}): RhythmNode => ({
  id,
  leaderId,
  members,
  active: true,
  rhythm: { deadline: null, meeting: null, specialists: false, ...rhythm },
});

// Топ-команда Арама, команда Тараса, сектор Антонова со специалистом Алисой
const nodes = [
  node("top", "aram", ["vlad", "taras"]),
  node("taras-team", "taras", ["antonov", "tokov"]),
  node("sector", "antonov", ["alisa"], { deadline: { week: 0, weekday: 5, time: "16:00" } }),
  node("analytics", "tokov", ["ivanova"]),
];

describe("ритм команды", () => {
  it("момент слота: отчётная неделя или следующая, время по Москве", () => {
    expect(slotMoment(W41, { week: 0, weekday: 5, time: "16:00" }).toISOString()).toBe("2026-10-09T13:00:00.000Z");
    expect(slotMoment(W41, { week: 1, weekday: 1, time: "11:00" }).toISOString()).toBe("2026-10-12T08:00:00.000Z");
    expect(slotText({ week: 1, weekday: 1, time: "11:00" })).toBe("понедельник следующей недели, 11:00");
    expect(isSlot({ week: 2, weekday: 1, time: "11:00" })).toBe(false);
    expect(isSlot({ week: 0, weekday: 8, time: "11:00" })).toBe(false);
    expect(isSlot({ week: 0, weekday: 3, time: "25:00" })).toBe(false);
  });

  it("срок команды не позже срока департамента, у топ-команды срок департамента", () => {
    expect(teamDeadline(W41, nodes[2]!, DEPARTMENT).toISOString()).toBe("2026-10-09T13:00:00.000Z");
    expect(teamDeadline(W41, nodes[1]!, DEPARTMENT)).toEqual(DEPARTMENT);
    const late = node("late", "x", [], { deadline: { week: 1, weekday: 3, time: "12:00" } });
    expect(teamDeadline(W41, late, DEPARTMENT)).toEqual(DEPARTMENT);
    const top = node("top", "aram", [], { deadline: { week: 0, weekday: 1, time: "09:00" } });
    expect(teamDeadline(W41, top, DEPARTMENT)).toEqual(DEPARTMENT);
    expect(teamMeeting(W41, node("m", "x", [], { meeting: { week: 1, weekday: 1, time: "11:00" } }), "2026-10-13")).toEqual({ date: "2026-10-12", time: "11:00" });
    expect(teamMeeting(W41, nodes[1]!, "2026-10-13")).toEqual({ date: "2026-10-13", time: null });
  });
});

describe("кто сдаёт weekly", () => {
  const leaders = leadersOf(nodes);

  it("в топ-команде все, в остальных руководители команд, специалисты по выбору руководителя", () => {
    expect(expectedOf(nodes[0]!, leaders).sort()).toEqual(["aram", "taras", "vlad"]);
    expect(expectedOf(nodes[1]!, leaders).sort()).toEqual(["antonov", "tokov"]);
    expect(expectedOf(nodes[2]!, leaders)).toEqual([]);
    expect(expectedOf({ ...nodes[2]!, rhythm: { ...nodes[2]!.rhythm, specialists: true } }, leaders)).toEqual(["alisa"]);
  });

  it("срок человека: самый ранний из сроков команд, где от него ждут weekly", () => {
    const withAlisa = nodes.map((n) => (n.id === "sector" ? { ...n, rhythm: { ...n.rhythm, specialists: true } } : n));
    expect(personDeadline("alisa", W41, withAlisa, DEPARTMENT).toISOString()).toBe("2026-10-09T13:00:00.000Z");
    // Антонов руководит сектором, а свой weekly сдаёт в команду Тараса: срок департамента
    expect(personDeadline("antonov", W41, withAlisa, DEPARTMENT)).toEqual(DEPARTMENT);
    expect(personDeadline("nobody", W41, withAlisa, DEPARTMENT)).toEqual(DEPARTMENT);
  });

  it("неделя закрыта для человека, когда её закрыли все команды, которые ждут его weekly", () => {
    const leaders = leadersOf(nodes);
    expect(closedFor("alisa", nodes, false, new Set(["sector"]), leaders)).toBe(true);
    expect(closedFor("alisa", nodes, false, new Set(), leaders)).toBe(false);
    // Тарас сдаёт в топ-команду: её неделю закрывает только администратор
    expect(closedFor("taras", nodes, false, new Set(["taras-team"]), leaders)).toBe(false);
    expect(closedFor("taras", nodes, true, new Set(), leaders)).toBe(true);
    expect(closedFor("antonov", nodes, false, new Set(["sector"]), leaders)).toBe(false);
    expect(closedFor("antonov", nodes, false, new Set(["taras-team"]), leaders)).toBe(true);
  });

  it("поднять наверх можно записи участников своих команд, кроме топ-команды", () => {
    expect([...promotableFrom("antonov", nodes)]).toEqual(["alisa"]);
    expect([...promotableFrom("taras", nodes)].sort()).toEqual(["antonov", "tokov"]);
    expect([...promotableFrom("aram", nodes)]).toEqual([]);
  });
});
