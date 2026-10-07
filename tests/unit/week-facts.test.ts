// Этап 22б: факты недели для черновика weekly и подсветка «В графике» без оснований.
import { describe, expect, it } from "vitest";
import { clipWhat, requestFact, taskFacts } from "@/lib/weekly/facts";
import { greenOutside, greenOutsideText } from "@/lib/tasks/green-outside";
import type { Task } from "@/domain/types";

const week = { start: "2026-10-05", end: "2026-10-11" };
const task = (patch: Partial<Task>) =>
  ({
    number: 52,
    title: "Отчёт по ошибкам СК",
    owner: "reva",
    status: "in-progress",
    state: "on-track",
    direction: "kasko",
    transfers: [],
    due: "2026-10-20",
    whereUpdatedAt: "2026-10-07",
    ...patch,
  }) as Task;

describe("факты недели по задачам", () => {
  it("закрытая на неделе или в понедельник после неё: результат; позже или чужая: нет", () => {
    expect(taskFacts([task({ status: "done", closedAt: "2026-10-09", resolution: "Таблица готова" })], "reva", week)).toEqual([
      { key: "closed:52", kind: "closed", type: "result", block: "key-changes", direction: "kasko", what: "Отчёт по ошибкам СК", details: "Таблица готова", taskNumber: 52 },
    ]);
    expect(taskFacts([task({ status: "partial", closedAt: "2026-10-12", resolution: "Половина" })], "reva", week)[0]!.what).toBe("Отчёт по ошибкам СК: выполнена частично");
    expect(taskFacts([task({ status: "done", closedAt: "2026-10-13" })], "reva", week)).toEqual([]);
    expect(taskFacts([task({ status: "done", closedAt: "2026-10-09" })], "loginova", week)).toEqual([]);
  });

  it("перенос срока на неделе: от первого переноса до последнего с последней причиной; заблокированная: риск", () => {
    const moved = task({
      transfers: [
        { from: "2026-10-08", to: "2026-10-10", by: "reva", reason: "Ждём данные", at: "2026-10-06" },
        { from: "2026-10-10", to: "2026-10-20", by: "reva", reason: "Партнёр перенёс встречу", at: "2026-10-09" },
      ],
    });
    expect(taskFacts([moved], "reva", week)).toEqual([
      { key: "moved:52:2026-10-20", kind: "moved", type: "risk", block: "risks", direction: "kasko", what: "Перенесли срок: Отчёт по ошибкам СК", details: "Срок с 8 окт на 20 окт. Причина: Партнёр перенёс встречу", taskNumber: 52 },
    ]);
    const blocked = taskFacts([task({ state: "blocked", blockedBy: "Ждёт задачу 7" })], "reva", week);
    expect(blocked.map((f) => [f.key, f.what, f.details])).toEqual([["blocked:52", "Заблокирована: Отчёт по ошибкам СК", "Ждёт задачу 7"]]);
  });

  it("выполненная просьба и длинный текст по слову до 150 знаков", () => {
    expect(requestFact({ number: 7, text: "Выгрузка по убыткам", author: "Логинова Светлана", closedAt: "2026-10-08" }, "osago")).toMatchObject({
      key: "request:7",
      type: "event",
      block: "team",
      direction: "osago",
      what: "Выполнили просьбу коллеги: выгрузка по убыткам",
      details: "Просьба 7, автор Логинова Светлана",
    });
    const long = clipWhat("слово ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(150);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("«В графике» без оснований", () => {
  const today = "2026-10-20";
  it("просрочена, переносили два раза, неделя без обновлений; 14 дней: не подтверждено", () => {
    expect(greenOutside(task({ due: "2026-10-25", whereUpdatedAt: "2026-10-19" }), today)).toBeNull();
    const g = greenOutside(task({ due: "2026-10-17", whereUpdatedAt: "2026-10-12", transfers: [{} as never, {} as never] }), today)!;
    expect(greenOutsideText(g)).toBe("«В графике», но просрочена на 3 дн., срок переносили 2 раза, 8 дн. без обновлений");
    expect(g.unconfirmed).toBe(false);
    expect(greenOutside(task({ due: "2026-10-25", whereUpdatedAt: "2026-10-06" }), today)).toMatchObject({ quietDays: 14, unconfirmed: true });
    expect(greenOutsideText(greenOutside(task({ due: "2026-10-25", whereUpdatedAt: "2026-10-19", transfers: Array(5).fill({}) }), today)!)).toBe("«В графике», но срок переносили 5 раз");
  });

  it("не «В графике», закрыта или в архиве: не подсвечивается", () => {
    const late = { due: "2026-10-01" };
    expect(greenOutside(task({ ...late, state: "at-risk" }), today)).toBeNull();
    expect(greenOutside(task({ ...late, status: "done" }), today)).toBeNull();
    expect(greenOutside(task({ ...late, archived: true }), today)).toBeNull();
  });
});
