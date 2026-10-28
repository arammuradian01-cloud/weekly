// Этап 84: сборка подсказки по задаче на карте сроков. Заголовок с номером, описание, срок, состояние и строки
// под ними
import { describe, expect, it } from "vitest";
import { taskTip } from "@/lib/tasks/task-tip";
import type { Task } from "@/domain/types";

const TODAY = "2026-10-21";

const task = (patch: Partial<Task> = {}) =>
  ({
    number: 412,
    title: "Подписка ОСАГО: запустить продление по карте",
    outcome: "",
    owner: "reva",
    coExecutors: [],
    direction: "osago",
    priority: "medium",
    status: "in-progress",
    state: "on-track",
    where: "",
    due: "2026-10-30",
    createdAt: "2026-10-01",
    ...patch,
  }) as unknown as Task;

const row = (tip: ReturnType<typeof taskTip>, label: string) => tip.rows.find((r) => r.label === label)?.text;

describe("заголовок и описание", () => {
  it("номер и полное название, описание из ожидаемого результата", () => {
    const tip = taskTip(task({ outcome: "  Продление\nработает у всех партнёров  " }), TODAY);
    expect(tip.title).toBe("412. Подписка ОСАГО: запустить продление по карте");
    // Переводы строк и лишние пробелы в подсказке схлопываются
    expect(tip.description).toBe("Продление работает у всех партнёров");
  });

  it("без ожидаемого результата описания нет", () => {
    expect(taskTip(task(), TODAY).description).toBe(null);
    expect(taskTip(task({ outcome: "   " }), TODAY).description).toBe(null);
  });
});

describe("срок", () => {
  it("без начала только срок, с началом оба края полосы", () => {
    expect(row(taskTip(task(), TODAY), "Срок")).toBe("до 30 окт");
    expect(row(taskTip(task({ start: "2026-10-12" }), TODAY), "Срок")).toBe("с 12 окт до 30 окт");
  });

  it("просроченная задача: число дней словами", () => {
    expect(row(taskTip(task({ due: "2026-10-19" }), TODAY), "Срок")).toBe("до 19 окт, просрочена на 2 дня");
  });
});

describe("состояние", () => {
  it("статус, риск и важность одной строкой", () => {
    expect(row(taskTip(task(), TODAY), "Состояние")).toBe("В работе");
    expect(row(taskTip(task({ state: "at-risk", priority: "high" }), TODAY), "Состояние")).toBe("В работе, есть риск, важная");
    expect(row(taskTip(task({ priority: "critical" }), TODAY), "Состояние")).toBe("В работе, критичная");
  });

  it("чем заблокирована и что вернёт в график", () => {
    expect(row(taskTip(task({ state: "blocked", blockedBy: "Ждём доступ" }), TODAY), "Чем заблокирована")).toBe("Ждём доступ");
    expect(row(taskTip(task({ state: "at-risk", riskNote: "Подрядчик выйдет в среду" }), TODAY), "Что вернёт в график")).toBe("Подрядчик выйдет в среду");
    // Пояснение к риску не показывается, когда задача в графике
    expect(row(taskTip(task({ riskNote: "Подрядчик" }), TODAY), "Что вернёт в график")).toBe(undefined);
  });

  it("предложенная задача с прошедшим сроком помечается", () => {
    expect(row(taskTip(task({ status: "proposed", due: "2026-10-19" }), TODAY), "Предложена")).toBe("срок уже прошёл");
    expect(row(taskTip(task({ status: "proposed" }), TODAY), "Предложена")).toBe(undefined);
  });
});

describe("ответственный и где сейчас", () => {
  it("полное имя, «Где сейчас» только когда текст есть", () => {
    expect(row(taskTip(task(), TODAY), "Ответственный")).toBe("Рева Тарас");
    expect(row(taskTip(task(), TODAY), "Где сейчас")).toBe(undefined);
    expect(row(taskTip(task({ where: "У юристов" }), TODAY), "Где сейчас")).toBe("У юристов");
  });
});

describe("текст для диктора", () => {
  it("собирает заголовок, описание и все строки", () => {
    const tip = taskTip(task({ outcome: "Продление работает" }), TODAY);
    expect(tip.speech).toContain("412. Подписка ОСАГО");
    expect(tip.speech).toContain("Продление работает");
    expect(tip.speech).toContain("Срок: до 30 окт");
    expect(tip.speech).toContain("Ответственный: Рева Тарас");
  });
});
