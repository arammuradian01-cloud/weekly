import { describe, expect, it } from "vitest";
import { goalProgress, parseGoalNumber, progressLabel } from "@/lib/goals/progress";

// Прогресс цели по числам (этап 33): значения вписаны текстом как в борде

describe("число из текста цели", () => {
  it("числа, разряды, запятая, проценты, множители и единицы", () => {
    expect(parseGoalNumber("29,25 млн")).toEqual({ value: 29_250_000, unit: "plain" });
    expect(parseGoalNumber("29.25 млн")).toEqual({ value: 29_250_000, unit: "plain" });
    expect(parseGoalNumber("1 500 000")).toEqual({ value: 1_500_000, unit: "plain" });
    expect(parseGoalNumber("1 500 000 руб.")).toEqual({ value: 1_500_000, unit: "plain" });
    expect(parseGoalNumber("15%")).toEqual({ value: 15, unit: "pct" });
    expect(parseGoalNumber("+20 %")).toEqual({ value: 20, unit: "pct" });
    expect(parseGoalNumber("12,5%")).toEqual({ value: 12.5, unit: "pct" });
    expect(parseGoalNumber("2 п.п.")).toEqual({ value: 2, unit: "pct" });
    expect(parseGoalNumber("до 15%")).toEqual({ value: 15, unit: "pct" });
    expect(parseGoalNumber("20 000 полисов")).toEqual({ value: 20_000, unit: "plain" });
    expect(parseGoalNumber("300 тыс")).toEqual({ value: 300_000, unit: "plain" });
    expect(parseGoalNumber("-5")).toEqual({ value: -5, unit: "plain" });
  });

  it("текст, сроки, даты и диапазоны числом не читаются", () => {
    for (const t of ["P&L к 15.12", "до 15.12", "15.12.2026", "Скоринг на проде", "10-12%", "x2", "", null, "рост в 2 раза", "ОСАГО 15%"]) {
      expect(parseGoalNumber(t), String(t)).toBeNull();
    }
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
