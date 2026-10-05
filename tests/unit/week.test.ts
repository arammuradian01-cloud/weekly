import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatWeekRange,
  isoWeekOf,
  moscowDate,
  reportingWeek,
  weeklyDeadline,
} from "@/lib/week";

const deadline = { weekday: 1, time: "18:00" };
const at = (iso: string) => new Date(iso);

describe("недели по ISO", () => {
  it("21-27.09.2026 это неделя 39, как в ТЗ", () => {
    expect(isoWeekOf({ year: 2026, month: 9, day: 21 }).week).toBe(39);
    expect(isoWeekOf({ year: 2026, month: 9, day: 27 }).week).toBe(39);
    expect(isoWeekOf({ year: 2026, month: 9, day: 28 }).week).toBe(40);
  });

  it("первые дни января могут относиться к прошлому году", () => {
    const w = isoWeekOf({ year: 2027, month: 1, day: 1 });
    expect(w).toMatchObject({ year: 2026, week: 53 });
    expect(isoWeekOf({ year: 2026, month: 1, day: 1 })).toMatchObject({ year: 2026, week: 1 });
  });

  it("дата считается по Москве, а не по UTC", () => {
    // 21:30 UTC в воскресенье это уже 00:30 понедельника в Москве
    expect(moscowDate(at("2026-10-04T21:30:00Z"))).toEqual({ year: 2026, month: 10, day: 5 });
  });

  it("подписывает диапазон недели по-русски", () => {
    expect(formatWeekRange(isoWeekOf({ year: 2026, month: 10, day: 1 }))).toBe("28 сентября - 4 октября");
  });
});

describe("срок сдачи и отчётная неделя", () => {
  it("срок weekly за неделю 40: понедельник 5 октября 18:00 по Москве", () => {
    const week = isoWeekOf({ year: 2026, month: 10, day: 1 });
    expect(weeklyDeadline(week, deadline).toISOString()).toBe("2026-10-05T15:00:00.000Z");
  });

  it("в воскресенье вечером пишем weekly за текущую неделю", () => {
    expect(reportingWeek(at("2026-10-04T18:00:00Z"), deadline).week).toBe(40);
  });

  it("в понедельник до срока и во вторник до встречи отчётная неделя всё ещё прошлая", () => {
    expect(reportingWeek(at("2026-10-05T07:00:00Z"), deadline).week).toBe(40);
    expect(reportingWeek(at("2026-10-06T14:59:00Z"), deadline).week).toBe(40);
  });

  it("после вторника 18:00 отчётной становится новая неделя", () => {
    expect(reportingWeek(at("2026-10-06T15:01:00Z"), deadline).week).toBe(41);
  });
});

describe("длительность", () => {
  it("округляет до минут и пишет по-человечески", () => {
    expect(formatDuration(18 * 60_000)).toBe("18 мин");
    expect(formatDuration((5 * 60 + 12) * 60_000)).toBe("5 ч 12 мин");
    expect(formatDuration((2 * 24 + 4) * 3600_000)).toBe("2 д 4 ч");
  });
});
