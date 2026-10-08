import { describe, expect, it } from "vitest";
import { cardTeams, countCells, dueAt, hoursText, lastWeeks, median, overdueAt, share, weekEndMoment, weeklyCell, workingHoursBetween, type TaskHistory } from "@/lib/analytics/rules";
import { niceMax } from "@/components/analytics/week-chart";

// Аналитика руководителя (этап 27): правила счёта без базы

/** Момент по Москве: UTC+3 */
const msk = (iso: string) => new Date(`${iso}+03:00`);

describe("рабочие часы ответа на просьбу", () => {
  it("будни с 9 до 20 по Москве: вечер и выходные не копятся", () => {
    // Просьба в пятницу 09.10 в 19:00, ответ в понедельник 12.10 в 10:00: час в пятницу и час в понедельник
    expect(workingHoursBetween(msk("2026-10-09T19:00:00"), msk("2026-10-12T10:00:00"))).toBe(2);
    // В тот же день с 10:30 до 13:00
    expect(workingHoursBetween(msk("2026-10-12T10:30:00"), msk("2026-10-12T13:00:00"))).toBe(2.5);
    // Ночью до утра: только с 9 до 9:15
    expect(workingHoursBetween(msk("2026-10-12T23:00:00"), msk("2026-10-13T09:15:00"))).toBe(0.3);
    // Суббота и воскресенье целиком: ноль
    expect(workingHoursBetween(msk("2026-10-10T09:00:00"), msk("2026-10-11T20:00:00"))).toBe(0);
    // Полная рабочая неделя: 5 дней по 11 часов
    expect(workingHoursBetween(msk("2026-10-12T00:00:00"), msk("2026-10-19T00:00:00"))).toBe(55);
    // Ответ раньше просьбы (часы сервера разъехались): ноль, а не минус
    expect(workingHoursBetween(msk("2026-10-12T12:00:00"), msk("2026-10-12T11:00:00"))).toBe(0);
  });

  it("медиана и подпись", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(hoursText(null)).toBe("ответов не было");
    expect(hoursText(0.4)).toBe("меньше рабочего часа");
    expect(hoursText(1.2)).toBe("1 рабочий час");
    expect(hoursText(3)).toBe("3 рабочих часа");
    expect(hoursText(11.6)).toBe("12 рабочих часов");
    expect(hoursText(21)).toBe("21 рабочий час");
  });
});

describe("просрочка на конец прошлой недели", () => {
  const task = (over: Partial<TaskHistory> = {}): TaskHistory => ({
    status: "IN_PROGRESS",
    due: "2026-10-20",
    createdAt: msk("2026-09-01T10:00:00"),
    closedAt: null,
    archivedAt: null,
    transfers: [],
    ...over,
  });
  const sunday = (day: string) => msk(`${day}T23:59:59`);

  it("срок в прошлом восстанавливается по переносу, сделанному позже", () => {
    // Срок был 30.09, 06.10 его перенесли на 20.10: на конец недели 40 (04.10) задача была просрочена, сейчас нет
    const t = task({ transfers: [{ at: msk("2026-10-06T12:00:00"), fromDue: "2026-09-30" }] });
    expect(dueAt(t.due, t.transfers, sunday("2026-10-04"))).toBe("2026-09-30");
    expect(overdueAt(t, sunday("2026-10-04"), "2026-10-04")).toBe(true);
    expect(overdueAt(t, sunday("2026-10-11"), "2026-10-11")).toBe(false);
    // Несколько переносов: берётся первый после момента
    const twice = task({
      transfers: [
        { at: msk("2026-10-08T12:00:00"), fromDue: "2026-10-07" },
        { at: msk("2026-10-02T12:00:00"), fromDue: "2026-09-25" },
      ],
    });
    expect(dueAt(twice.due, twice.transfers, sunday("2026-09-27"))).toBe("2026-09-25");
    expect(dueAt(twice.due, twice.transfers, sunday("2026-10-04"))).toBe("2026-10-07");
    // Первый перенос после момента без прежнего срока: срок неизвестен, берём нынешний, а не срок из следующего переноса
    expect(dueAt("2026-10-20", [{ at: msk("2026-10-06T10:00:00"), fromDue: null }, { at: msk("2026-10-08T10:00:00"), fromDue: "2026-10-07" }], sunday("2026-10-04"))).toBe("2026-10-20");
    // Перенос без прежнего срока и без времени не мешает
    expect(dueAt("2026-10-20", [{ at: null, fromDue: "2026-01-01" }, { at: msk("2026-10-09T10:00:00"), fromDue: null }], sunday("2026-10-04"))).toBe("2026-10-20");
  });

  it("закрытые, ещё не созданные, архивные и предложенные в просрочку не идут", () => {
    const late = { due: "2026-09-30" };
    expect(overdueAt(task({ ...late, status: "DONE", closedAt: msk("2026-10-02T10:00:00") }), sunday("2026-10-04"), "2026-10-04")).toBe(false);
    // Закрыли позже конца недели: на конец недели была открыта и просрочена
    expect(overdueAt(task({ ...late, status: "DONE", closedAt: msk("2026-10-07T10:00:00") }), sunday("2026-10-04"), "2026-10-04")).toBe(true);
    // Закрыта, но момент закрытия не записан (из таблицы): не считаем
    expect(overdueAt(task({ ...late, status: "CANCELLED", closedAt: null }), sunday("2026-10-04"), "2026-10-04")).toBe(false);
    expect(overdueAt(task({ ...late, createdAt: msk("2026-10-05T10:00:00") }), sunday("2026-10-04"), "2026-10-04")).toBe(false);
    expect(overdueAt(task({ ...late, archivedAt: msk("2026-10-01T10:00:00") }), sunday("2026-10-04"), "2026-10-04")).toBe(false);
    expect(overdueAt(task({ ...late, status: "PROPOSED" }), sunday("2026-10-04"), "2026-10-04")).toBe(false);
    // Срок в тот же день ещё не просрочка
    expect(overdueAt(task({ due: "2026-10-04" }), sunday("2026-10-04"), "2026-10-04")).toBe(false);
  });

  it("конец недели: воскресенье 23:59 по Москве, текущая неделя считается на сейчас", () => {
    const now = msk("2026-10-08T15:00:00");
    expect(weekEndMoment("2026-09-28", now)).toEqual({ moment: msk("2026-10-04T23:59:59.999"), day: "2026-10-04", current: false });
    expect(weekEndMoment("2026-10-05", now)).toEqual({ moment: now, day: "2026-10-08", current: true });
    expect(lastWeeks("2026-10-05")).toEqual(["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"]);
  });
});

describe("weekly по неделям", () => {
  it("вовремя, с опозданием, не сдан, в отпуске, идёт сдача, не ждали", () => {
    expect(weeklyCell(true, "SUBMITTED", false, true)).toBe("on-time");
    expect(weeklyCell(true, "LATE", false, true)).toBe("late");
    expect(weeklyCell(true, null, false, true)).toBe("missing");
    expect(weeklyCell(true, "DRAFT", false, true)).toBe("missing");
    expect(weeklyCell(true, "DRAFT", false, false)).toBe("pending");
    // В отпуске, но сдал: сдача считается
    expect(weeklyCell(true, null, true, true)).toBe("absent");
    expect(weeklyCell(true, "SUBMITTED", true, true)).toBe("on-time");
    // Не ждали: даже сданный weekly не влияет на долю команды
    expect(weeklyCell(false, "SUBMITTED", false, true)).toBe("none");
    expect(weeklyCell(false, null, false, true)).toBe("none");
  });

  it("доля от тех, кто должен был сдать: отпуск и «не ждали» вне счёта", () => {
    const c = countCells(["on-time", "on-time", "late", "missing", "absent", "none", "pending"]);
    expect(c).toEqual({ expected: 5, onTime: 2, late: 1, missing: 1, pending: 1, absent: 1 });
    expect(share(c.onTime, c.expected - c.pending)).toBe(50);
    expect(share(1, 3)).toBe(33);
    expect(share(0, 0)).toBeNull();
  });
});

describe("карточки лидеров", () => {
  const n = (id: string, parentId: string | null, leaderId: string | null, sortOrder: number, active = true) => ({ id, parentId, leaderId, sortOrder, active });
  const nodes = [
    n("top", null, "aram", 0),
    n("dept-aram", "top", "aram", 5),
    n("sector-x", "dept-aram", "kolya", 1),
    n("cpo", "top", "reva", 20),
    n("cro", "top", "golovkin", 10),
    n("osago", "cpo", "antonov", 1),
    n("old", "top", "gone", 30, false),
  ];
  const all = new Set(nodes.map((x) => x.id));

  it("команды уровнем ниже по порядку структуры; свою же команду ниже руководитель проходит насквозь", () => {
    expect(cardTeams(nodes, "top", all).map((x) => x.id)).toEqual(["sector-x", "cro", "cpo"]);
    expect(cardTeams(nodes, "cpo", all).map((x) => x.id)).toEqual(["osago"]);
    expect(cardTeams(nodes, "osago", all)).toEqual([]);
  });

  it("только видимые и включённые команды", () => {
    expect(cardTeams(nodes, "top", new Set(["top", "cpo", "osago"])).map((x) => x.id)).toEqual(["cpo"]);
  });

  it("петля в дереве не зацикливает", () => {
    const loop = [n("a", "b", "x", 1), n("b", "a", "x", 2)];
    expect(cardTeams(loop, "a", new Set(["a", "b"]))).toEqual([]);
  });
});

describe("шкала графика", () => {
  it("верх шкалы круглый и не меньше 4", () => {
    expect(niceMax(0)).toBe(4);
    expect(niceMax(3)).toBe(4);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(12)).toBe(20);
    expect(niceMax(37)).toBe(40);
    expect(niceMax(41)).toBe(50);
    expect(niceMax(180)).toBe(200);
  });
});
