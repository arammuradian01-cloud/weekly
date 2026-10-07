// Этап 22а: правила обещаний недели без базы.
import { describe, expect, it } from "vitest";
import {
  EMPTY_SUMMARY,
  entryPromiseText,
  isPromiseTask,
  promiseShare,
  summarize,
  summaryText,
  taskPromiseOutcome,
} from "@/lib/weekly/promises";
import type { Task } from "@/domain/types";

const week = { start: "2026-10-05", end: "2026-10-11" };
type T = Pick<Task, "status" | "due" | "resolution" | "transfers" | "owner" | "archived" | "closedAt">;
const task = (patch: Partial<T> = {}): T => ({ status: "in-progress", due: "2026-10-09", transfers: [], owner: "reva", ...patch });

describe("что считается обещанием", () => {
  it("план и «что делаем дальше», но не запись, по которой есть задача", () => {
    expect(entryPromiseText({ type: "plan", what: "Запустить скоринг", next: "Неважно", hasTask: false })).toEqual({ kind: "plan", what: "Запустить скоринг" });
    expect(entryPromiseText({ type: "event", what: "Запустили тест", next: " Разобрать итоги ", hasTask: false })).toEqual({ kind: "next", what: "Разобрать итоги" });
    expect(entryPromiseText({ type: "event", what: "Запустили тест", next: "  ", hasTask: false })).toBeNull();
    expect(entryPromiseText({ type: "plan", what: "Запустить скоринг", hasTask: true })).toBeNull();
  });

  it("задача со сроком на неделе; перенесённая с недели во время недели; не перенесённая заранее", () => {
    expect(isPromiseTask(task(), "reva", week)).toBe(true);
    expect(isPromiseTask(task(), "loginova", week)).toBe(false);
    expect(isPromiseTask(task({ status: "proposed" }), "reva", week)).toBe(false);
    expect(isPromiseTask(task({ archived: true }), "reva", week)).toBe(false);
    const movedDuring = task({ due: "2026-10-20", transfers: [{ from: "2026-10-09", to: "2026-10-20", by: "reva", reason: "Ждём партнёра", at: "2026-10-08" }] });
    expect(isPromiseTask(movedDuring, "reva", week)).toBe(true);
    const movedBefore = task({ due: "2026-10-20", transfers: [{ from: "2026-10-09", to: "2026-10-20", by: "reva", reason: "Заранее", at: "2026-10-01" }] });
    expect(isPromiseTask(movedBefore, "reva", week)).toBe(false);
  });
});

describe("итог задачи-обещания", () => {
  const during = "2026-10-08";
  it("по статусу, перенос за неделю с причиной, открытая без итога, пока неделя идёт", () => {
    expect(taskPromiseOutcome(task({ status: "done", resolution: "Готово", closedAt: "2026-10-09" }), week, during)).toEqual({ result: "done", note: "Готово" });
    expect(taskPromiseOutcome(task({ status: "partial", resolution: "Половина", closedAt: "2026-10-09" }), week, during).result).toBe("partial");
    expect(taskPromiseOutcome(task({ status: "failed", resolution: "Нет данных", closedAt: "2026-10-09" }), week, during).result).toBe("not-done");
    expect(taskPromiseOutcome(task({ status: "cancelled", resolution: "Не нужно", closedAt: "2026-10-09" }), week, during).result).toBe("dropped");
    expect(taskPromiseOutcome(task(), week, during)).toEqual({ result: "open" });
    const moved = task({
      due: "2026-10-20",
      transfers: [
        { from: "2026-10-07", to: "2026-10-09", by: "reva", reason: "Внутри недели", at: "2026-10-06" },
        { from: "2026-10-09", to: "2026-10-20", by: "reva", reason: "Ждём партнёра", at: "2026-10-08" },
      ],
    });
    expect(taskPromiseOutcome(moved, week, during)).toEqual({ result: "moved", note: "Ждём партнёра" });
  });

  it("закрытие в понедельник после недели ещё считается, позже нет; открытая после понедельника просрочена", () => {
    expect(taskPromiseOutcome(task({ status: "done", resolution: "Готово", closedAt: "2026-10-12" }), week, "2026-10-12").result).toBe("done");
    expect(taskPromiseOutcome(task({ status: "done", resolution: "Готово", closedAt: "2026-10-14" }), week, "2026-10-14")).toEqual({ result: "late", note: "Закрыта 14 окт, позже недели" });
    expect(taskPromiseOutcome(task(), week, "2026-10-12").result).toBe("open");
    expect(taskPromiseOutcome(task(), week, "2026-10-13").result).toBe("overdue");
    // Срок перенесли с недели, а закрыли уже на следующей: за эту неделю перенесена, а не сделана
    const movedThenDone = task({ status: "done", resolution: "Готово", closedAt: "2026-10-16", due: "2026-10-16", transfers: [{ from: "2026-10-09", to: "2026-10-16", by: "reva", reason: "Ждём партнёра", at: "2026-10-09" }] });
    expect(taskPromiseOutcome(movedThenDone, week, "2026-10-16")).toEqual({ result: "moved", note: "Ждём партнёра" });
  });
});

describe("сводка", () => {
  it("невыполненное: не сделано, перенесено, закрыто позже, просрочено; без итога входит в долю, снятое нет", () => {
    const s = summarize(["done", "done", "partial", "moved", "late", "overdue", "not-done", "dropped", "open", undefined]);
    expect(s).toEqual({ done: 2, partial: 1, notDone: 4, dropped: 1, pending: 2, total: 10 });
    expect(promiseShare(s)).toBe(22);
    expect(summaryText(s)).toBe("Сделано 2 из 9: частично 1, не сделано 4, без итога 2. Снято 1");
  });

  it("пустая сводка, только без итога, только снятые", () => {
    expect(summaryText(EMPTY_SUMMARY)).toBe("Обещаний не было");
    expect(promiseShare(EMPTY_SUMMARY)).toBeNull();
    expect(summaryText(summarize(["open", undefined]))).toBe("Сделано 0 из 2: без итога 2");
    expect(summaryText(summarize(["done"]))).toBe("Сделано 1 из 1");
    expect(summaryText(summarize(["dropped"]))).toBe("Снято 1");
    expect(promiseShare(summarize(["dropped"]))).toBeNull();
  });
});
