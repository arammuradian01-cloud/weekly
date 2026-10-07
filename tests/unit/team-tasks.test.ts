// Этап 16: кто принимает предложенную задачу и сколько дней задача была в каждом статусе
import { describe, expect, it } from "vitest";
import { permissions } from "@/lib/tasks/rules";
import { statusSpans } from "@/lib/tasks/changes";
import type { Task } from "@/domain/types";

const task = (patch: Partial<Task>): Task => ({
  number: 1,
  title: "Задача",
  outcome: "Результат",
  owner: "ivanova",
  coExecutors: [],
  direction: "department",
  priority: "unset",
  status: "proposed",
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
  createdBy: "alisa",
  createdAt: "2026-10-05",
  updatedAt: "2026-10-05",
  team: "sector",
  ...patch,
});

describe("предложенная задача из другой команды", () => {
  it("принимает адресат или его руководитель, автор и посторонний нет", () => {
    expect(permissions(task({}), { slug: "ivanova" }).confirm).toBe(true);
    expect(permissions(task({}), { slug: "tokov", people: ["ivanova"] }).confirm).toBe(true);
    expect(permissions(task({}), { slug: "alisa" }).confirm).toBe(false);
    expect(permissions(task({}), { slug: "petrov", people: ["alisa"] }).confirm).toBe(false);
    // Руководитель команды задачи, как и раньше
    expect(permissions(task({}), { slug: "antonov", leads: ["sector"] }).confirm).toBe(true);
  });

  it("в топ-команде с этапа 21 тоже решает адресат, посторонний нет, режим управления может за него", () => {
    expect(permissions(task({ team: "top", owner: "reva" }), { slug: "reva" }).confirm).toBe(true);
    expect(permissions(task({ team: "top", owner: "reva" }), { slug: "fatyanov" }).confirm).toBe(false);
    expect(permissions(task({ team: "top", owner: "reva" }), { slug: "golovkin", management: "ADMIN" }).confirm).toBe(true);
  });
});

describe("история статусов", () => {
  const day = (d: number) => new Date(Date.UTC(2026, 9, d, 9));
  it("дни в каждом статусе от создания до сейчас", () => {
    const spans = statusSpans(
      day(1),
      [
        { at: day(4), after: "Требует уточнений" },
        { at: day(6), after: "В работе" },
        { at: day(9), after: "Выполнена. Релиз вышел" },
      ],
      "done",
      day(10),
    );
    expect(spans).toEqual([
      { status: "in-progress", label: "В работе", days: 6, current: false },
      { status: "clarify", label: "Требует уточнений", days: 2, current: false },
      { status: "done", label: "Выполнена", days: 1, current: true },
    ]);
  });

  it("предложенная задача начинается с «Предложена»; расхождение с нынешним статусом берёт нынешний", () => {
    const spans = statusSpans(day(1), [{ at: day(2), after: "В работе" }], "clarify", day(5), "proposed");
    expect(spans.map((s) => [s.status, s.days, s.current])).toEqual([
      ["proposed", 1, false],
      ["clarify", 3, true],
    ]);
  });
});
