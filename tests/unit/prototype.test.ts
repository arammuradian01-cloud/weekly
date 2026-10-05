import { describe, expect, it } from "vitest";
import { addDays, diffDays, plural } from "@/prototype/dates";
import { deadlineOf, isWeekKey, meetingOf, reportingKey, shiftWeek, weekKeyOf, weekKeyOfMeeting, weekNumberOf } from "@/lib/weekly/weeks";
import { buildCeoSections, canEditWeekly, splitWhat, submitState } from "@/lib/weekly/rules";
import { directionLabelKey, entryTypeFor, readWeeklyTable } from "@/lib/weekly/bord-import";
import { normalizeCell, overdueText, parseCsv, readTasksTable, whereUpdatedFrom } from "@/lib/tasks/bord-import";
import { issueUndoToken, readUndoToken } from "@/lib/tasks/undo";
import { readFileSync } from "node:fs";
import { isDueThisWeek, isMine, isOverdue, isStale, myTasksOrder, newTaskStatus, overdueDays, permissions, statusNeedsNote } from "@/lib/tasks/rules";
import type { Task, WeeklyEntry } from "@/prototype/types";

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

describe("недели (раздел 3 ТЗ)", () => {
  it("неделя определяется понедельником, номер по ISO: 21-27.09.2026 это неделя 39", () => {
    expect(weekKeyOf("2026-09-23")).toBe("2026-09-21");
    expect(weekNumberOf("2026-09-21")).toBe(39);
    expect(isWeekKey("2026-09-21")).toBe(true);
    expect(isWeekKey("2026-09-22")).toBe(false);
    expect(isWeekKey("2026-02-30")).toBe(false);
  });
  it("на стыке лет номер начинается заново, а ключи идут подряд", () => {
    expect(weekNumberOf("2026-12-28")).toBe(53);
    expect(shiftWeek("2026-12-28", 1)).toBe("2027-01-04");
    expect(weekNumberOf("2027-01-04")).toBe(1);
  });
  it("срок сдачи понедельник 18:00 по Москве после недели, встреча во вторник", () => {
    expect(deadlineOf("2026-09-28", { weekday: 1, time: "18:00" }).toISOString()).toBe("2026-10-05T15:00:00.000Z");
    expect(meetingOf("2026-09-28", { weekday: 2 })).toBe("2026-10-06");
    expect(weekKeyOfMeeting("2026-09-29")).toBe("2026-09-21");
  });
  it("отчётная неделя меняется через сутки после срока", () => {
    const s = { weekday: 1, time: "18:00" };
    expect(reportingKey(new Date("2026-10-05T10:00:00Z"), s)).toBe("2026-09-28");
    expect(reportingKey(new Date("2026-10-06T14:59:00Z"), s)).toBe("2026-09-28");
    expect(reportingKey(new Date("2026-10-06T15:01:00Z"), s)).toBe("2026-10-05");
  });
});

describe("правила weekly", () => {
  const week = { key: "2026-09-28", closed: false };
  it("свой weekly пишет каждый, кроме наблюдателя, пока неделя открыта и не будущая", () => {
    expect(canEditWeekly(week, "2026-09-28", { slug: "reva" }, "reva")).toBe(true);
    expect(canEditWeekly(week, "2026-09-28", { slug: "reva" }, "loginova")).toBe(false);
    expect(canEditWeekly(week, "2026-09-28", { slug: "reva" }, null)).toBe(false);
    expect(canEditWeekly({ ...week, closed: true }, "2026-09-28", { slug: "reva" }, "reva")).toBe(false);
    expect(canEditWeekly({ key: "2026-10-05", closed: false }, "2026-09-28", { slug: "reva" }, "reva")).toBe(false);
    expect(canEditWeekly(week, "2026-09-28", { slug: "reva", observer: true }, "reva")).toBe(false);
  });
  it("владелец и администраторы в режиме управления правят любой weekly, и закрытую неделю тоже", () => {
    expect(canEditWeekly({ ...week, closed: true }, "2026-09-28", { slug: "golovkin", management: "ADMIN" }, "reva")).toBe(true);
    expect(canEditWeekly(week, "2026-09-28", { slug: "golovkin" }, "reva")).toBe(false);
  });
  it("сдан вовремя до срока включительно, позже: с опозданием", () => {
    const deadline = new Date("2026-10-05T15:00:00Z");
    expect(submitState(new Date("2026-10-05T15:00:00Z"), deadline)).toBe("submitted");
    expect(submitState(new Date("2026-10-05T15:00:01Z"), deadline)).toBe("late");
  });
  it("отчёт CEO раскладывает отмеченные записи по разделам и меняет длинное тире и стрелки на дефис", () => {
    const e = (patch: Partial<WeeklyEntry>): WeeklyEntry => ({ id: "x", week: "2026-09-28", author: "reva", direction: "osago", block: "product", type: "event", what: "Событие.", links: [], ceo: true, ...patch });
    const s = buildCeoSections(
      [
        e({ what: "Запустили тест — первые итоги.", fact: "+5%" }),
        e({ type: "risk", what: "Баг на пути заказ → оплата" }),
        e({ type: "result", what: "Не в отчёт", ceo: false }),
        e({ what: "Договорились", next: "Подписать допсоглашение", author: null }),
      ],
      (slug) => (slug ? "Тарас" : "все лидеры"),
    );
    expect(s.main).toBe("- Запустили тест - первые итоги. +5% (Тарас)\n- Договорились (все лидеры)");
    expect(s.risks).toBe("- Баг на пути заказ - оплата (Тарас)");
    expect(s.next).toBe("- Подписать допсоглашение (все лидеры)");
  });
  it("«что произошло»: первая фраза, длинная режется по слову, полный текст в «Подробнее»", () => {
    expect(splitWhat("Трафик вырос. Продажи упали.")).toEqual({ what: "Трафик вырос.", details: "Продажи упали." });
    expect(splitWhat("Одна фраза без точки")).toEqual({ what: "Одна фраза без точки", details: undefined });
    const long = `${"слово ".repeat(40)}конец.`;
    const r = splitWhat(long);
    expect(r.what.length).toBeLessThanOrEqual(150);
    expect(r.what.endsWith("…")).toBe(true);
    expect(r.details).toBe(long.trim());
  });
});

describe("вкладка Weekly CEO Insurance&Invest Bord", () => {
  const csv = readFileSync("data/bord/weekly-ceo-2026-10-05.csv", "utf8");
  it("51 запись за две встречи, у каждой текст, блок и направление", () => {
    const rows = readWeeklyTable(csv);
    expect(rows).toHaveLength(51);
    expect(new Set(rows.map((r) => r.meeting))).toEqual(new Set(["2026-09-22", "2026-09-29"]));
    expect(rows.every((r) => r.text && r.block && r.direction)).toBe(true);
    expect(rows.filter((r) => r.ceo)).toHaveLength(35);
    expect(JSON.stringify(rows)).not.toMatch(/[—–]/);
  });
  it("направление «RED (ДВС, ипотека, ВЗР, ИФЛ)» это RED, тип записи по блоку", () => {
    expect(directionLabelKey("RED (ДВС, ипотека, ВЗР, ИФЛ)")).toBe("red");
    expect(directionLabelKey("Партнёрка")).toBe("партнёрка");
    expect(entryTypeFor("risks")).toBe("risk");
    expect(entryTypeFor("numbers")).toBe("result");
    expect(entryTypeFor("partners")).toBe("event");
  });
  it("другой заголовок вкладки останавливает импорт", () => {
    expect(() => readWeeklyTable(csv.replace("Цифра или факт", "Цифра"))).toThrow(/Колонка 5/);
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
