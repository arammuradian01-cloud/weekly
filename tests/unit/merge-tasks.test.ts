// Своя правка не уступает запоздавшему ответу сервера (этап 22, найдено нестабильным тестом правки задачи).
import { describe, expect, it } from "vitest";
import { mergeRecent } from "@/domain/merge-tasks";
import type { Task } from "@/domain/types";

const t = (number: number, title: string, rev: string) => ({ number, title, rev }) as Task;

describe("задачи с сервера и свои правки", () => {
  it("своя правка новее ответа сервера остаётся, более новая серверная версия побеждает", () => {
    const recent = new Map([[52, { at: 1000, task: t(52, "Новое название", "2026-10-07T10:00:02.000Z") }]]);
    expect(mergeRecent([t(52, "Старое название", "2026-10-07T10:00:01.000Z")], recent, 2000)[0]!.title).toBe("Новое название");
    expect(mergeRecent([t(52, "Правка коллеги", "2026-10-07T10:00:03.000Z")], recent, 2000)[0]!.title).toBe("Правка коллеги");
  });

  it("созданная задача не пропадает, удалённая не возвращается, через 15 секунд главный снова сервер", () => {
    const recent = new Map<number, { at: number; task: Task | null }>([
      [53, { at: 1000, task: t(53, "Только что создана", "2026-10-07T10:00:02.000Z") }],
      [10, { at: 1000, task: null }],
    ]);
    const server = [t(10, "Отправлена в архив", "2026-10-07T09:00:00.000Z"), t(11, "Другая", "2026-10-07T09:00:00.000Z")];
    expect(mergeRecent(server, recent, 2000).map((x) => x.number)).toEqual([11, 53]);
    expect(mergeRecent(server, recent, 20_000).map((x) => x.number)).toEqual([10, 11]);
    expect(recent.size).toBe(0);
  });
});
