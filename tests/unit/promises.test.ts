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
type T = Pick<Task, "status" | "due" | "resolution" | "transfers" | "owner" | "archived">;
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
  it("по статусу, перенос за неделю с причиной, открытая без итога", () => {
    expect(taskPromiseOutcome(task({ status: "done", resolution: "Готово" }), week)).toEqual({ result: "done", note: "Готово" });
    expect(taskPromiseOutcome(task({ status: "partial", resolution: "Половина" }), week).result).toBe("partial");
    expect(taskPromiseOutcome(task({ status: "failed", resolution: "Нет данных" }), week).result).toBe("not-done");
    expect(taskPromiseOutcome(task({ status: "cancelled", resolution: "Не нужно" }), week).result).toBe("dropped");
    expect(taskPromiseOutcome(task(), week)).toEqual({ result: "open" });
    const moved = task({
      due: "2026-10-20",
      transfers: [
        { from: "2026-10-07", to: "2026-10-09", by: "reva", reason: "Внутри недели", at: "2026-10-06" },
        { from: "2026-10-09", to: "2026-10-20", by: "reva", reason: "Ждём партнёра", at: "2026-10-08" },
      ],
    });
    expect(taskPromiseOutcome(moved, week)).toEqual({ result: "moved", note: "Ждём партнёра" });
  });
});

describe("сводка", () => {
  it("перенесённое считается невыполненным, снятое и без итога в долю не входят", () => {
    const s = summarize(["done", "done", "partial", "moved", "not-done", "dropped", "open", undefined]);
    expect(s).toEqual({ done: 2, partial: 1, notDone: 2, dropped: 1, pending: 2, total: 8 });
    expect(promiseShare(s)).toBe(40);
    expect(summaryText(s)).toBe("Сделано 2 из 5: частично 1, не сделано 2. Снято 1. Без итога 2");
  });

  it("пустая сводка и сводка без итогов", () => {
    expect(summaryText(EMPTY_SUMMARY)).toBe("Обещаний не было");
    expect(promiseShare(EMPTY_SUMMARY)).toBeNull();
    expect(summaryText(summarize(["open", undefined]))).toBe("Без итога 2");
    expect(summaryText(summarize(["done"]))).toBe("Сделано 1 из 1");
  });
});
