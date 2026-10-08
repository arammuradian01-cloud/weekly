import { describe, expect, it } from "vitest";
import {
  addToBox,
  boxTotal,
  closesOn,
  cleanRemove,
  dayLabel,
  isMonth,
  isOpen,
  monthLabel,
  openMonths,
  promptMonth,
  ratersOf,
  resultsVisible,
  shiftMonth,
  summarize,
  validScore,
} from "@/lib/meeting-rating/rules";

// Анонимная оценка встреч (этап 29): окна опроса, порог в три ответа, порядок комментариев

describe("окно опроса", () => {
  it("месяц открыт весь месяц и 7 дней следующего; итог виден с 8 числа", () => {
    expect(openMonths("2026-10-08")).toEqual(["2026-10"]);
    expect(openMonths("2026-10-07")).toEqual(["2026-09", "2026-10"]);
    expect(openMonths("2026-01-03")).toEqual(["2025-12", "2026-01"]);
    expect(isOpen("2026-09", "2026-10-07")).toBe(true);
    expect(isOpen("2026-09", "2026-10-08")).toBe(false);
    expect(closesOn("2026-12")).toBe("2027-01-07");
    expect(resultsVisible("2026-09", "2026-10-07")).toBe(false);
    expect(resultsVisible("2026-09", "2026-10-08")).toBe(true);
    expect(resultsVisible("2026-10", "2026-10-31")).toBe(false);
  });

  it("напоминание на главной: с 20 числа о текущем месяце, в первые 7 дней о прошлом, в середине месяца нет", () => {
    expect(promptMonth("2026-10-20")).toBe("2026-10");
    expect(promptMonth("2026-10-31")).toBe("2026-10");
    expect(promptMonth("2026-11-05")).toBe("2026-10");
    expect(promptMonth("2026-10-12")).toBeNull();
  });

  it("месяцы и подписи", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-10", -14)).toBe("2025-08");
    expect(monthLabel("2026-10")).toBe("октябрь 2026");
    expect(dayLabel("2026-11-07")).toBe("7 ноября");
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-1")).toBe(false);
    expect(isMonth("2026-01")).toBe(true);
  });
});

describe("ответы и итог", () => {
  it("оценка только целая от 1 до 5, текст без длинного тире и не длиннее 500 знаков", () => {
    expect(validScore(5)).toBe(5);
    expect(validScore("3")).toBe(3);
    expect(validScore(0)).toBeNull();
    expect(validScore(4.5)).toBeNull();
    expect(validScore("пять")).toBeNull();
    expect(cleanRemove("  длинные  отчёты — по кругу ")).toBe("длинные отчёты - по кругу");
    expect(cleanRemove("а".repeat(800))).toHaveLength(500);
  });

  it("меньше трёх ответов: ни средней, ни распределения, ни комментариев", () => {
    const s = summarize({ counts: [1, 0, 0, 0, 1], remove: ["всё"] });
    expect(s).toEqual({ answered: 2, hidden: true, average: null, counts: null, remove: [] });
  });

  it("от трёх ответов: средняя с одним знаком, сколько раз каждая оценка, комментарии по алфавиту без пустых", () => {
    const s = summarize({ counts: [0, 1, 0, 2, 1], remove: ["статусы по кругу", " ", "длинные отчёты"] });
    expect(s.hidden).toBe(false);
    expect(s.average).toBe(3.8);
    expect(s.counts).toEqual([0, 1, 0, 2, 1]);
    expect(s.remove).toEqual(["длинные отчёты", "статусы по кругу"]);
  });

  it("кто сам ответил, видит итог от четырёх ответов: свой ответ он знает", () => {
    const box = { counts: [0, 0, 1, 1, 1], remove: ["а"] };
    expect(summarize(box).hidden).toBe(false);
    expect(summarize(box, { selfVoted: true }).hidden).toBe(true);
    expect(summarize({ ...box, counts: [1, 0, 1, 1, 1] }, { selfVoted: true }).hidden).toBe(false);
  });

  it("урна: ответ прибавляет счётчик, текст встаёт в случайное место, пустой текст не пишется", () => {
    let box = { counts: [0, 0, 0, 0, 0], remove: [] as string[] };
    box = addToBox(box, 4, "первый", () => 0);
    box = addToBox(box, 4, "второй", () => 0);
    box = addToBox(box, 2, "  ", () => 0.5);
    box = addToBox(box, 5, "третий", () => 0.99);
    expect(box.counts).toEqual([0, 1, 0, 2, 1]);
    expect(boxTotal(box)).toBe(4);
    // Порядок задаёт случай, а не порядок ответов
    expect(box.remove).toEqual(["второй", "первый", "третий"]);
    expect(addToBox(box, 1, "x", () => 0.4).remove).toEqual(["второй", "x", "первый", "третий"]);
  });

  it("оценивают участники команды, кроме руководителя", () => {
    expect(ratersOf({ leaderId: "reva", members: ["antonov", "reva", "tokov", "antonov"] })).toEqual(["antonov", "tokov"]);
  });
});
