// Этап 65: задачи к целям перетаскиванием. Чистая логика экрана: кто меняет цель, какая цель подходит задаче,
// список «Мои задачи» с фильтрами и поиском, группы, план перетаскивания, шаги с клавиатуры и тексты уведомлений.
import { describe, expect, it } from "vitest";
import {
  WHICH_GOALS,
  WHO_LINKS,
  canChangeGoal,
  countsForGoal,
  dragSet,
  edgeScroll,
  edgeStep,
  failedText,
  filterCounts,
  filterTasks,
  focusAfter,
  goalFitsTask,
  goalName,
  goalTasksText,
  groupGoals,
  groupTasks,
  linkToast,
  linkedText,
  listTasks,
  matchTask,
  nothingToMove,
  numbersText,
  planLink,
  quarterRange,
  stepTarget,
  tallyText,
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
  const t = { ownerId: "alisa", createdById: "anton", teamId: "sector", coExecutors: [{ personId: "co" }] };
  it("ответственный, соисполнитель, тот, кто поставил, руководитель команды и режим управления", () => {
    expect(canChangeGoal(t, { personId: "co", role: "EMPLOYEE" }, { leads: [] })).toBe(true);
    expect(canChangeGoal(t, { personId: "alisa", role: "EMPLOYEE" }, { leads: [] })).toBe(true);
    expect(canChangeGoal(t, { personId: "anton", role: "LEADER" }, { leads: [] })).toBe(true);
    expect(canChangeGoal(t, { personId: "reva", role: "LEADER" }, { leads: ["sector"] })).toBe(true);
    expect(canChangeGoal(t, { personId: "admin", role: "ADMIN", management: "ADMIN" }, { leads: [] })).toBe(true);
  });
  it("участник команды без роли в задаче, чужой руководитель и наблюдатель нет; общий логин без управления ничем не руководит", () => {
    expect(canChangeGoal(t, { personId: "member", role: "EMPLOYEE" }, { leads: [] })).toBe(false);
    expect(canChangeGoal({ ...t, coExecutors: undefined }, { personId: "co", role: "EMPLOYEE" }, { leads: [] })).toBe(false);
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
  it("под целью все задачи экрана, открытые выше закрытых, без отменённых; цифры карточки из того же списка", () => {
    const s1 = { id: "s1", title: "Новая форма", code: "1", quarter: "2026-Q4" };
    const by = tasksByGoal([...tasks, task({ number: 40, closed: true, status: "done", goal: s1 }), task({ number: 41, closed: true, status: "cancelled", goal: s1 })]);
    expect(by.get("s1")!.map((t) => t.number)).toEqual([15, 30, 40]);
    expect(by.has("none")).toBe(false);
    expect(tallyText(by.get("s1")!)).toBe("закрыто 1 из 3");
    expect(tallyText([])).toBe("задач пока нет");
    expect(tallyText([{ status: "cancelled" }])).toBe("задач пока нет");
  });
  it("цифры цели одним правилом на обеих вкладках: без отменённых и предложенных, закрытые это выполненные", () => {
    expect(["IN_PROGRESS", "CLARIFY", "DONE", "PARTIAL", "FAILED", "in-progress", "done"].every(countsForGoal)).toBe(true);
    expect(["CANCELLED", "PROPOSED", "cancelled", "proposed"].some(countsForGoal)).toBe(false);
    expect(tallyText([{ status: "proposed" }, { status: "done" }, { status: "partial" }, { status: "in-progress" }])).toBe("закрыто 1 из 3");
    expect(goalTasksText(0, 1)).toBe("закрыто 0 из 1");
    expect(goalTasksText(0, 0)).toBe("задач пока нет");
  });
  it("задачи, которые человек привязать не может, отдельно в «Только посмотреть» и не в счётчиках", () => {
    const list = [...tasks, task({ number: 50, title: "Задача команды", canLink: false, reasons: ["team"], due: "2026-10-01" }), task({ number: 51, title: "Закрытая чужая", canLink: false, closed: true, status: "done", closedAt: "2026-10-03" })];
    const r = listTasks(list, "nogoal", "");
    expect(r.open.map((t) => t.number)).toEqual([12]);
    expect(r.closed.map((t) => t.number)).toEqual([18, 17]);
    expect(r.viewOnly.map((t) => t.number)).toEqual([50, 51]);
    expect(filterCounts(list)).toEqual({ nogoal: 3, all: 4 });
    expect(listTasks(list, "all", "чужая").viewOnly.map((t) => t.number)).toEqual([51]);
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
    const below = groupGoals([goal({ id: "s1" }), goal({ id: "a1", group: "below", team: { id: "analytics", name: "Аналитика" } })]);
    expect(below.map((g) => g.label)).toEqual(["Команда «Сектор автострахования»", "Команды ниже: «Аналитика»"]);
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
    expect(nothingToMove(planLink([list[3]!], s1), s1)).toBe("Задача 4 не подходит цели «1. Новая форма»: подходят цели своей команды, команды выше или личные цели её людей, текущего квартала или квартала срока");
    expect(nothingToMove(planLink([list[2]!], s1), s1)).toBe("Нет прав менять цель: её меняют ответственный, соисполнители, тот, кто поставил задачу, руководитель её команды или команды выше и режим управления");
    expect(nothingToMove(planLink([list[3]!], s1), s1)).toContain("текущего квартала или квартала срока");
    expect(WHO_LINKS).toContain("руководитель её команды или команды выше и режим управления");
    expect(WHICH_GOALS).toBe("цели своей команды, команды выше или личные цели её людей, текущего квартала или квартала срока");
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

describe("тост, фокус и отмеченные", () => {
  const g = { code: "D1", title: "Маржа" };
  it("всё прошло: обычный тост; часть не прошла: тост ошибки с причинами, нет прав называется прямо", () => {
    expect(linkToast({ done: [12, 15], failed: [], unfit: [], locked: [] }, g)).toEqual({ text: "2 задачи привязаны к цели «D1. Маржа»", error: false });
    const partial = linkToast({ done: [12], failed: [{ number: 15, error: "Цель снята: выберите другую" }], unfit: [17], locked: [18, 19] }, g);
    expect(partial.error).toBe(true);
    expect(partial.text).toBe("Задача 12 привязана к цели «D1. Маржа». Не получилось с задачей 15: Цель снята: выберите другую. Задача 17 не подходит цели «D1. Маржа». Нет прав менять цель: задачи 18 и 19");
    expect(partial.text).not.toMatch(/не подошли/i);
    expect(linkToast({ done: [], failed: [], unfit: [], locked: [3] }, null)).toEqual({ text: "Нет прав менять цель: задача 3", error: true });
  });
  it("фокус после пропавших строк: следующая, иначе предыдущая, иначе заголовок", () => {
    expect(focusAfter([1, 2, 3, 4], [2])).toBe(3);
    expect(focusAfter([1, 2, 3, 4], [2, 3])).toBe(4);
    expect(focusAfter([1, 2, 3, 4], [4])).toBe(3);
    expect(focusAfter([1, 2, 3], [1, 2, 3])).toBeNull();
    expect(focusAfter([1, 2], [9])).toBeNull();
  });
  it("тянутся только видимые отмеченные задачи; не отмеченная тянется одна", () => {
    expect(dragSet(2, true, [1, 2])).toEqual([1, 2]);
    expect(dragSet(3, true, [1, 2])).toEqual([3]);
    expect(dragSet(2, false, [1, 2])).toEqual([2]);
    expect(dragSet(2, true, [2])).toEqual([2]);
  });
});

describe("автопрокрутка колонки целей у краёв", () => {
  it("у верхнего края вверх, у нижнего вниз, тем быстрее, чем ближе к краю; в середине и вне колонки стоит", () => {
    expect(edgeStep(110, 100, 800)).toBeLessThan(0);
    expect(edgeStep(790, 100, 800)).toBeGreaterThan(0);
    expect(edgeStep(799, 100, 800)).toBeGreaterThan(edgeStep(760, 100, 800));
    expect(edgeStep(101, 100, 800)).toBeLessThan(edgeStep(140, 100, 800));
    expect(edgeStep(450, 100, 800)).toBe(0);
    expect(edgeStep(90, 100, 800)).toBe(0);
    expect(edgeStep(810, 100, 800)).toBe(0);
    // Колонка ниже двух зон у края не крутится вовсе
    expect(edgeStep(105, 100, 180)).toBe(0);
  });

  it("низ колонки за краем окна: сначала окно и не дальше низа колонки, потом сама колонка; окно вверх не едет", () => {
    const col = { top: 440, bottom: 935, left: 280, right: 830 };
    // Курсор у края окна над колонкой: едет окно, не больше спрятанной части колонки
    const first = edgeScroll({ x: 555, y: 895 }, col, 900, true);
    expect(first.page).toBeGreaterThan(0);
    expect(first.page).toBeLessThanOrEqual(35);
    expect(first.column).toBe(0);
    expect(edgeScroll({ x: 555, y: 899 }, { ...col, bottom: 902 }, 900, true)).toEqual({ page: 2, column: 0 });
    // Колонка видна целиком (прилипла к верху): окно стоит, крутится колонка, если ей есть куда
    const pinned = { top: 80, bottom: 884, left: 280, right: 830 };
    expect(edgeScroll({ x: 555, y: 872 }, pinned, 900, true).page).toBe(0);
    expect(edgeScroll({ x: 555, y: 872 }, pinned, 900, true).column).toBeGreaterThan(0);
    expect(edgeScroll({ x: 555, y: 872 }, pinned, 900, false)).toEqual({ page: 0, column: 0 });
    expect(edgeScroll({ x: 555, y: 90 }, pinned, 900, true)).toEqual({ page: 0, column: edgeStep(90, 80, 884) });
    // Курсор не над колонкой или в её середине: ничего не крутится
    expect(edgeScroll({ x: 1000, y: 895 }, col, 900, true)).toEqual({ page: 0, column: 0 });
    expect(edgeScroll({ x: 555, y: 600 }, col, 900, true)).toEqual({ page: 0, column: 0 });
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
