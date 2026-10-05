import { describe, expect, it } from "vitest";
import { buildPrototypeData, feedWeek, latestWeekWithEntries } from "@/prototype/data";
import { addDays, diffDays, plural } from "@/prototype/dates";
import { BLOCKS, DIRECTIONS } from "@/prototype/dictionaries";
import { isPersonSlug } from "@/prototype/people";
import { isDueThisWeek, isMine, isOverdue, isStale, myTasksOrder, overdueDays, permissions, statusNeedsNote } from "@/prototype/rules";
import type { Task } from "@/prototype/types";

const TODAY = "2026-10-05"; // понедельник, неделя 41, отчётная неделя 40
const data = buildPrototypeData(TODAY, 40);

// Данные из Insurance&Invest Bord (решение Арама 05.10.2026). Проверяем свойства, а не конкретные строки:
// таблица будет меняться, тесты не должны ломаться от новой задачи
describe("данные прототипа из Insurance&Invest Bord", () => {
  it("задачи со сквозными номерами без пропусков, как во вкладке «Задачи»", () => {
    expect(data.tasks.length).toBeGreaterThan(0);
    expect(data.tasks.map((t) => t.number)).toEqual(Array.from({ length: data.tasks.length }, (_, i) => i + 1));
  });
  it("у каждой задачи ответственный или «все лидеры», результат, срок и источник", () => {
    for (const t of data.tasks) {
      expect(t.owner === "all" || isPersonSlug(t.owner), `задача ${t.number}`).toBe(true);
      expect(t.title.length).toBeLessThanOrEqual(120);
      expect(t.outcome.length).toBeGreaterThan(0);
      expect(t.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t.source.kind).toBe("meeting");
      expect(t.source.note).toMatch(/^\d{1,2} [а-я]+$/);
      expect(DIRECTIONS.some((d) => d.code === t.direction)).toBe(true);
    }
  });
  it("«Перенесена» из таблицы стала «В работе» с одним переносом без исходного срока", () => {
    const moved = data.tasks.filter((t) => t.transfers.length);
    expect(moved.length).toBeGreaterThan(0);
    for (const t of moved) {
      expect(t.status).toBe("in-progress");
      expect(t.transfers).toHaveLength(1);
      expect(t.transfers[0]!.from).toBeNull();
      expect(t.transfers[0]!.to).toBe(t.due);
    }
  });
  it("закрытые задачи с итогом или причиной и датой закрытия", () => {
    for (const t of data.tasks.filter((x) => ["done", "failed", "cancelled"].includes(x.status))) {
      expect(t.resolution).toBeTruthy();
      expect(t.closedAt).toBeTruthy();
    }
  });
  it("выдуманных событий нет: ни входов, ни комментариев, ни авторов задач", () => {
    expect(data.journal.every((e) => e.source === "sheet" && e.by === "system")).toBe(true);
    expect(data.tasks.every((t) => t.comments.length === 0 && t.createdBy === null)).toBe(true);
  });
  it("в текстах нет длинного тире", () => {
    expect(JSON.stringify(data)).not.toMatch(/[—–]/);
  });
  it("записи weekly относятся к неделе перед встречей во вторник, блоки и направления из справочника", () => {
    expect(new Set(data.entries.map((e) => e.week))).toEqual(new Set([38, 39]));
    for (const e of data.entries) {
      expect(BLOCKS.some((b) => b.code === e.block)).toBe(true);
      expect(DIRECTIONS.some((d) => d.code === e.direction)).toBe(true);
      expect(e.what.length).toBeLessThanOrEqual(150);
      expect(e.author === null || isPersonSlug(e.author)).toBe(true);
    }
    expect(data.entries.some((e) => e.author === null)).toBe(true);
  });
  it("сдал тот, кто писал записи. Отчётная неделя ещё не начата ни у кого", () => {
    for (const w of data.weeklies.filter((x) => x.week !== 40)) {
      const wrote = data.entries.some((e) => e.week === w.week && e.author === w.author);
      expect(w.state).toBe(wrote ? "submitted" : "not-started");
    }
    expect(data.weeklies.filter((w) => w.week === 40).every((w) => w.state === "not-started")).toBe(true);
  });
  it("пока за отчётную неделю записей нет, лента открывает последнюю разобранную", () => {
    expect(latestWeekWithEntries(data)).toBe(39);
    expect(feedWeek(data)).toBe(39);
    const withEntry = { ...data, entries: [...data.entries, { ...data.entries[0]!, id: "x", week: 40 }] };
    expect(feedWeek(withEntry)).toBe(40);
  });
});

describe("правила задач (раздел 4 ТЗ)", () => {
  const base: Task = { ...data.tasks[0]!, status: "in-progress", owner: "sakhibullina", coExecutors: ["golovkin"], createdBy: "afanasyev", closedAt: undefined };
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
    expect(isMine(base, "sakhibullina", "LEADER")).toBe(true);
    expect(isMine(base, "golovkin", "ADMIN")).toBe(true); // соисполнитель
    expect(isMine(base, "reva", "LEADER")).toBe(false);
    expect(isMine(at({ owner: "all" }), "reva", "LEADER")).toBe(true); // все лидеры
    expect(isMine(at({ owner: "all", coExecutors: [] }), "golovkin", "ADMIN")).toBe(false);
  });
  it("порядок «Моих задач»: просроченные, срок на неделе, остальные", () => {
    const ordered = myTasksOrder(data.tasks.filter((t) => isMine(t, "fatyanov", "LEADER")), TODAY);
    const firstNormal = ordered.findIndex((t) => !isOverdue(t, TODAY));
    expect(ordered.slice(firstNormal).some((t) => isOverdue(t, TODAY))).toBe(false);
  });
  it("права: лидер меняет статус только своей задачи, приоритет только поставленной им", () => {
    expect(permissions(base, "sakhibullina", false).status).toBe(true);
    expect(permissions(base, "reva", false).status).toBe(false);
    expect(permissions(base, "reva", true).status).toBe(true);
    expect(permissions(base, "afanasyev", false).priority).toBe(true); // поставил задачу
    expect(permissions(base, "sakhibullina", false).priority).toBe(false);
    expect(permissions(base, "golovkin", false).where).toBe(true); // соисполнитель пишет «где сейчас»
    expect(permissions(base, "golovkin", false).status).toBe(false);
    // Задача со встречи без автора: приоритет меняет только владелец или администратор
    expect(permissions(at({ createdBy: null }), "sakhibullina", false).priority).toBe(false);
    expect(permissions(at({ createdBy: null }), "sakhibullina", true).priority).toBe(true);
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
