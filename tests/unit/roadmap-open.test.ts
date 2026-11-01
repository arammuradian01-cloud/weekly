// Этап 84: раскрытие групп целей на roadmap. Вид по умолчанию для группировки, разбор и сборка значения ?open=,
// нажатие на цель и на группу «Задачи без цели»
import { describe, expect, it } from "vitest";
import { NO_GOAL_KEY, OPEN_ALL, OPEN_NONE, openKeys, serializeOpen, toggleOpen } from "@/lib/tasks/roadmap-open";

const ALL = ["g1", "g2", "g3", NO_GOAL_KEY];
const set = (value: string | null, group: "goals" | "both" = "goals") => [...openKeys(value, group, ALL)];

describe("вид по умолчанию", () => {
  it("«По целям» всё свёрнуто, «Цели и задачи» всё раскрыто", () => {
    expect(set(null)).toEqual([]);
    expect(set("")).toEqual([]);
    expect(set(null, "both")).toEqual(ALL);
  });
});

describe("разбор значения из адреса", () => {
  it("all, none и список ключей", () => {
    expect(set(OPEN_ALL)).toEqual(ALL);
    expect(set(OPEN_ALL, "both")).toEqual(ALL);
    expect(set(OPEN_NONE, "both")).toEqual([]);
    expect(set("g2,nogoal")).toEqual(["g2", NO_GOAL_KEY]);
    // Порядок в наборе всегда как на экране, а не как в адресе
    expect(set("nogoal, g1")).toEqual(["g1", NO_GOAL_KEY]);
  });

  it("ключи, которых на экране нет, пропускаются", () => {
    // Цель ушла из-за фильтра «Чьи задачи»: лишней группы не появляется, адрес остаётся прежним
    expect(set("g1,ушедшая")).toEqual(["g1"]);
    expect(openKeys("g1", "goals", []).size).toBe(0);
  });
});

describe("сборка значения для адреса", () => {
  it("вид по умолчанию параметра не оставляет", () => {
    expect(serializeOpen(new Set(), "goals", ALL)).toBe(null);
    expect(serializeOpen(new Set(ALL), "both", ALL)).toBe(null);
  });

  it("всё раскрыто и всё свёрнуто пишутся словом", () => {
    expect(serializeOpen(new Set(ALL), "goals", ALL)).toBe(OPEN_ALL);
    expect(serializeOpen(new Set(), "both", ALL)).toBe(OPEN_NONE);
  });

  it("частичный набор пишется списком по порядку экрана", () => {
    expect(serializeOpen(new Set([NO_GOAL_KEY, "g1"]), "goals", ALL)).toBe("g1,nogoal");
  });

  it("групп на экране нет: параметра нет", () => {
    expect(serializeOpen(new Set(), "goals", [])).toBe(null);
    expect(serializeOpen(new Set(), "both", [])).toBe(null);
  });
});

describe("нажатие на группу", () => {
  it("«По целям»: первое нажатие раскрывает цель, второе сворачивает", () => {
    const after = toggleOpen(null, "goals", ALL, "g2");
    expect(after).toBe("g2");
    expect(toggleOpen(after, "goals", ALL, "g2")).toBe(null);
  });

  it("«Цели и задачи»: нажатие сворачивает одну цель, остальные остаются", () => {
    const after = toggleOpen(null, "both", ALL, "g2");
    expect(after).toBe("g1,g3,nogoal");
    expect(toggleOpen(after, "both", ALL, "g2")).toBe(null);
  });

  it("группа «Задачи без цели» сворачивается так же, как цель", () => {
    expect(toggleOpen(null, "goals", ALL, NO_GOAL_KEY)).toBe(NO_GOAL_KEY);
    expect(toggleOpen(OPEN_ALL, "goals", ALL, NO_GOAL_KEY)).toBe("g1,g2,g3");
  });

  it("раскрыли все цели по одной: в адрес уходит all", () => {
    let value: string | null = null;
    for (const key of ALL) value = toggleOpen(value, "goals", ALL, key);
    expect(value).toBe(OPEN_ALL);
  });

  it("свернули все цели по одной: в адрес уходит none", () => {
    let value: string | null = null;
    for (const key of ALL) value = toggleOpen(value, "both", ALL, key);
    expect(value).toBe(OPEN_NONE);
  });
});
