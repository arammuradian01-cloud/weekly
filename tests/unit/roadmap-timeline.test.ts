import { describe, expect, it } from "vitest";
import { barOf, canMoveBar, dayAtX, dragSpan, handleInside, HANDLE_PX, spanPlan, startOf, timelineRange } from "@/lib/tasks/timeline";
import type { Task } from "@/domain/types";
import { diffDays } from "@/domain/dates";

const task = (over: Partial<Task>): Task => ({ number: 1, due: "2026-10-25", createdAt: "2026-10-10", status: "in-progress", priority: "medium", ...over }) as Task;

describe("timelineRange", () => {
  it("четыре месяца с первого числа текущего", () => {
    const r = timelineRange("2026-10-22");
    expect(r.start).toBe("2026-10-01");
    expect(r.months.map((m) => m.label)).toEqual(["Октябрь", "Ноябрь", "Декабрь", "Январь 2027"]);
    expect(r.days).toBe(31 + 30 + 31 + 31);
    expect(r.end).toBe("2027-01-31");
  });
});

describe("startOf", () => {
  it("своё начало или дата постановки", () => {
    expect(startOf(task({ start: "2026-10-12" }))).toEqual({ date: "2026-10-12", known: true });
    expect(startOf(task({}))).toEqual({ date: "2026-10-10", known: false });
  });
  it("начало позже срока прижимается к сроку", () => {
    expect(startOf(task({ createdAt: "2026-11-01" })).date).toBe("2026-10-25");
  });
});

describe("barOf", () => {
  const r = timelineRange("2026-10-22");
  it("положение и обрезка", () => {
    const b = barOf(task({ start: "2026-09-20", due: "2026-10-05" }), r, "2026-10-22");
    expect(b.from).toBe(0);
    expect(b.cutStart).toBe(true);
    expect(b.to).toBe(4);
    expect(b.overdue).toBe(true);
    expect(b.outside).toBeNull();
  });
  it("предложенная задача не просрочена", () => {
    expect(barOf(task({ due: "2026-10-05", status: "proposed" }), r, "2026-10-22").overdue).toBe(false);
  });
  it("за левой границей окна: обрубок у левого края, просрочена", () => {
    const b = barOf(task({ start: "2026-09-01", createdAt: "2026-09-01", due: "2026-09-23" }), r, "2026-10-22");
    expect(b.outside).toBe("before");
    expect(b.overdue).toBe(true);
    expect([b.from, b.to]).toEqual([0, 0]);
  });
  it("за правой границей окна: обрубок у правого края", () => {
    const b = barOf(task({ start: "2027-02-10", due: "2027-03-01" }), r, "2026-10-22");
    expect(b.outside).toBe("after");
    expect(b.overdue).toBe(false);
    expect([b.from, b.to]).toEqual([r.days - 1, r.days - 1]);
  });
  it("начало в окне, срок за правой границей: полоса до края, не обрубок", () => {
    const b = barOf(task({ start: "2027-01-20", due: "2027-02-15" }), r, "2026-10-22");
    expect(b.outside).toBeNull();
    expect(b.cutEnd).toBe(true);
    expect(b.to).toBe(r.days - 1);
  });
});

describe("dragSpan", () => {
  const span = { start: "2026-10-20", end: "2026-10-30" };
  it("сдвиг целиком", () => expect(dragSpan(span, "move", 3, "2026-10-22")).toEqual({ start: "2026-10-23", end: "2026-11-02" }));
  it("начало не позже срока", () => expect(dragSpan(span, "start", 20, "2026-10-22").start).toBe("2026-10-30"));
  it("срок не раньше начала и не в прошлом", () => {
    expect(dragSpan(span, "end", -20, "2026-10-22").end).toBe("2026-10-22");
    expect(dragSpan(span, "move", -20, "2026-10-22").end).toBe("2026-10-22");
  });
  describe("просроченная полоса", () => {
    const late = { start: "2026-10-01", end: "2026-10-10" };
    const today = "2026-10-22";
    it("влево не двигается: ни целиком, ни срок", () => {
      expect(dragSpan(late, "move", -3, today)).toEqual(late);
      expect(dragSpan(late, "end", -3, today)).toEqual(late);
      expect(dragSpan(late, "move", 0, today)).toEqual(late);
    });
    it("вправо считается от сегодня: срок на день позже сегодня, начало сдвигается на столько же", () => {
      expect(dragSpan(late, "move", 1, today)).toEqual({ start: "2026-10-14", end: "2026-10-23" });
      expect(dragSpan(late, "end", 2, today)).toEqual({ start: "2026-10-01", end: "2026-10-24" });
    });
    it("начало двигается как обычно", () => expect(dragSpan(late, "start", -2, today)).toEqual({ start: "2026-09-29", end: "2026-10-10" }));
  });
});

describe("spanPlan", () => {
  const before = { start: "2026-10-20", end: "2026-10-30" };
  it("сдвиг целиком: одна правка moveTaskSpan с новыми началом и сроком", () => expect(spanPlan(before, { start: "2026-10-25", end: "2026-11-04" })).toEqual({ kind: "move", start: "2026-10-25", due: "2026-11-04" }));
  it("только начало: без причины", () => expect(spanPlan(before, { start: "2026-10-18", end: "2026-10-30" })).toEqual({ kind: "start", start: "2026-10-18", due: "2026-10-30" }));
  it("только срок: перенос с причиной", () => expect(spanPlan(before, { start: "2026-10-20", end: "2026-11-02" }).kind).toBe("due"));
  it("ничего не поменялось", () => expect(spanPlan(before, { start: "2026-10-20", end: "2026-10-30" }).kind).toBeNull());
});

describe("canMoveBar", () => {
  const own = task({ owner: "reva", coExecutors: [], team: "top" } as Partial<Task>);
  const reva = { slug: "reva" as const };
  it("свою открытую задачу владелец тянет на ноутбуке", () => expect(canMoveBar(own, reva, { viewing: false, coarse: false })).toBe(true));
  it("на сенсорном экране (pointer: coarse) полосы не двигаются", () => expect(canMoveBar(own, reva, { viewing: false, coarse: true })).toBe(false));
  it("в «Смотреть как» полосы не двигаются", () => expect(canMoveBar(own, reva, { viewing: true, coarse: false })).toBe(false));
  it("без прав на срок не двигается: чужая задача, наблюдатель", () => {
    expect(canMoveBar(own, { slug: "loginova" }, { viewing: false, coarse: false })).toBe(false);
    expect(canMoveBar(own, { slug: "reva", observer: true }, { viewing: false, coarse: false })).toBe(false);
  });
});

describe("dayAtX: обрезанный край встаёт на день под указателем", () => {
  const r = timelineRange("2026-10-22");
  it("по доле ширины трека", () => {
    expect(dayAtX(r, 0, 1230)).toBe("2026-10-01");
    expect(dayAtX(r, 1230 * (31 / r.days) + 1, 1230)).toBe("2026-11-01");
  });
  it("за краями трека прижимается к первому и последнему дню", () => {
    expect(dayAtX(r, -40, 1230)).toBe("2026-10-01");
    expect(dayAtX(r, 5000, 1230)).toBe("2027-01-31");
  });
  it("обрезанное начало ставится на дату под указателем, а не сдвигом от невидимой даты", () => {
    // Задача началась 20 сентября (до окна), указатель на 10 октября: начало 10 октября
    const base = { start: "2026-09-20", end: "2026-11-15" };
    const day = dayAtX(r, 1230 * (9.5 / r.days), 1230);
    expect(day).toBe("2026-10-10");
    // Как в карте: сдвиг считается от настоящей даты края до дня под указателем
    expect(dragSpan(base, "start", diffDays(base.start, day), "2026-10-22").start).toBe("2026-10-10");
  });
});

describe("handleInside: ручки не закрывают середину узкой полосы", () => {
  it("у узкой полосы (уже 32 px) ручки целиком снаружи", () => {
    expect(handleInside(12)).toBe(0);
    expect(handleInside(31)).toBe(0);
  });
  it("внутри не больше четверти ширины и не больше половины ручки", () => {
    expect(handleInside(40)).toBe(10);
    expect(handleInside(400)).toBe(HANDLE_PX / 2);
    for (const w of [32, 48, 64, 100]) expect(handleInside(w)).toBeLessThanOrEqual(w / 4);
  });
  it("обрезанный правый край у края карты: у широкой полосы ручка целиком внутри", () => {
    expect(handleInside(400, true)).toBe(HANDLE_PX);
    expect(handleInside(60, true)).toBe(15);
  });
});
