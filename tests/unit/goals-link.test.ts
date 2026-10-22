// Этап 65: задачи к целям перетаскиванием. Чистая логика экрана: кто меняет цель, какая цель подходит задаче,
// список «Мои задачи» с фильтрами и поиском, группы, план перетаскивания, шаги с клавиатуры и тексты уведомлений.
import { describe, expect, it } from "vitest";
import {
  canChangeGoal,
  failedText,
  filterCounts,
  filterTasks,
  goalFitsTask,
  goalName,
  groupGoals,
  groupTasks,
  linkedText,
  matchTask,
  nothingToMove,
  numbersText,
  planLink,
  quarterRange,
  stepTarget,
  tasksByGoal,
  type GoalOf,
  type LinkGoal,
  type LinkTask,
} from "@/lib/goals/links";

const goal = (over: Partial<LinkGoal> & { id: string }): LinkGoal => ({
  code: null,
  title: `Цель ${over.id}`,
  quarter: "2026-Q4",
  team: { id: "sector", name: "Сектор автострахования" },
  owner: "Антонов Дмитрий",
  group: "team",
  result: null,
  progress: { done: 0, total: 0 },
  fact: null,
  target: null,
  numeric: null,
  boardOwner: null,
  personal: false,
  ...over,
});

const task = (over: Partial<LinkTask> & { number: number }): LinkTask => ({
  title: `Задача ${over.number}`,
  status: "in-progress",
  closed: false,
  due: "2026-11-01",
  closedAt: null,
  owner: "Чемоданова Алиса",
  team: { id: "sector", name: "Сектор автострахования" },
  goal: null,
  mine: true,
  reasons: ["owner"],
  canLink: true,
  chain: ["sector", "products", "top"],
  people: ["chemodanova"],
  quarters: ["2026-Q4"],
  ...over,
});

describe("кто меняет цель задачи", () => {
  const t = { ownerId: "alisa", createdById: "anton", teamId: "sector" };
  it("ответственный, тот, кто поставил, руководитель команды и режим управления", () => {
    expect(canChangeGoal(t, { personId: "alisa", role: "EMPLOYEE" }, { leads: [] })).toBe(true);
    expect(canChangeGoal(t, { personId: "anton", role: "LEADER" }, { leads: [] })).toBe(true);
    expect(canChangeGoal(t, { personId: "reva", role: "LEADER" }, { leads: ["sector"] })).toBe(true);
    expect(canChangeGoal(t, { personId: "admin", role: "ADMIN", management: "ADMIN" }, { leads: [] })).toBe(true);
  });
  it("соисполнитель, чужой руководитель и наблюдатель нет; общий логин без управления ничем не руководит", () => {
    expect(canChangeGoal(t, { personId: "co", role: "EMPLOYEE" }, { leads: [] })).toBe(false);
    expect(canChangeGoal(t, { personId: "tokov", role: "LEADER" }, { leads: ["analytics"] })).toBe(false);
    expect(canChangeGoal(t, { personId: "alisa", role: "OBSERVER", management: "ADMIN" }, { leads: ["sector"] })).toBe(false);
    // Общий логин: scope.leads пустой, поэтому только свои задачи
    expect(canChangeGoal(t, { personId: "reva", role: "LEADER" }, { leads: [] })).toBe(false);
  });
});

describe("какая цель подходит задаче", () => {
  it("цель своей команды и команд выше на квартал задачи", () => {
    expect(goalFitsTask(goal({ id: "s1" }), task({ number: 1 }))).toBe(true);
    expect(goalFitsTask(goal({ id: "d1", team: { id: "top", name: "Топ-команда" } }), task({ number: 1 }))).toBe(true);
    expect(goalFitsTask(goal({ id: "a1", team: { id: "analytics", name: "Аналитика" } }), task({ number: 1 }))).toBe(false);
    expect(goalFitsTask(goal({ id: "q1", quarter: "2027-Q1" }), task({ number: 1 }))).toBe(false);
    expect(goalFitsTask(goal({ id: "q1", quarter: "2027-Q1" }), task({ number: 1, quarters: ["2026-Q4", "2027-Q1"] }))).toBe(true);
  });
  it("личная цель из борда лидера: только задачам её владельца, в любой команде", () => {
    const personal = goal({ id: "p", boardOwner: "chemodanova", personal: true });
    expect(goalFitsTask(personal, task({ number: 1 }))).toBe(true);
    expect(goalFitsTask(personal, task({ number: 2, people: ["ivanova"] }))).toBe(false);
    expect(goalFitsTask(goal({ id: "p2", boardOwner: "chemodanova", personal: true, team: { id: "other", name: "Другая" } }), task({ number: 3, chain: ["x"] }))).toBe(true);
    // Цель руководителя из его борда считается целью команды
    expect(goalFitsTask(goal({ id: "lead", boardOwner: "antonov", personal: false }), task({ number: 4 }))).toBe(true);
  });
});

describe("«Мои задачи»: поиск, фильтры, группы", () => {
  const goalOf: GoalOf = (t) => t.goal?.id ?? null;
  const tasks = [
    task({ number: 12, title: "Выкатить форму на весь трафик", due: "2026-11-10" }),
    task({ number: 15, title: "Свёрстать форму", due: "2026-10-20", goal: { id: "s1", title: "Новая форма", code: "1", quarter: "2026-Q4" } }),
    task({ number: 17, title: "Отчёт по ёлкам", closed: true, status: "done", closedAt: "2026-10-05" }),
    task({ number: 18, title: "Закрыта позже", closed: true, status: "done", closedAt: "2026-10-15" }),
    task({ number: 30, title: "Чужая задача под целью", mine: false, goal: { id: "s1", title: "Новая форма", code: "1", quarter: "2026-Q4" } }),
  ];
  it("поиск по номеру целиком, словам, ё и цели", () => {
    expect(matchTask(tasks[0]!, "12")).toBe(true);
    expect(matchTask(tasks[0]!, "1")).toBe(false);
    expect(matchTask(tasks[0]!, "форму трафик")).toBe(true);
    expect(matchTask(tasks[2]!, "елкам")).toBe(true);
    expect(matchTask(tasks[1]!, "новая форма")).toBe(true);
    expect(matchTask(tasks[0]!, "  ")).toBe(true);
  });
  it("«Без цели» прячет задачи с целью, чужие задачи в список не попадают; правка на экране учитывается", () => {
    expect(filterTasks(tasks, "nogoal", "").map((t) => t.number)).toEqual([12, 17, 18]);
    expect(filterTasks(tasks, "all", "").map((t) => t.number)).toEqual([12, 15, 17, 18]);
    expect(filterCounts(tasks)).toEqual({ nogoal: 3, all: 4 });
    // Задачу 12 только что перетащили на цель: она уходит из «Без цели» до ответа сервера
    const moved: GoalOf = (t) => (t.number === 12 ? "s1" : goalOf(t));
    expect(filterTasks(tasks, "nogoal", "", moved).map((t) => t.number)).toEqual([17, 18]);
    expect(filterCounts(tasks, moved)).toEqual({ nogoal: 2, all: 4 });
  });
  it("открытые по сроку сверху, закрытые за квартал ниже, свежие первыми", () => {
    const g = groupTasks(filterTasks(tasks, "all", ""));
    expect(g.open.map((t) => t.number)).toEqual([15, 12]);
    expect(g.closed.map((t) => t.number)).toEqual([18, 17]);
  });
  it("под целью все задачи экрана, открытые выше закрытых", () => {
    const by = tasksByGoal([...tasks, task({ number: 40, closed: true, status: "done", goal: { id: "s1", title: "Новая форма", code: "1", quarter: "2026-Q4" } })]);
    expect(by.get("s1")!.map((t) => t.number)).toEqual([15, 30, 40]);
    expect(by.has("none")).toBe(false);
  });
});

describe("группы целей и названия", () => {
  it("свои цели, цели своих команд, цели выше по командам в порядке сервера", () => {
    const groups = groupGoals([
      goal({ id: "m", group: "mine" }),
      goal({ id: "s1" }),
      goal({ id: "s2" }),
      goal({ id: "t1", group: "team", team: { id: "top", name: "Топ-команда" } }),
      goal({ id: "u1", group: "above", team: { id: "products", name: "Управление развития продуктов" } }),
    ]);
    expect(groups.map((g) => [g.label, g.goals.map((x) => x.id)])).toEqual([
      ["Мои цели", ["m"]],
      ["Команда «Сектор автострахования»", ["s1", "s2"]],
      ["Команда «Топ-команда»", ["t1"]],
      ["Цели выше: «Управление развития продуктов»", ["u1"]],
    ]);
  });
  it("код перед названием один раз", () => {
    expect(goalName({ code: "D1", title: "Маржа" })).toBe("D1. Маржа");
    expect(goalName({ code: "D1", title: "D1. Маржа" })).toBe("D1. Маржа");
    expect(goalName({ code: null, title: "Маржа" })).toBe("Маржа");
  });
});

describe("что сделает перетаскивание", () => {
  const s1 = goal({ id: "s1", code: "1", title: "Новая форма" });
  const a1 = goal({ id: "a1", team: { id: "analytics", name: "Аналитика" } });
  const list = [
    task({ number: 1 }),
    task({ number: 2, goal: { id: "s1", title: "Новая форма", code: "1", quarter: "2026-Q4" } }),
    task({ number: 3, canLink: false }),
    task({ number: 4, chain: ["analytics", "top"] }),
  ];
  it("двигает только то, что можно, подходит и ещё не там", () => {
    expect(planLink(list, s1)).toEqual({ move: [1], same: [2], locked: [3], unfit: [4] });
    expect(planLink(list, a1)).toEqual({ move: [4], same: [], locked: [3], unfit: [1, 2] });
    // «Без цели»: снимается только у задач с целью
    expect(planLink(list, null)).toEqual({ move: [2], same: [1, 4], locked: [3], unfit: [] });
  });
  it("когда двигать нечего, уведомление объясняет почему", () => {
    expect(nothingToMove(planLink([list[3]!], s1), s1)).toMatch(/^Задача 4 не подходит цели «1\. Новая форма»: задачу привязывают к цели своей команды/);
    expect(nothingToMove(planLink([list[2]!], s1), s1)).toMatch(/меняют её ответственный/);
    expect(nothingToMove(planLink([list[1]!], s1), s1)).toBe("Задача уже работает на цель «1. Новая форма»");
    expect(nothingToMove(planLink([list[0]!], null), null)).toBe("У задачи и так нет цели");
  });
});

describe("тексты уведомлений", () => {
  it("привязана, привязаны, отвязана", () => {
    expect(linkedText([12], { code: "D1", title: "Маржа" })).toBe("Задача 12 привязана к цели «D1. Маржа»");
    expect(linkedText([12, 15], { code: null, title: "Маржа" })).toBe("2 задачи привязаны к цели «Маржа»");
    expect(linkedText([1, 2, 3, 4, 5], { code: null, title: "Маржа" })).toBe("5 задач привязаны к цели «Маржа»");
    expect(linkedText([12], null)).toBe("Задача 12 отвязана от цели");
    expect(linkedText([12, 15, 17], null)).toBe("3 задачи отвязаны от цели");
  });
  it("номера и неудачи", () => {
    expect(numbersText([12])).toBe("Задача 12");
    expect(numbersText([12, 15, 17])).toBe("Задачи 12, 15 и 17");
    expect(failedText([])).toBe("");
    expect(failedText([{ number: 15, error: "Цель снята: выберите другую" }])).toBe("Не получилось с задачей 15: Цель снята: выберите другую");
    expect(failedText([{ number: 15, error: "Нет права" }, { number: 16, error: "Нет права" }])).toBe("Не получилось с задачами 15, 16: Нет права");
  });
  it("в текстах нет длинного тире, стрелок и точки-разделителя", () => {
    const all = [linkedText([1], { code: "D1", title: "Маржа" }), linkedText([1, 2], null), nothingToMove({ move: [], same: [], locked: [], unfit: [3] }, goal({ id: "x" })), failedText([{ number: 1, error: "x" }])].join(" ");
    expect(all).not.toMatch(/[—→←·]/);
  });
});

describe("перетаскивание с клавиатуры и квартал", () => {
  it("стрелки ведут по целям по порядку, у краёв стоят на месте", () => {
    expect(stepTarget(3, -1, true)).toBe(0);
    expect(stepTarget(3, -1, false)).toBe(2);
    expect(stepTarget(3, 0, true)).toBe(1);
    expect(stepTarget(3, 2, true)).toBe(2);
    expect(stepTarget(3, 0, false)).toBe(0);
    expect(stepTarget(0, -1, true)).toBe(-1);
  });
  it("даты квартала: первый день и первый день следующего", () => {
    expect(quarterRange("2026-Q4")).toEqual({ start: "2026-10-01", end: "2027-01-01" });
    expect(quarterRange("2027-Q1")).toEqual({ start: "2027-01-01", end: "2027-04-01" });
    expect(quarterRange("2027-Q3")).toEqual({ start: "2027-07-01", end: "2027-10-01" });
    expect(quarterRange("Q4")).toBeNull();
  });
});
