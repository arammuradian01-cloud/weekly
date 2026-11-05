// Этап 25: параметры списка в адресе, сортировка, запрос к словарю поиска, виды и повтор без базы
import { describe, expect, it } from "vitest";
import { applyListParams, listParamsToQuery, parseListParams, sortTasks, DEFAULT_PARAMS, hasFilters } from "@/lib/tasks/list-params";
import { plainSnippet, taskNumberOf, tsQueryOf, MARK_END, MARK_START } from "@/lib/search/common";
import { normalizeQuery } from "@/lib/views/query";
import { addMonth, nextRepeatDue } from "@/lib/tasks/repeat";
import type { Task } from "@/domain/types";

const task = (patch: Partial<Task>): Task => ({
  number: 1,
  title: "Задача",
  outcome: "Результат",
  owner: "reva",
  coExecutors: [],
  direction: "osago",
  priority: "medium",
  status: "in-progress",
  state: "on-track",
  where: "",
  whereUpdatedAt: "2026-10-05",
  due: "2026-10-20",
  originalDue: "2026-10-20",
  transfers: [],
  source: { kind: "other", note: "" },
  links: [],
  comments: [],
  history: [],
  createdBy: "muradyan",
  createdAt: "2026-10-05",
  updatedAt: "2026-10-05",
  team: "top",
  ...patch,
});

describe("параметры списка в адресе", () => {
  it("адрес разбирается и собирается без потерь, чужое отбрасывается", () => {
    const p = parseListParams(new URLSearchParams("f=mine,overdue,bogus&owner=reva&group=priority&closed=1&sort=due&dir=desc&q=ск&task=47"));
    expect(p.filters).toEqual(["mine", "overdue"]);
    expect(p.owner).toBe("reva");
    expect(p.group).toBe("priority");
    expect(p.closed).toBe(true);
    expect(p.sort).toBe("due");
    expect(p.dir).toBe("desc");
    expect(listParamsToQuery(p)).toBe("q=%D1%81%D0%BA&f=mine%2Coverdue&owner=reva&group=priority&closed=1&sort=due&dir=desc");
    expect(listParamsToQuery(DEFAULT_PARAMS)).toBe("");
    expect(hasFilters(DEFAULT_PARAMS)).toBe(false);
    expect(hasFilters({ ...DEFAULT_PARAMS, sort: "title" })).toBe(true);
    // Битая группировка и сортировка уходят в умолчание
    expect(parseListParams(new URLSearchParams("group=x&sort=y&dir=z"))).toMatchObject({ group: "owner", sort: null, dir: "asc" });
  });

  it("фильтры отбирают задачи, закрытые и архив по флажкам", () => {
    const me = { slug: "reva", role: "LEADER" as const };
    const tasks = [
      task({ number: 1, owner: "reva", due: "2026-10-01" }),
      task({ number: 2, owner: "golovkin", priority: "critical" }),
      task({ number: 3, owner: "reva", status: "done" }),
      task({ number: 4, owner: "reva", archived: true }),
    ];
    const today = "2026-10-07";
    expect(applyListParams(tasks, DEFAULT_PARAMS, me, today).map((t) => t.number)).toEqual([1, 2]);
    expect(applyListParams(tasks, { ...DEFAULT_PARAMS, filters: ["mine"] }, me, today).map((t) => t.number)).toEqual([1]);
    expect(applyListParams(tasks, { ...DEFAULT_PARAMS, filters: ["overdue"] }, me, today).map((t) => t.number)).toEqual([1]);
    expect(applyListParams(tasks, { ...DEFAULT_PARAMS, filters: ["critical"] }, me, today).map((t) => t.number)).toEqual([2]);
    expect(applyListParams(tasks, { ...DEFAULT_PARAMS, owner: "golovkin" }, me, today).map((t) => t.number)).toEqual([2]);
    expect(applyListParams(tasks, { ...DEFAULT_PARAMS, closed: true }, me, today).map((t) => t.number)).toEqual([1, 2, 3]);
    expect(applyListParams(tasks, { ...DEFAULT_PARAMS, archive: true }, me, today).map((t) => t.number)).toEqual([4]);
    expect(applyListParams(tasks, { ...DEFAULT_PARAMS, q: "2" }, me, today).map((t) => t.number)).toEqual([2]);
  });

  it("поиск по словам в любом порядке, «ё» и регистр не важны, цель тоже ищется (этап 74)", () => {
    const me = { slug: "reva", role: "LEADER" as const };
    const find = (q: string, list: Task[]) => applyListParams(list, { ...DEFAULT_PARAMS, q }, me, "2026-10-07").map((t) => t.number);
    const tasks = [
      task({ number: 1, title: "Учёт убытков", outcome: "Свести учёт", owner: "reva" }),
      task({ number: 2, title: "Выгрузка по ОСАГО", outcome: "Отчёт в СК", owner: "golovkin", goal: { id: "g1", title: "РТ-1. Рост выручки", code: "РТ-1" } }),
      task({ number: 3, title: "Прочее", outcome: "Прочее", owner: "reva" }),
    ];
    // «ё» и регистр: «учет» находит «Учёт», «УЧЁТ» тоже
    expect(find("учет", tasks)).toEqual([1]);
    expect(find("УЧЁТ", tasks)).toEqual([1]);
    // Слова в любом порядке и из разных полей: фамилия ответственного и слово из названия
    expect(find("осаго головкин", tasks)).toEqual([2]);
    expect(find("головкин выгрузка", tasks)).toEqual([2]);
    // Цель задачи: по коду из метки в строке списка и по названию цели
    expect(find("рт-1", tasks)).toEqual([2]);
    expect(find("выручки", tasks)).toEqual([2]);
    // Номер ищется целиком, как раньше: «2» это задача 2, а не всё, где есть цифра 2
    expect(find("2", tasks)).toEqual([2]);
    // Слово, которого нет ни в одной задаче, не находит ничего
    expect(find("каско", tasks)).toEqual([]);
  });

  it("сортировка по колонкам в обе стороны, без колонки прежний порядок", () => {
    const tasks = [
      task({ number: 1, title: "Б", due: "2026-10-30", priority: "low" }),
      task({ number: 2, title: "А", due: "2026-10-01", priority: "critical" }),
      task({ number: 3, title: "В", due: "2026-10-15", priority: "high" }),
    ];
    const today = "2026-10-07";
    expect(sortTasks(tasks, "title", "asc", today).map((t) => t.number)).toEqual([2, 1, 3]);
    expect(sortTasks(tasks, "title", "desc", today).map((t) => t.number)).toEqual([3, 1, 2]);
    expect(sortTasks(tasks, "due", "asc", today).map((t) => t.number)).toEqual([2, 3, 1]);
    expect(sortTasks(tasks, "priority", "asc", today).map((t) => t.number)).toEqual([2, 3, 1]);
    // Без сортировки: просроченная вперёд, потом по приоритету
    expect(sortTasks(tasks, null, "asc", today).map((t) => t.number)).toEqual([2, 3, 1]);
  });
});

describe("поиск: запрос к словарю", () => {
  it("слова через «и», последнее по началу, операторы не проходят", () => {
    expect(tsQueryOf("выгрузка по убыткам")).toBe("выгрузка & по & убыткам:*");
    expect(tsQueryOf("СК")).toBe("ск");
    expect(tsQueryOf("дост")).toBe("дост:*");
    expect(tsQueryOf("a & b | !c")).toBe("a & b & c");
    expect(tsQueryOf("   ")).toBe("");
  });

  it("номер задачи распознаётся, маркеры подсветки снимаются", () => {
    expect(taskNumberOf("47")).toBe(47);
    expect(taskNumberOf("#47")).toBe(47);
    expect(taskNumberOf("47%")).toBeNull();
    expect(plainSnippet(`Доступ от ${MARK_START}СК${MARK_END} запрошен`)).toBe("Доступ от СК запрошен");
  });
});

describe("сохранённые виды", () => {
  it("строка фильтров приводится к одному виду", () => {
    expect(normalizeQuery("?sort=due&f=mine,overdue&task=47&q=")).toBe("f=mine%2Coverdue&sort=due");
    expect(normalizeQuery("f=mine%2Coverdue&sort=due")).toBe(normalizeQuery("sort=due&f=mine,overdue"));
    expect(normalizeQuery("task=47")).toBe("");
  });
});

describe("повторяющиеся задачи", () => {
  it("месяц прибавляется с учётом коротких месяцев, следующий срок не раньше завтра", () => {
    expect(addMonth("2026-01-31")).toBe("2026-02-28");
    expect(addMonth("2026-10-15")).toBe("2026-11-15");
    expect(addMonth("2026-12-10")).toBe("2027-01-10");
    expect(nextRepeatDue("weekly", "2026-10-09", "2026-10-07")).toBe("2026-10-16");
    // Закрыли с опозданием на три недели: пропущенные недели не создаются
    expect(nextRepeatDue("weekly", "2026-10-09", "2026-10-30")).toBe("2026-11-06");
    expect(nextRepeatDue("monthly", "2026-10-31", "2026-10-31")).toBe("2026-11-30");
    // Срок сегодня: следующий период, а не сегодня
    expect(nextRepeatDue("weekly", "2026-10-07", "2026-10-07")).toBe("2026-10-14");
  });
});
