// Этап 73б: один автоматический пункт повестки на задачу, с учётом убранных ведущим пунктов и с переносом пометок.
import { describe, expect, it } from "vitest";
import { mergedNote, oneItemPerTask, type TaskDraft } from "@/lib/meeting/task-items";

const follow: TaskDraft = { kind: "FOLLOW_UP", autoKey: "follow:t1", taskId: "t1", mark: "Поручение прошлой встречи" };
const risk: TaskDraft = { kind: "TASK_STATE", autoKey: "state:t1", taskId: "t1", note: "Нет ресурса", mark: "В риске: Нет ресурса" };
const critical: TaskDraft = { kind: "TASK_ATTENTION", autoKey: "attention:t1", taskId: "t1", note: null, mark: "Критичная" };
const proposal: TaskDraft = { kind: "PROPOSAL", autoKey: "proposal:t1", taskId: "t1", mark: "Предложение без ответа 4 дн." };
const question: TaskDraft = { kind: "QUESTION", autoKey: "question:q1", taskId: "t1" };
const person: TaskDraft = { kind: "PERSON", autoKey: "person:p1" };
const other: TaskDraft = { kind: "TASK_ATTENTION", autoKey: "attention:t2", taskId: "t2", mark: "Просрочена на 9 дн." };

const pick = (drafts: TaskDraft[], existing: Record<string, boolean> = {}) =>
  oneItemPerTask(drafts, new Map(Object.entries(existing).map(([k, removed]) => [k, { removed }]))).map((d) => [d.autoKey, d.note ?? null]);

describe("один пункт на задачу", () => {
  it("остаётся самый сильный, пометки остальных в его заметке; вопросы и пункты без задачи не трогаются", () => {
    expect(pick([critical, person, risk, question, follow, proposal, other])).toEqual([
      ["person:p1", null],
      ["question:q1", null],
      ["follow:t1", "В риске: Нет ресурса. Критичная. Предложение без ответа 4 дн."],
      ["attention:t2", null],
    ]);
  });

  it("убранное ведущим поручение не гасит риск; убранные проходят как есть", () => {
    expect(pick([follow, risk, critical], { "follow:t1": true })).toEqual([
      ["follow:t1", null],
      ["state:t1", "Нет ресурса. Критичная."],
    ]);
    expect(pick([follow, risk, critical], { "follow:t1": true, "state:t1": true })).toEqual([
      ["follow:t1", null],
      ["state:t1", "Нет ресурса"],
      ["attention:t1", null],
    ]);
  });

  it("пункт, что уже стоит в повестке, остаётся, даже если появился более сильный", () => {
    expect(pick([risk, critical], { "attention:t1": false })).toEqual([["attention:t1", "В риске: Нет ресурса."]]);
  });

  it("всё убрано: пункты проходят как есть, нового нет", () => {
    expect(pick([follow, risk], { "follow:t1": true, "state:t1": true })).toEqual([
      ["follow:t1", null],
      ["state:t1", "Нет ресурса"],
    ]);
  });
});

describe("заметка оставшегося пункта", () => {
  it("без пометок своя заметка как есть, с пометками каждая отдельным предложением", () => {
    expect(mergedNote("Ждём СК", [])).toBe("Ждём СК");
    expect(mergedNote(null, [])).toBeNull();
    expect(mergedNote(null, ["Критичная"])).toBe("Критичная.");
    expect(mergedNote("Ждём СК!", ["Критичная, просрочена на 9 дн."])).toBe("Ждём СК! Критичная, просрочена на 9 дн.");
  });
});
