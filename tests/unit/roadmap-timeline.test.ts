import { describe, expect, it } from "vitest";
import { barOf, dragSpan, spanPlan, startOf, timelineRange } from "@/lib/tasks/timeline";
import type { Task } from "@/domain/types";

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
  });
  it("предложенная задача не просрочена", () => {
    expect(barOf(task({ due: "2026-10-05", status: "proposed" }), r, "2026-10-22").overdue).toBe(false);
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
});

describe("spanPlan", () => {
  const before = { start: "2026-10-20", end: "2026-10-30", startKnown: true };
  it("вправо: сначала срок", () => expect(spanPlan(before, { start: "2026-10-25", end: "2026-11-04" }).order).toEqual(["due", "start"]));
  it("влево: сначала начало", () => expect(spanPlan(before, { start: "2026-10-15", end: "2026-10-25" }).order).toEqual(["start", "due"]));
  it("только начало без причины", () => expect(spanPlan(before, { start: "2026-10-18", end: "2026-10-30" })).toEqual({ start: "2026-10-18", due: null, order: ["start"] }));
  it("ничего не поменялось", () => expect(spanPlan(before, { start: "2026-10-20", end: "2026-10-30" }).order).toEqual([]));
});
