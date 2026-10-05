import { describe, expect, it } from "vitest";
import { buildPrototypeData } from "@/prototype/data";
import { addDays, diffDays, plural } from "@/prototype/dates";
import { isDueThisWeek, isMine, isOverdue, isStale, myTasksOrder, overdueDays, permissions, statusNeedsNote } from "@/prototype/rules";
import type { Task } from "@/prototype/types";

const TODAY = "2026-10-05"; // понедельник, неделя 41
const data = buildPrototypeData(TODAY, 40);
const task = (n: number) => data.tasks.find((t) => t.number === n)!;

describe("выдуманные данные прототипа", () => {
  it("51 задача со сквозными номерами 1-51, как во вкладке «Задачи»", () => {
    expect(data.tasks).toHaveLength(51);
    expect(data.tasks.map((t) => t.number)).toEqual(Array.from({ length: 51 }, (_, i) => i + 1));
  });
  it("у каждой задачи один ответственный или «все лидеры», статус и срок", () => {
    for (const t of data.tasks) {
      expect(t.title.length).toBeLessThanOrEqual(120);
      expect(t.outcome.length).toBeGreaterThan(0);
      expect(t.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  it("переносы: исходный срок хранится отдельно, цепочка сходится к текущему сроку", () => {
    const t = task(13);
    expect(t.transfers).toHaveLength(2);
    expect(t.transfers[0]!.from).toBe(t.originalDue);
    expect(t.transfers.at(-1)!.to).toBe(t.due);
  });
  it("«Заблокирована» всегда с объяснением, чем и кто поможет", () => {
    for (const t of data.tasks.filter((x) => x.state === "blocked")) expect(t.blockedBy).toBeTruthy();
  });
  it("закрытые задачи с итогом или причиной", () => {
    for (const t of data.tasks.filter((x) => ["done", "failed", "cancelled"].includes(x.status))) expect(t.resolution).toBeTruthy();
  });
  it("в текстах нет длинного тире", () => {
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/—/);
  });
  it("weekly за три недели, у текущей разные состояния сдачи", () => {
    const states = new Set(data.weeklies.filter((w) => w.week === 40).map((w) => w.state));
    expect(states).toEqual(new Set(["submitted", "draft", "not-started"]));
    expect(new Set(data.entries.map((e) => e.week))).toEqual(new Set([40, 39, 38]));
  });
});

describe("правила задач (раздел 4 ТЗ)", () => {
  const base = task(2);
  const at = (patch: Partial<Task>): Task => ({ ...base, ...patch });

  it("просрочена: срок прошёл, статус «В работе» или «Требует уточнений»", () => {
    expect(isOverdue(at({ due: addDays(TODAY, -1), status: "in-progress" }), TODAY)).toBe(true);
    expect(isOverdue(at({ due: addDays(TODAY, -1), status: "clarify" }), TODAY)).toBe(true);
    expect(isOverdue(at({ due: TODAY, status: "in-progress" }), TODAY)).toBe(false);
    expect(isOverdue(at({ due: addDays(TODAY, -5), status: "done" }), TODAY)).toBe(false);
    expect(isOverdue(at({ due: addDays(TODAY, -5), status: "proposed" }), TODAY)).toBe(false);
    expect(overdueDays(at({ due: addDays(TODAY, -3) }), TODAY)).toBe(3);
  });
  it("давно не обновлялась: больше 14 дней без «Где сейчас»", () => {
    expect(isStale(at({ whereUpdatedAt: addDays(TODAY, -15) }), TODAY)).toBe(true);
    expect(isStale(at({ whereUpdatedAt: addDays(TODAY, -14) }), TODAY)).toBe(false);
    expect(isStale(at({ whereUpdatedAt: addDays(TODAY, -30), status: "done" }), TODAY)).toBe(false);
  });
  it("срок на этой неделе: с понедельника по воскресенье текущей недели", () => {
    expect(isDueThisWeek(at({ due: "2026-10-05" }), TODAY)).toBe(true);
    expect(isDueThisWeek(at({ due: "2026-10-11" }), TODAY)).toBe(true);
    expect(isDueThisWeek(at({ due: "2026-10-12" }), TODAY)).toBe(false);
  });
  it("мои задачи: ответственный, соисполнитель, общая задача для лидера", () => {
    expect(isMine(task(5), "sakhibullina", "LEADER")).toBe(true);
    expect(isMine(task(5), "golovkin", "ADMIN")).toBe(true); // соисполнитель
    expect(isMine(task(9), "reva", "LEADER")).toBe(true); // все лидеры
    expect(isMine(task(9), "golovkin", "ADMIN")).toBe(false);
  });
  it("порядок «Моих задач»: просроченные, срок на неделе, остальные", () => {
    const ordered = myTasksOrder(data.tasks.filter((t) => isMine(t, "fatyanov", "LEADER")), TODAY);
    const firstNormal = ordered.findIndex((t) => !isOverdue(t, TODAY));
    expect(ordered.slice(firstNormal).some((t) => isOverdue(t, TODAY))).toBe(false);
  });
  it("права: лидер меняет статус только своей задачи, приоритет только поставленной им", () => {
    expect(permissions(task(4), "fatyanov", false).status).toBe(true);
    expect(permissions(task(4), "reva", false).status).toBe(false);
    expect(permissions(task(4), "reva", true).status).toBe(true);
    expect(permissions(task(22), "afanasyev", false).priority).toBe(true);
    expect(permissions(task(4), "fatyanov", false).priority).toBe(false);
    expect(permissions(task(5), "golovkin", false).where).toBe(true); // соисполнитель пишет «где сейчас»
  });
  it("«Выполнена» требует итог, «Не выполнена» и «Отменена» требуют причину", () => {
    expect(statusNeedsNote("done")).toBe("result");
    expect(statusNeedsNote("failed")).toBe("reason");
    expect(statusNeedsNote("cancelled")).toBe("reason");
    expect(statusNeedsNote("in-progress")).toBeNull();
  });
});

describe("даты прототипа", () => {
  it("сдвиг и разница в днях через границу месяца", () => {
    expect(addDays("2026-09-29", 3)).toBe("2026-10-02");
    expect(diffDays("2026-09-29", "2026-10-02")).toBe(3);
  });
  it("склонение", () => {
    expect([1, 2, 5, 11, 21, 22].map((n) => plural(n, "задача", "задачи", "задач"))).toEqual(["задача", "задачи", "задач", "задач", "задача", "задачи"]);
  });
});
