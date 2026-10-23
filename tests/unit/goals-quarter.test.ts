// Этап 68: шкала квартала. Каждая цель ровно в одном отборе, кнопки в сумме дают все цели
import { describe, expect, it } from "vitest";
import { goalBucket, type GoalBucket } from "@/lib/goals/quarter";
import type { GoalResult } from "@/lib/goals/parse";

const goal = (over: Partial<{ result: GoalResult; risk: string | null; total: number; factStale: boolean }> = {}) => ({
  result: over.result ?? "IN_PROGRESS",
  risk: over.risk ?? null,
  progress: { total: over.total ?? 2 },
  factStale: over.factStale ?? false,
});

describe("goalBucket", () => {
  it("закрытые: достигнута отдельно, частично, не достигнута и снята в «Закрыты не полностью», а не «в работе»", () => {
    expect(goalBucket(goal({ result: "ACHIEVED" }))).toBe("done");
    expect(goalBucket(goal({ result: "PARTIAL" }))).toBe("closed");
    expect(goalBucket(goal({ result: "MISSED" }))).toBe("closed");
    expect(goalBucket(goal({ result: "DROPPED" }))).toBe("closed");
  });
  it("итог главнее признаков: закрытая цель с риском и без задач всё равно закрыта", () => {
    expect(goalBucket(goal({ result: "MISSED", risk: "просрочено", total: 0, factStale: true }))).toBe("closed");
  });
  it("цели в работе по старшинству: риск, без задач, без свежего факта, остальное «в работе»", () => {
    expect(goalBucket(goal({ risk: "отмечена владельцем", total: 0, factStale: true }))).toBe("risk");
    expect(goalBucket(goal({ total: 0, factStale: true }))).toBe("notasks");
    expect(goalBucket(goal({ factStale: true }))).toBe("stale");
    expect(goalBucket(goal())).toBe("work");
  });
  it("сумма по отборам равна числу целей", () => {
    const goals = [
      goal({ result: "ACHIEVED" }),
      goal({ result: "PARTIAL" }),
      goal({ result: "MISSED" }),
      goal({ risk: "риск" }),
      goal({ total: 0 }),
      goal({ factStale: true }),
      goal(),
      goal(),
    ];
    const counts = new Map<GoalBucket, number>();
    for (const g of goals) counts.set(goalBucket(g), (counts.get(goalBucket(g)) ?? 0) + 1);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(goals.length);
    expect(Object.fromEntries(counts)).toEqual({ done: 1, closed: 2, risk: 1, notasks: 1, stale: 1, work: 2 });
  });
});
