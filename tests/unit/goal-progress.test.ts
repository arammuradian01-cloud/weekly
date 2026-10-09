import { describe, expect, it } from "vitest";
import { factProblem, goalProgress, measurableTarget, parseGoalNumber, progressLabel, reached } from "@/lib/goals/progress";

// Прогресс цели по числам (этап 33): значения вписаны текстом как в борде

describe("число из текста цели", () => {
  it("числа, разряды, запятая, проценты, множители и единицы", () => {
    expect(parseGoalNumber("29,25 млн")).toMatchObject({ value: 29_250_000, unit: "plain" });
    expect(parseGoalNumber("29.25 млн")).toMatchObject({ value: 29_250_000, unit: "plain" });
    expect(parseGoalNumber("1 500 000")).toMatchObject({ value: 1_500_000, unit: "plain" });
    expect(parseGoalNumber("1 500 000 руб.")).toMatchObject({ value: 1_500_000, unit: "plain" });
    expect(parseGoalNumber("15%")).toMatchObject({ value: 15, unit: "pct" });
    expect(parseGoalNumber("+20 %")).toMatchObject({ value: 20, unit: "pct" });
    expect(parseGoalNumber("12,5%")).toMatchObject({ value: 12.5, unit: "pct" });
    expect(parseGoalNumber("2 п.п.")).toMatchObject({ value: 2, unit: "pct" });
    expect(parseGoalNumber("до 15%")).toMatchObject({ value: 15, unit: "pct" });
    expect(parseGoalNumber("20 000 полисов")).toMatchObject({ value: 20_000, unit: "plain" });
    expect(parseGoalNumber("300 тыс")).toMatchObject({ value: 300_000, unit: "plain" });
    expect(parseGoalNumber("-5")).toMatchObject({ value: -5, unit: "plain" });
  });

  it("текст, сроки, даты и диапазоны числом не читаются", () => {
    for (const t of ["P&L к 15.12", "до 15.12", "15.12", "15.12.2026", "Скоринг на проде", "10-12%", "x2", "", null, "рост в 2 раза", "ОСАГО 15%", "от 10 до 12"]) {
      expect(parseGoalNumber(t), String(t)).toBeNull();
    }
  });
});

describe("сдвиг, множители и прочерки", () => {
  it("число с точкой и множителем не дата", () => {
    expect(parseGoalNumber("до 1.5 млн")).toMatchObject({ value: 1_500_000 });
    expect(parseGoalNumber("1.5")).toMatchObject({ value: 1.5 });
  });

  it("множитель только у части значений: остальные в нём же, если так ближе", () => {
    // Целевое «150» при метрике в миллионах, факт вписали «141 млн»
    expect(goalProgress("120", "150", "141 млн")?.share).toBeCloseTo(0.7, 9);
    // Целевое в миллионах, факт без множителя
    expect(goalProgress(null, "29,25 млн", "14,6")?.share).toBeCloseTo(14.6 / 29.25, 9);
    // Факт уже в рублях
    expect(goalProgress(null, "29,25 млн", "14 625 000")?.share).toBeCloseTo(0.5, 9);
  });

  it("целевое сдвигом от базы: п.п., процент роста, плюс к базе", () => {
    expect(goalProgress("13%", "+2 п.п.", "15%")?.share).toBeCloseTo(1, 9);
    expect(goalProgress("70%", "-5 п.п.", "67,5%")?.share).toBeCloseTo(0.5, 9);
    expect(goalProgress("120", "+20%", "132")?.share).toBeCloseTo(0.5, 9);
    expect(goalProgress("120 млн", "+30", "135 млн")?.share).toBeCloseTo(0.5, 9);
    // Без базы сдвиг не посчитать; «+20%» при базе в процентах неясен
    expect(measurableTarget(null, "+2 п.п.")).toBe(false);
    expect(measurableTarget("10%", "+20%")).toBe(false);
    // Отрицательное без п.п. это значение: убыток -10 сократить до -5
    expect(goalProgress("-10", "-5", "-7,5")?.share).toBeCloseTo(0.5, 9);
  });

  it("прочерк или «нет» в базе: путь от нуля", () => {
    for (const base of ["-", "—", "нет", "н/д"]) expect(goalProgress(base, "100", "40")?.share, base).toBeCloseTo(0.4, 9);
  });

  it("проверка факта: не число, другие единицы, расхождение в тысячу раз", () => {
    expect(factProblem("120", "150", "почти")).toMatch(/впишите факт числом, например 141/);
    expect(factProblem("20%", "24%", "22")).toMatch(/тоже в процентах/);
    expect(factProblem("120", "150", "141%")).toMatch(/без знака процента/);
    expect(factProblem(null, "29,25 млн", "29 250 000 000 000")).toMatch(/больше чем в 1000 раз/);
    expect(factProblem("120", "150", "141 млн")).toBeNull();
    expect(factProblem(null, "Скоринг на проде", "на тесте")).toBeNull();
  });

  it("округление: 99,96% это выполнено, крошечный минус это 0%", () => {
    expect(progressLabel(goalProgress("0", "10000", "9996"))).toBe("100%");
    expect(reached(goalProgress("0", "10000", "9996"))).toBe(true);
    expect(progressLabel(goalProgress("0", "100000", "-0,01"))).toBe("0%");
  });
});

describe("второй круг проверки", () => {
  it("маленький факт при целевом в тысячах не поднимается", () => {
    expect(goalProgress(null, "1,5 тыс полисов", "40")?.share).toBeCloseTo(40 / 1500, 9);
    expect(goalProgress(null, "1,5 тыс полисов", "48")?.share).toBeCloseTo(48 / 1500, 9);
    expect(goalProgress(null, "29,25 млн", "14,6")?.share).toBeCloseTo(14.6 / 29.25, 9);
  });

  it("третий круг: факт со знаком это значение, большой целевой не поднимает маленький факт", () => {
    expect(factProblem(null, "5 млн", "-2 млн")).toBeNull();
    expect(goalProgress(null, "5 млн", "-2 млн")?.share).toBeCloseTo(-0.4, 9);
    expect(goalProgress("2 млн", "5 млн", "-1 млн")?.share).toBeCloseTo(-1, 9);
    expect(goalProgress(null, "15%", "+12%")?.share).toBeCloseTo(0.8, 9);
    expect(goalProgress(null, "1,5 млн полисов", "1 200")?.share).toBeCloseTo(1200 / 1_500_000, 12);
    expect(factProblem(null, "150 млн", "1")).toMatch(/больше чем в 1000 раз/);
  });

  it("факт в п.п. это тоже сдвиг от базы", () => {
    expect(goalProgress("13%", "+2 п.п.", "+1 п.п.")?.share).toBeCloseTo(0.5, 9);
  });

  it("отрицательный сдвиг от положительной базы: сократить на 500 тыс", () => {
    expect(goalProgress("3 млн", "-500 тыс", "2,8 млн")?.share).toBeCloseTo(0.4, 9);
  });

  it("десятичные с точкой, «к» перед числом, узкие пробелы", () => {
    expect(parseGoalNumber("0.05")).toMatchObject({ value: 0.05 });
    expect(parseGoalNumber("1.10")).toMatchObject({ value: 1.1 });
    expect(parseGoalNumber("к 2.5 млрд")).toMatchObject({ value: 2_500_000_000 });
    expect(parseGoalNumber("1\u202f500\u2009000")).toMatchObject({ value: 1_500_000 });
    expect(parseGoalNumber("01.10")).toBeNull();
  });

  it("база текстом: цель числовая, факт проверяется, прогресса нет", () => {
    expect(measurableTarget("новый продукт", "29 млн")).toBe(true);
    expect(factProblem("новый продукт", "29 млн", "почти")).toMatch(/впишите факт числом/);
    expect(goalProgress("новый продукт", "29 млн", "10 млн")).toBeNull();
  });

  it("зелёная полоса там же, где подпись «100%»", () => {
    const p = goalProgress("0", "1000", "996");
    expect(progressLabel(p)).toBe("100%");
    expect(reached(p)).toBe(true);
    expect(reached(goalProgress("0", "1000", "994"))).toBe(false);
  });
});

describe("прогресс от базы к целевому", () => {
  it("рост: доля пути от базы", () => {
    const p = goalProgress("120", "150", "141");
    expect(p?.share).toBeCloseTo(0.7, 9);
    expect(p?.down).toBe(false);
    expect(progressLabel(p)).toBe("70%");
  });

  it("без базы путь от нуля, разные множители сравниваются", () => {
    expect(goalProgress(null, "29,25 млн", "14 625 000")?.share).toBeCloseTo(0.5, 9);
  });

  it("снижение: целевое меньше базы", () => {
    const p = goalProgress("30%", "20%", "25%");
    expect(p?.share).toBeCloseTo(0.5, 9);
    expect(p?.down).toBe(true);
  });

  it("перевыполнение и откат видны", () => {
    expect(progressLabel(goalProgress("100", "200", "250"))).toBe("150%");
    expect(progressLabel(goalProgress("100", "200", "95"))).toBe("-5%");
    expect(progressLabel(goalProgress("0", "100", "4,5"))).toBe("4,5%");
  });

  it("нет прогресса: разные единицы, текстовая цель, нет факта, целевое равно базе", () => {
    expect(goalProgress("10%", "15%", "12")).toBeNull();
    expect(goalProgress(null, "P&L к 15.12", "запущено")).toBeNull();
    expect(goalProgress("10", "20", null)).toBeNull();
    expect(goalProgress("10", "10", "12")).toBeNull();
    expect(goalProgress("старт", "20", "12")).toBeNull();
    expect(progressLabel(null)).toBeNull();
  });
});
