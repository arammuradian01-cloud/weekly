// Этап 24: разбор недельного отчёта и правила прогноза без базы
import { describe, expect, it } from "vitest";
import { cellDate, cellNumber, formatDelta, formatValue, guessUnit, parseReport, rowLabel } from "@/lib/numbers/parse";
import { addMonths, deltaPct, formatForecast, formatPct, monthLabel, reasonNeeded } from "@/lib/forecast/codes";
import type { Grid } from "@/lib/sheet/client";

const grid: Grid = [
  ["2.0"],
  ["", "", "", "", "", "Week", "", 37, 36],
  ["", "", "", "", "", "Date from", "", "2026-09-07 00:00:00", 46265],
  ["", "", "", "", "", "Date to", "", "2026-09-13 00:00:00", 46271],
  [],
  ["", "TRAFFIC", "TOTAL", "", "OSAGO", "OSAGO", "", 504337, 465286],
  ["", "", "", "", "", "for information:", "", "", ""],
  ["", "", "", "", "", "OSAGO", "", 108.48, 102.33],
  ["", "REVENUE", "Web", "OSAGO", "OSAGO", "WEB", "", 36.08, 34.75],
  ["", "REVENUE", "App", "OSAGO", "OSAGO", "APP", "", "", "#REF!"],
  ["", "", "", "", "", "OSAGO", "", 95667, 91543],
  ["", "TARGET ACTIONS", "Web", "", "OSAGO", "WEB", "", 47639, 45970],
  ["", "", "", "", "", "CR, %: WAU ---> TA", "", 0.0746, 0.1037],
];

describe("разбор недельного отчёта", () => {
  it("находит недели по шапке, строки по ключу, итогам даёт статью снизу, пустые и ошибки это null", () => {
    const r = parseReport(grid);
    expect(r.weeks.map((w) => [w.number, w.from, w.to])).toEqual([
      [37, "2026-09-07", "2026-09-13"],
      [36, "2026-08-31", "2026-09-06"],
    ]);
    const keys = r.rows.map((x) => x.key);
    expect(keys).toContain("TRAFFIC|TOTAL||OSAGO|OSAGO");
    // Итог «OSAGO» под выручкой и итог «OSAGO» под целевыми действиями различаются статьёй
    expect(keys).toContain("REVENUE||||OSAGO");
    expect(keys).toContain("TARGET ACTIONS||||OSAGO");
    const revenue = r.rows.find((x) => x.key === "REVENUE||||OSAGO")!;
    expect(revenue.values).toEqual([
      { week: "2026-09-07", value: 108.48 },
      { week: "2026-08-31", value: 102.33 },
    ]);
    // Строка без единого числа не попадает, ошибка формулы и пустая ячейка дают null, но строка есть, если число где-то есть
    expect(keys.some((k) => k.includes("for information"))).toBe(false);
    expect(r.rows.find((x) => x.key.startsWith("REVENUE|App"))).toBeUndefined();
    // У последнего итога нет строки с ключом ниже: статья пустая, но строка не теряется
    expect(r.rows.find((x) => x.key === "||||CR, %: WAU ---> TA")?.values[0]!.value).toBe(0.0746);
  });

  it("повторяющиеся ключи получают хвост, подпись без повторов, единицы угадываются", () => {
    const g: Grid = [
      ["", "", "", "", "", "Week", "", 1],
      ["", "", "", "", "", "Date from", "", "2026-01-05"],
      ["", "A", "x", "", "p", "p", "", 1],
      ["", "A", "x", "", "p", "p", "", 2],
    ];
    const r = parseReport(g);
    expect(r.rows.map((x) => x.key)).toEqual(["A|x||p|p", "A|x||p|p#2"]);
    expect(rowLabel({ article: "REVENUE", iface: "Web", product: "OSAGO", mapping: "OSAGO", comment: "WEB" })).toBe("REVENUE / Web / OSAGO");
    expect(guessUnit({ article: "REVENUE", comment: "WEB", values: [{ week: "2026-01-05", value: 36.1 }] })).toBe("mln");
    expect(guessUnit({ article: "TRAFFIC", comment: "OSAGO", values: [{ week: "2026-01-05", value: 504337 }] })).toBe("count");
    expect(guessUnit({ article: "", comment: "CR, %: WAU ---> TA", values: [{ week: "2026-01-05", value: 0.07 }] })).toBe("pct");
    expect(() => parseReport([["нет шапки"]])).toThrow(/не недельный отчёт/);
  });

  it("ячейки: даты серийные и текстом, числа с запятой, форматы и изменение", () => {
    expect(cellDate(46265)).toBe("2026-08-31");
    expect(cellDate("07.09.2026")).toBe("2026-09-07");
    expect(cellDate("abc")).toBeNull();
    expect(cellNumber("1 234,5")).toBe(1234.5);
    expect(cellNumber("#N/A")).toBeNull();
    expect(formatValue(504337, "count")).toBe("504 337");
    expect(formatValue(108.48, "mln")).toBe("108,5 млн");
    expect(formatValue(0.0746, "pct")).toBe("7,5%");
    expect(formatDelta(504337, 465286, "count")).toBe("+8,4%");
    expect(formatDelta(0.07, 0.1, "pct")).toBe("-3 п.п.");
    expect(formatDelta(1, null, "count")).toBeNull();
  });
});

describe("прогноз: правила", () => {
  it("месяцы, отклонения и когда нужна причина", () => {
    expect(monthLabel("2026-10")).toBe("октябрь 2026");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(deltaPct(96, 100)).toBe(-4);
    expect(deltaPct(96, null)).toBeNull();
    expect(formatPct(-4)).toBe("-4%");
    expect(formatPct(4.25)).toBe("+4,3%");
    expect(reasonNeeded(100, 101)).toBe(false);
    expect(reasonNeeded(96, 100)).toBe(true);
    expect(reasonNeeded(96, null)).toBe(false);
    expect(formatForecast(468, "mln")).toBe("468 млн");
    expect(formatForecast(423628, "count")).toBe("423 628");
  });
});
