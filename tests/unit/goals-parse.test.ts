// Этап 17: разбор таблицы целей из вкладок целей Bord и простой таблицы
import { describe, expect, it } from "vitest";
import { normalizeQuarter, quarterOf, readGoalsTable, resultOf } from "@/lib/goals/parse";

describe("квартал и итог", () => {
  it("квартал в любом привычном виде", () => {
    expect(normalizeQuarter("Q4 2026")).toBe("2026-Q4");
    expect(normalizeQuarter("Запланировано на Q1 2027")).toBe("2027-Q1");
    expect(normalizeQuarter("4 кв. 2026")).toBe("2026-Q4");
    expect(normalizeQuarter("IV квартал 2026")).toBe("2026-Q4");
    expect(normalizeQuarter("2026-Q3")).toBe("2026-Q3");
    expect(normalizeQuarter("Q4'26")).toBe("2026-Q4");
    expect(normalizeQuarter("октябрь")).toBeNull();
    expect(quarterOf("2026-10-07")).toBe("2026-Q4");
  });

  it("итог квартала словами из колонки «Закрытие»", () => {
    expect(resultOf("")).toBe("IN_PROGRESS");
    expect(resultOf("Соответствует")).toBe("ACHIEVED");
    expect(resultOf("не соответствует")).toBe("MISSED");
    expect(resultOf("Частично")).toBe("PARTIAL");
    expect(resultOf("Отмена по решению 17.09")).toBe("DROPPED");
  });
});

describe("вкладка целей из борда лидера", () => {
  const TAB = [
    ["Цели PO OSAGO", "", "", "", "", "", ""],
    ["№", "Направление", "Сквозная цель", "Запланировано", "Целевые", "Start", "Как проверяем", "Закрытие"],
    ["Запланировано на Q3 2026"],
    ["1", "ОСАГО", "", "Запустить подписку", "100% полисов", "0", "Отчёт продаж", "Соответствует"],
    ["Запланировано на Q4 2026"],
    ["1", "ОСАГО", "S6", "Подписка ОСАГО с Альфой", "P&L к 15.12", "", "Дашборд подписки", ""],
    ["2", "ОСАГО", "S4", "Согласия по одной методике", "73%", "61%", "Identity", ""],
    ["Договорённости"],
    ["3", "", "", "Это не цель", "", "", "", ""],
  ]
    .map((r) => r.join("\t"))
    .join("\n");

  it("разделы задают квартал, договорённости и ниже не читаются", () => {
    const { rows, problems } = readGoalsTable(TAB, "2026-Q4");
    expect(problems).toEqual([]);
    expect(rows.map((r) => [r.quarter, r.code, r.title])).toEqual([
      ["2026-Q3", "1", "Запустить подписку"],
      ["2026-Q4", "1", "Подписка ОСАГО с Альфой"],
      ["2026-Q4", "2", "Согласия по одной методике"],
    ]);
    expect(rows[0]!.result).toBe("ACHIEVED");
    expect(rows[2]).toMatchObject({ target: "73%", base: "61%", metric: "Identity", parent: "S4" });
  });

  it("простая таблица с владельцем, командой и родительской целью; ошибки по строкам", () => {
    const text = [
      "ID;Квартал;Команда;Владелец;Цель;Метрика;База;Целевое значение;Родительская цель;Ссылка",
      "D1;Q4 2026;Топ-команда;Мурадян Арам;Маржа департамента;Маржа, млн ₽;120;150;;https://docs.google.com/x",
      "P1;Q4 2026;Управление развития продуктов;Рева Тарас;Конверсия расчёт в покупку;CR b2c;22%;24%;D1;",
      "P1;Q4 2026;Управление развития продуктов;;Дубль;;;;;",
      ";кв;;;Без квартала;;;;;",
      ";;;;;;;10;;ftp://x",
    ].join("\n");
    const { rows, problems } = readGoalsTable(text, "2026-Q4");
    expect(rows.map((r) => r.code)).toEqual(["D1", "P1", "P1", ""]);
    expect(rows[1]).toMatchObject({ owner: "Рева Тарас", team: "Управление развития продуктов", parent: "D1", base: "22%", target: "24%" });
    expect(problems.map((p) => p.text).join(" | ")).toMatch(/P1 за Q4 2026 уже есть в строке 3/);
    expect(problems.map((p) => p.text).join(" | ")).toMatch(/Квартал «кв» не понят/);
    expect(problems.map((p) => p.text).join(" | ")).toMatch(/Нет названия цели/);
  });

  it("без колонки цели понятная ошибка", () => {
    expect(readGoalsTable("ФИО\tДолжность\nИванов\tАналитик", "2026-Q4").problems[0]!.text).toMatch(/Нет колонки цели/);
  });
});

describe("строка цели с кварталом в названии", () => {
  it("не считается разделом", () => {
    const text = ["№\tЗапланировано\tЦелевые", "Запланировано на Q4 2026", "3\tПодготовить запуск к Q1 2027\t", "4\tЕщё цель\t10"].join("\n");
    const { rows } = readGoalsTable(text, "2026-Q4");
    expect(rows.map((r) => [r.code, r.quarter])).toEqual([
      ["3", "2026-Q4"],
      ["4", "2026-Q4"],
    ]);
  });
});
