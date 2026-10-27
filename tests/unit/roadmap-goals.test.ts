// Этап 77: roadmap по целям. Группы целей (свои цели, цели выше, цели из меток задач), задачи без цели, полосы целей
// на карте сроков, столбец цели на доске, пустые цели и фильтры
import { describe, expect, it } from "vitest";
import { buildGoalGroups, buildGoalTimeline, goalLineOf, goalPeriodOf, groupByOf, quarterSpan, type RoadmapGoal } from "@/lib/tasks/roadmap-goals";
import { roadmapPeriods } from "@/lib/tasks/roadmap";
import { timelineRange } from "@/lib/tasks/timeline";
import type { Task } from "@/domain/types";

const TODAY = "2026-10-21";
const NONE = { person: null, onlyImportant: false };

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
    createdAt: "2026-10-01",
    archived: false,
    ...patch,
  }) as unknown as Task;

const goal = (id: string, patch: Partial<RoadmapGoal> = {}): RoadmapGoal => ({
  id,
  code: id.toUpperCase(),
  title: `Цель ${id}`,
  quarter: "2026-Q4",
  team: { id: "top", name: "Топ-команда" },
  owner: { slug: "muradyan", fullName: "Мурадян Арам" },
  result: "IN_PROGRESS",
  risk: null,
  progress: { done: 0, total: 0, overdue: 0 },
  numeric: null,
  fact: null,
  base: null,
  target: null,
  metric: null,
  own: true,
  known: true,
  ...patch,
});

const link = (g: RoadmapGoal) => ({ id: g.id, title: `${g.code}. ${g.title}`, code: g.code, quarter: g.quarter });

describe("группировка в адресе", () => {
  it("по задачам по умолчанию, по целям и цели и задачи", () => {
    expect(groupByOf(null)).toBe("tasks");
    expect(groupByOf("что-то")).toBe("tasks");
    expect(groupByOf("goals")).toBe("goals");
    expect(groupByOf("both")).toBe("both");
  });
});

describe("квартал", () => {
  it("первый и последний день", () => {
    expect(quarterSpan("2026-Q4")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(quarterSpan("2027-Q1")).toEqual({ start: "2027-01-01", end: "2027-03-31" });
    expect(quarterSpan("2028-Q1")?.end).toBe("2028-03-31");
    expect(quarterSpan("2026-Q2")).toEqual({ start: "2026-04-01", end: "2026-06-30" });
    expect(quarterSpan("плохо")).toBeNull();
  });
});

describe("группы целей", () => {
  const a = goal("a");
  const b = goal("b");
  const above = goal("d1", { own: false, team: { id: "dep", name: "Департамент" } });
  const idle = goal("d2", { own: false, team: { id: "dep", name: "Департамент" } });

  it("свои цели по порядку с сервера, полоса от начала первой задачи до самого позднего срока, задачи без цели отдельно", () => {
    const tasks = [
      task(1, { goal: link(a), start: "2026-10-12", due: "2026-11-05" }),
      task(2, { goal: link(a), createdAt: "2026-10-03", due: "2026-12-10" }),
      task(3, { due: "2026-10-25" }),
      task(4, { goal: link(a), status: "done" }),
    ];
    const g = buildGoalGroups(tasks, [b, a], TODAY, NONE);
    expect(g.goals.map((x) => x.goal.id)).toEqual(["b", "a"]);
    const ga = g.goals[1]!;
    // Закрытая задача не на roadmap; без своего начала задача идёт от даты постановки
    expect(ga.tasks.map((t) => t.number)).toEqual([2, 1]);
    expect(ga.span).toEqual({ start: "2026-10-03", end: "2026-12-10" });
    expect(ga.empty).toBe(false);
    expect(g.noGoal.map((t) => t.number)).toEqual([3]);
    expect(g.total).toBe(3);
  });

  it("своя цель без задач видна: полоса на весь квартал, пустая", () => {
    const g = buildGoalGroups([], [a], TODAY, NONE);
    expect(g.goals).toHaveLength(1);
    expect(g.goals[0]!.empty).toBe(true);
    expect(g.goals[0]!.span).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(g.total).toBe(0);
  });

  it("цель выше видна, только если на неё работают задачи, и идёт после своих", () => {
    const g = buildGoalGroups([task(1, { goal: link(above) })], [above, idle, a], TODAY, NONE);
    expect(g.goals.map((x) => x.goal.id)).toEqual(["a", "d1"]);
    expect(g.goals[1]!.goal.own).toBe(false);
  });

  it("цель из метки задачи, если её нет среди целей с сервера: без статуса, название без кода", () => {
    const old = { id: "old", title: "Q3-1. Прошлая цель", code: "Q3-1", quarter: "2026-Q3" };
    const g = buildGoalGroups([task(1, { goal: old }), task(2, { goal: old, due: "2026-11-02" })], [a], TODAY, NONE);
    expect(g.goals.map((x) => x.goal.id)).toEqual(["a", "old"]);
    const o = g.goals[1]!;
    expect(o.goal.known).toBe(false);
    expect(o.goal.title).toBe("Прошлая цель");
    expect(o.goal.quarter).toBe("2026-Q3");
    expect(o.tasks).toHaveLength(2);
  });

  it("фильтр человека: остаются цели с его задачами и его цели без задач", () => {
    const mine = goal("m", { owner: { slug: "reva", fullName: "Рева Тарас" } });
    const tasks = [task(1, { goal: link(a), owner: "fatyanov" }), task(2, { goal: link(b), owner: "reva" }), task(3, { owner: "reva" })];
    const g = buildGoalGroups(tasks, [a, b, mine], TODAY, { person: "reva", onlyImportant: false });
    expect(g.goals.map((x) => x.goal.id)).toEqual(["b", "m"]);
    expect(g.goals[1]!.empty).toBe(true);
    expect(g.noGoal.map((t) => t.number)).toEqual([3]);
  });

  it("только важные: цели без важных задач уходят, счётчики важных и просроченных", () => {
    const tasks = [task(1, { goal: link(a), priority: "critical", due: "2026-10-10" }), task(2, { goal: link(a) }), task(3, { goal: link(b) })];
    const g = buildGoalGroups(tasks, [a, b], TODAY, { person: null, onlyImportant: true });
    expect(g.goals.map((x) => x.goal.id)).toEqual(["a"]);
    expect(g.goals[0]!.tasks.map((t) => t.number)).toEqual([1]);
    expect(g.goals[0]!.important).toBe(1);
    expect(g.goals[0]!.overdue).toBe(1);
    expect(g.overdue).toBe(1);
  });
});

describe("столбец цели на доске", () => {
  const periods = roadmapPeriods(TODAY);
  const a = goal("a");
  it("месяц самого позднего срока, пустая цель в месяце конца квартала", () => {
    const [g] = buildGoalGroups([task(1, { goal: link(a), due: "2026-10-25" }), task(2, { goal: link(a), due: "2026-11-20" })], [a], TODAY, NONE).goals;
    expect(goalPeriodOf(g!, TODAY, periods)).toBe("2026-11");
    const [e] = buildGoalGroups([], [a], TODAY, NONE).goals;
    expect(goalPeriodOf(e!, TODAY, periods)).toBe("2026-12");
  });
  it("самый поздний срок прошёл: просрочено; у предложенной задачи текущий месяц; позже окна: «Позже»", () => {
    const [late] = buildGoalGroups([task(1, { goal: link(a), due: "2026-10-05" })], [a], TODAY, NONE).goals;
    expect(goalPeriodOf(late!, TODAY, periods)).toBe("overdue");
    const [proposed] = buildGoalGroups([task(1, { goal: link(a), due: "2026-10-05", status: "proposed" })], [a], TODAY, NONE).goals;
    expect(goalPeriodOf(proposed!, TODAY, periods)).toBe("2026-10");
    const [far] = buildGoalGroups([task(1, { goal: link(a), due: "2027-02-01" })], [a], TODAY, NONE).goals;
    expect(goalPeriodOf(far!, TODAY, periods)).toBe("later");
  });
});

describe("полосы целей на карте сроков", () => {
  const range = timelineRange(TODAY);
  const a = goal("a");
  const b = goal("b");
  it("полоса цели по её задачам, полосы задач под целью и задачи без цели", () => {
    const groups = buildGoalGroups([task(1, { goal: link(a), start: "2026-10-12", due: "2026-11-05" }), task(2, { goal: link(a), start: "2026-10-20", due: "2026-10-28" }), task(3)], [a, b], TODAY, NONE);
    const t = buildGoalTimeline(groups, TODAY, range);
    const [ra, rb] = t.goals;
    expect(ra!.line).toMatchObject({ start: "2026-10-12", end: "2026-11-05", from: 11, to: 35, empty: false, late: false, outside: null, cutStart: false });
    expect(ra!.bars.map((x) => x.task.number)).toEqual([1, 2]);
    // Цель без задач: весь квартал, пунктиром; квартал начался в окне карты
    expect(rb!.line).toMatchObject({ start: "2026-10-01", end: "2026-12-31", empty: true, from: 0, to: 91, cutStart: false, cutEnd: false });
    expect(t.noGoal.map((x) => x.task.number)).toEqual([3]);
  });
  it("начало раньше окна обрезано, просроченная цель отмечена", () => {
    const [g] = buildGoalGroups([task(1, { goal: link(a), start: "2026-09-10", due: "2026-10-05" })], [a], TODAY, NONE).goals;
    const line = goalLineOf(g!, range, TODAY);
    expect(line.cutStart).toBe(true);
    expect(line.from).toBe(0);
    expect(line.late).toBe(true);
    const [gone] = buildGoalGroups([task(1, { goal: link(a), start: "2026-09-01", due: "2026-09-20" })], [a], TODAY, NONE).goals;
    expect(goalLineOf(gone!, range, TODAY).outside).toBe("before");
  });
});
