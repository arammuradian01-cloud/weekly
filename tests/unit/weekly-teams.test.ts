// Этап 64: экран «Weekly-команды». Чистые правила экрана: какие кнопки показать по правам сервисов, поиск по
// названию и людям, пометка «другая ветка», итог добавления, порядок списка и состояние сдачи weekly.
import { describe, expect, it } from "vitest";
import { NO_RIGHTS, addSummary, canCancelRequest, inBranch, matchTeam, sortTeams, teamKindLabel, teamRights, weeklyStatus, type RightsSubject } from "@/lib/org/team-rights";
import { TOP_TEAM } from "@/domain/teams";

const leader = (over: Partial<RightsSubject> = {}): RightsSubject => ({ me: "p-lead", owner: false, personal: true, leads: new Set(["t-unit", "t-project", "t-below"]), ...over });
const unit = { id: "t-unit", leaderId: "p-lead", project: false, active: true };
const project = { id: "t-project", leaderId: "p-lead", project: true, active: true };
const below = { id: "t-below", leaderId: "p-other", project: false, active: true };
const top = { id: TOP_TEAM, leaderId: "p-lead", project: false, active: true };

describe("права на команду по правилам сервисов", () => {
  it("руководитель: состав своих команд, переименовать и закрыть только свой проект, руководителя не назначает", () => {
    expect(teamRights(leader(), unit)).toEqual({ members: true, rename: false, close: false, leader: false, rhythm: true });
    expect(teamRights(leader(), project)).toEqual({ members: true, rename: true, close: true, leader: false, rhythm: true });
  });

  it("команда ниже: состав меняет её руководитель, ритм задаёт и руководитель выше", () => {
    expect(teamRights(leader(), below)).toEqual({ members: false, rename: false, close: false, leader: false, rhythm: true });
  });

  it("топ-команда: даже её руководитель без режима управления состав не меняет, ритм это настройки недели", () => {
    expect(teamRights(leader(), top)).toEqual(NO_RIGHTS);
    expect(teamRights(leader({ owner: true }), top)).toEqual({ members: true, rename: true, close: false, leader: true, rhythm: false });
  });

  it("владелец в режиме управления: любая команда, кроме закрытия топ-команды", () => {
    const owner = leader({ me: "p-owner", owner: true, leads: new Set() });
    expect(teamRights(owner, below)).toEqual({ members: true, rename: true, close: true, leader: true, rhythm: true });
  });

  it("общий логин и наблюдатель: только просмотр, даже в своей команде", () => {
    const shared = leader({ personal: false });
    expect(teamRights(shared, unit)).toEqual(NO_RIGHTS);
    expect(teamRights(shared, project)).toEqual(NO_RIGHTS);
  });

  it("закрытая команда: никаких действий", () => {
    expect(teamRights(leader({ owner: true }), { ...project, active: false })).toEqual(NO_RIGHTS);
  });

  it("запрос в команду отменяют просивший, руководитель команды и владелец; общий логин нет", () => {
    expect(canCancelRequest(leader(), { leaderId: "p-other" }, "p-lead")).toBe(true);
    expect(canCancelRequest(leader(), { leaderId: "p-lead" }, "p-x")).toBe(true);
    expect(canCancelRequest(leader(), { leaderId: "p-other" }, "p-x")).toBe(false);
    expect(canCancelRequest(leader({ personal: false }), { leaderId: "p-lead" }, "p-lead")).toBe(false);
    expect(canCancelRequest(leader({ owner: true, personal: false }), { leaderId: "p-other" }, null)).toBe(true);
  });
});

describe("поиск, ветка и итог", () => {
  const team = { name: "Кросс-продажи с кредитами", leader: { fullName: "Головкин Владислав" }, members: [{ fullName: "Фатьянов Евгений" }], waiting: [{ fullName: "Котов Игорь" }] };

  it("поиск по названию, руководителю, участникам и ждущим согласия; регистр и ё не важны", () => {
    expect(matchTeam(team, "")).toBe(true);
    expect(matchTeam(team, "кросс")).toBe(true);
    expect(matchTeam(team, "ГОЛОВКИН")).toBe(true);
    expect(matchTeam(team, "фатьянов кредит")).toBe(true);
    expect(matchTeam(team, "котов")).toBe(true);
    expect(matchTeam(team, "Пётр")).toBe(false);
    expect(matchTeam({ ...team, members: [{ fullName: "Ершов Пётр" }] }, "петр")).toBe(true);
  });

  it("вид команды: по структуре или проект", () => {
    expect(teamKindLabel({ kind: "UNIT" })).toBe("По структуре");
    expect(teamKindLabel({ kind: "TOP" })).toBe("По структуре");
    expect(teamKindLabel({ kind: "CUSTOM" })).toBe("Проект");
  });

  it("ветка руководителя: руководитель выше по цепочке, петля не зацикливает", () => {
    const managerOf = new Map<string, string | null>([
      ["kotov", "lisina"],
      ["lisina", "ershov"],
      ["ershov", "ceo"],
      ["loop-a", "loop-b"],
      ["loop-b", "loop-a"],
    ]);
    expect(inBranch(managerOf, "kotov", "ershov")).toBe(true);
    expect(inBranch(managerOf, "kotov", "lisina")).toBe(true);
    expect(inBranch(managerOf, "lisina", "kotov")).toBe(false);
    expect(inBranch(managerOf, "loop-a", "ershov")).toBe(false);
    expect(inBranch(managerOf, "kotov", null)).toBe(false);
  });

  it("итог добавления одной строкой", () => {
    expect(addSummary("Money", null)).toBe("Команда «Money» создана");
    expect(addSummary("Money", { added: ["А"], requested: [{ name: "Б", approver: "В" }], already: [], skipped: [] })).toBe("Команда «Money»: добавлено 1, ждут согласия руководителя 1");
    expect(addSummary("Money", { added: [], requested: [], already: ["А"], skipped: [{ name: "Г", reason: "Г выключен" }] })).toBe("Команда «Money»: добавлено 0, уже были в команде или ждут согласия 1, не добавлено 1: Г выключен");
  });

  it("порядок списка: где руководитель, где участник, остальные; внутри порядок дерева", () => {
    const list = [
      { id: "a", relation: "other" as const },
      { id: "b", relation: "member" as const },
      { id: "c", relation: "leader" as const },
      { id: "d", relation: "other" as const },
      { id: "e", relation: "leader" as const },
    ];
    expect(sortTeams(list).map((t) => t.id)).toEqual(["c", "e", "b", "a", "d"]);
  });

  it("сдача weekly: не ждём, все сдали, срок прошёл, ждём", () => {
    const base = { expected: 3, submitted: 1, late: 0, absent: 0, passed: false, closed: false };
    expect(weeklyStatus({ ...base, expected: 0 })).toBe("none");
    expect(weeklyStatus({ ...base, expected: 0, absent: 1 })).toBe("done");
    expect(weeklyStatus({ ...base, submitted: 2, late: 1 })).toBe("done");
    expect(weeklyStatus({ ...base, passed: true })).toBe("overdue");
    expect(weeklyStatus(base)).toBe("waiting");
  });
});
