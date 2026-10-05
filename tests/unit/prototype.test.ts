import { describe, expect, it } from "vitest";
import { buildPrototypeData, feedWeek, latestWeekWithEntries } from "@/prototype/data";
import { addDays, diffDays, plural } from "@/prototype/dates";
import { BLOCKS, DIRECTIONS } from "@/prototype/dictionaries";
import { isPersonSlug } from "@/prototype/people";
import { normalizeCell, overdueText, parseCsv, readTasksTable, whereUpdatedFrom } from "@/lib/tasks/bord-import";
import { issueUndoToken, readUndoToken } from "@/lib/tasks/undo";
import { readFileSync } from "node:fs";
import { isDueThisWeek, isMine, isOverdue, isStale, myTasksOrder, newTaskStatus, overdueDays, permissions, statusNeedsNote } from "@/lib/tasks/rules";
import type { Task } from "@/prototype/types";

/** Задача для проверки правил: сами правила от данных не зависят */
function makeTask(patch: Partial<Task> = {}): Task {
  return {
    number: 1,
    title: "Проверочная задача",
    outcome: "Результат",
    owner: "sakhibullina",
    coExecutors: ["golovkin"],
    direction: "partners",
    priority: "medium",
    status: "in-progress",
    state: "on-track",
    where: "",
    whereUpdatedAt: TODAY,
    due: TODAY,
    originalDue: TODAY,
    transfers: [],
    source: { kind: "meeting", note: "" },
    links: [],
    comments: [],
    history: [],
    createdBy: "afanasyev",
    createdAt: TODAY,
    updatedAt: TODAY,
    ...patch,
  };
}

const TODAY = "2026-10-05"; // понедельник, неделя 41, отчётная неделя 40
const data = buildPrototypeData(TODAY, 40);

// Weekly из Insurance&Invest Bord (решение Арама 05.10.2026). Проверяем свойства, а не конкретные строки
describe("weekly прототипа из Insurance&Invest Bord", () => {
  it("в данных прототипа нет задач: с этапа 3 они живут в базе", () => {
    expect("tasks" in data).toBe(false);
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
  const base: Task = makeTask();
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
    const mine = [
      at({ number: 1, due: addDays(TODAY, 20) }),
      at({ number: 2, due: addDays(TODAY, -2) }),
      at({ number: 3, due: addDays(TODAY, 3) }),
      at({ number: 4, due: addDays(TODAY, -9) }),
      at({ number: 5, due: addDays(TODAY, -1), status: "done", resolution: "Готово" }),
    ];
    const ordered = myTasksOrder(mine, TODAY);
    expect(ordered.map((t) => t.number)).toEqual([4, 2, 3, 1, 5]);
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
  it("права режима управления, наблюдателя и предложенных задач (матрица раздела 2)", () => {
    const owner = { slug: "muradyan" as const, management: "OWNER" as const };
    const admin = { slug: "golovkin" as const, management: "ADMIN" as const };
    expect(permissions(base, owner).archive).toBe(true);
    expect(permissions(base, admin).archive).toBe(false);
    expect(permissions(base, admin).owner).toBe(true);
    expect(permissions(base, { slug: "sakhibullina" }).owner).toBe(false);
    expect(permissions(base, { slug: "sakhibullina" }).coExecutors).toBe(true); // ответственный зовёт соисполнителей
    expect(permissions(at({ owner: "all" }), { slug: "sakhibullina" }).coExecutors).toBe(false);
    expect(permissions(base, { slug: "afanasyev" }).edit).toBe(true); // поставил задачу
    expect(permissions(base, { slug: "reva" }).edit).toBe(false);
    const observer = permissions(base, { slug: "sakhibullina", observer: true });
    expect(Object.values(observer).every((v) => v === false)).toBe(true);
    // Предложенную задачу ответственный не берёт в работу сам: её подтверждает режим управления
    const proposed = at({ status: "proposed" });
    expect(permissions(proposed, { slug: "sakhibullina" }).status).toBe(false);
    expect(permissions(proposed, admin).confirm).toBe(true);
    expect(newTaskStatus("reva", { slug: "reva" })).toBe("in-progress");
    expect(newTaskStatus("loginova", { slug: "reva" })).toBe("proposed");
    expect(newTaskStatus("all", { slug: "reva" })).toBe("proposed");
    expect(newTaskStatus("loginova", admin)).toBe("in-progress");
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

describe("вкладка «Задачи» Insurance&Invest Bord", () => {
  const csv = readFileSync("data/bord/zadachi-2026-10-05.csv", "utf8");

  it("CSV: кавычки, удвоенные кавычки и перевод строки внутри ячейки", () => {
    expect(parseCsv('a,"b, c","d ""e""",f\n1,"x\ny",3\n')).toEqual([
      ["a", "b, c", 'd "e"', "f"],
      ["1", "x\ny", "3"],
    ]);
  });
  it("в выгрузке 51 задача со сквозными номерами и всеми девятью колонками", () => {
    const rows = readTasksTable(csv);
    expect(rows).toHaveLength(51);
    expect(rows.map((r) => r.number)).toEqual(Array.from({ length: 51 }, (_, i) => i + 1));
    expect(rows.every((r) => r.title && r.outcome && r.due && r.status && r.overdue)).toBe(true);
  });
  it("заголовок вкладки поменялся: импорт останавливается с понятной ошибкой", () => {
    expect(() => readTasksTable(csv.replace("Срок,Статус", "Дедлайн,Статус"))).toThrow(/Колонка 6/);
    expect(() => readTasksTable("просто текст")).toThrow(/нет таблицы задач/);
  });
  it("читает и выгрузку всей таблицы с блоками вкладок", () => {
    const dump = `## Sheet name: Отчёт CEO\nчто-то\n\n## Sheet name: Задачи\nInsurance\n${csv}\n## Sheet name: Цели\n1,2,3\n`;
    expect(readTasksTable(dump)).toHaveLength(51);
  });
  it("дата «где сейчас»: самая поздняя пометка ДД.ММ: в комментарии, иначе дата встречи", () => {
    expect(whereUpdatedFrom("02.10: финал модели. 29.09: тезисы", "2026-09-22")).toBe("2026-10-02");
    expect(whereUpdatedFrom("Встреча 01.10, договорились", "2026-09-30")).toBe("2026-09-30");
    expect(whereUpdatedFrom("05.01: после праздников", "2026-12-20")).toBe("2027-01-05");
  });
  it("длинное тире в ячейке становится дефисом, пробелы по краям уходят", () => {
    expect(normalizeCell("  Бюджет — 2027 ")).toBe("Бюджет - 2027");
  });
  it("статус просроченности считается так же, как в таблице", () => {
    const t = makeTask({ due: "2026-09-25" });
    expect(overdueText(t, "2026-10-04")).toBe("Просрочена на 9 дн.");
    expect(overdueText(makeTask({ due: "2026-10-05" }), "2026-10-04")).toBe("В сроке");
    expect(overdueText(makeTask({ status: "done", resolution: "Готово" }), "2026-10-04")).toBe("Закрыта");
  });
});

describe("отмена последнего действия", () => {
  it("токен читает только тот, кто действовал, и только минуту", () => {
    process.env.SESSION_SECRET ??= "unit-test-secret-0123456789-0123456789";
    const now = Date.now();
    const token = issueUndoToken({ kind: "comment", number: 5, commentId: "c1" }, "person-1", now);
    expect(readUndoToken(token, "person-1", now + 1000)).toEqual({ kind: "comment", number: 5, commentId: "c1" });
    expect(readUndoToken(token, "person-2", now + 1000)).toBeNull();
    expect(readUndoToken(token, "person-1", now + 61_000)).toBeNull();
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ kind: "comment", number: 6, commentId: "c1", by: "person-1", exp: now + 60000 })).toString("base64url");
    expect(readUndoToken(`${forged}.${mac}`, "person-1", now)).toBeNull();
    expect(readUndoToken(`${body}.x${mac!.slice(1)}`, "person-1", now)).toBeNull();
  });
});
