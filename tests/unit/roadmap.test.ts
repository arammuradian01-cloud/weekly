// Этап 56: roadmap. Столбцы сроков от сегодняшнего дня, место задачи на доске, важность по приоритету, фильтры
import { describe, expect, it } from "vitest";
import { buildRoadmap, importanceOf, onRoadmap, periodOf, roadmapPeriods } from "@/lib/tasks/roadmap";
import type { Task } from "@/domain/types";

const TODAY = "2026-10-21";
const task = (number: number, patch: Partial<Task> = {}) =>
  ({
    number,
    title: `Задача ${number}`,
    outcome: "",
    owner: "reva",
    coExecutors: [],
    direction: "osago",
    priority: "medium",
    status: "in-progress",
    state: "on-track",
    due: "2026-10-30",
    archived: false,
    ...patch,
  }) as unknown as Task;
const DIRS = [
  { code: "osago", label: "ОСАГО" },
  { code: "kasko", label: "КАСКО" },
  { code: "deposits", label: "Депозиты и инвестиции" },
];

describe("сроки на доске", () => {
  it("просрочено, текущий месяц и два следующих, позже; январь подписан годом", () => {
    expect(roadmapPeriods(TODAY).map((p) => p.label)).toEqual(["Просрочено", "Октябрь", "Ноябрь", "Декабрь", "Позже"]);
    expect(roadmapPeriods("2026-11-05").map((p) => p.label)).toEqual(["Просрочено", "Ноябрь", "Декабрь", "Январь 2027", "Позже"]);
    expect(roadmapPeriods("2026-12-31").map((p) => p.key)).toEqual(["overdue", "2026-12", "2027-01", "2027-02", "later"]);
  });

  it("задача встаёт по месяцу срока; просроченная в «Просрочено», предложенная с прошедшим сроком в текущий месяц", () => {
    expect(periodOf(task(1, { due: "2026-10-21" }), TODAY)).toBe("2026-10");
    expect(periodOf(task(1, { due: "2026-10-20" }), TODAY)).toBe("overdue");
    expect(periodOf(task(1, { due: "2026-12-31" }), TODAY)).toBe("2026-12");
    expect(periodOf(task(1, { due: "2027-01-01" }), TODAY)).toBe("later");
    expect(periodOf(task(1, { due: "2026-10-01", status: "proposed" }), TODAY)).toBe("2026-10");
  });

  it("важность: критичный две звёздочки, высокий одна, остальные без отметки; закрытые и архив не на доске", () => {
    expect([importanceOf("critical"), importanceOf("high"), importanceOf("medium"), importanceOf("low"), importanceOf("unset")]).toEqual([2, 1, 0, 0, 0]);
    expect(onRoadmap(task(1, { status: "done" }))).toBe(false);
    expect(onRoadmap(task(1, { archived: true }))).toBe(false);
    expect(onRoadmap(task(1, { status: "clarify" }))).toBe(true);
    expect(onRoadmap(task(1, { status: "proposed" }))).toBe(true);
  });
});

describe("доска", () => {
  const tasks = [
    task(1, { direction: "kasko", due: "2026-11-10" }),
    task(2, { direction: "osago", due: "2026-10-25", priority: "high" }),
    task(3, { direction: "osago", due: "2026-10-22" }),
    task(4, { direction: "osago", due: "2026-10-28", priority: "critical", owner: "tokov" }),
    task(5, { direction: "osago", due: "2026-10-10", coExecutors: ["tokov"] }),
    task(6, { direction: "osago", status: "done" }),
    task(7, { direction: "red", due: "2027-03-01", priority: "high" }),
  ];

  it("строки в порядке справочника, неизвестное направление в конце; в ячейке сначала важные, потом по сроку", () => {
    const b = buildRoadmap(tasks, TODAY, { person: null, onlyImportant: false }, DIRS);
    expect(b.rows.map((r) => r.direction)).toEqual(["osago", "kasko", "red"]);
    expect(b.rows[0]!.cells["2026-10"]!.map((t) => t.number)).toEqual([4, 2, 3]);
    expect(b.rows[0]!.cells.overdue!.map((t) => t.number)).toEqual([5]);
    expect(b.rows[2]!.label).toBe("red");
    expect(b.rows[2]!.cells.later!.map((t) => t.number)).toEqual([7]);
    expect({ total: b.total, important: b.important, overdue: b.overdue }).toEqual({ total: 6, important: 3, overdue: 1 });
    expect(b.rows[0]).toMatchObject({ total: 4, important: 2 });
  });

  it("человек: ответственный или соисполнитель; только важные", () => {
    const tokov = buildRoadmap(tasks, TODAY, { person: "tokov", onlyImportant: false }, DIRS);
    expect(tokov.rows.flatMap((r) => Object.values(r.cells).flat()).map((t) => t.number).sort()).toEqual([4, 5]);
    const important = buildRoadmap(tasks, TODAY, { person: null, onlyImportant: true }, DIRS);
    expect(important.rows.map((r) => r.direction)).toEqual(["osago", "red"]);
    expect(important.total).toBe(3);
  });
});
