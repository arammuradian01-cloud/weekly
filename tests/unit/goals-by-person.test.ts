// Цели по сотрудникам: адрес, отбор людей, группы и подписи. Чистые правила экрана «Цели» без базы
import { describe, expect, it } from "vitest";
import {
  NO_OWNER,
  goalPeople,
  goalsHref,
  groupGoals,
  hasOwnGoals,
  hasUnowned,
  parseGroup,
  parsePeople,
  pruneSelection,
  selectGoals,
  selectedLabels,
  selectionState,
  toggleSlug,
} from "@/lib/goals/by-person";

type G = { id: string; owner: { slug: string; fullName: string } | null; team: { id: string; name: string } };

const ARAM = { slug: "muradyan", fullName: "Мурадян Арам" };
const VLAD = { slug: "golovkin", fullName: "Головкин Владислав" };
const TARAS = { slug: "reva", fullName: "Рева Тарас" };
const TOP = { id: "top", name: "Команда страхования и инвестиций" };
const OSAGO = { id: "osago", name: "Сектор ОСАГО" };

const goal = (id: string, owner: G["owner"], team: G["team"] = TOP): G => ({ id, owner, team });

describe("адрес экрана целей", () => {
  it("people читается списком через запятую без пустых значений и повторов", () => {
    expect(parsePeople("golovkin,reva")).toEqual(["golovkin", "reva"]);
    expect(parsePeople(" golovkin , ,reva,golovkin,")).toEqual(["golovkin", "reva"]);
    expect(parsePeople("")).toEqual([]);
    expect(parsePeople(undefined)).toEqual([]);
    expect(parsePeople(null)).toEqual([]);
  });
  it("слишком длинные значения и слишком длинный список из ссылки отбрасываются", () => {
    expect(parsePeople(`${"a".repeat(65)},reva`)).toEqual(["reva"]);
    const many = Array.from({ length: 80 }, (_, i) => `p${i}`).join(",");
    expect(parsePeople(many)).toHaveLength(50);
  });
  it("group=team включает команды, всё остальное люди", () => {
    expect(parseGroup("team")).toBe("team");
    expect(parseGroup("person")).toBe("person");
    expect(parseGroup("что-то")).toBe("person");
    expect(parseGroup(undefined)).toBe("person");
  });
  it("адрес собирается из квартала, людей и группы, значения по умолчанию в него не попадают", () => {
    expect(goalsHref({})).toBe("/goals");
    expect(goalsHref({ quarter: "2026-Q4" })).toBe("/goals?q=2026-Q4");
    expect(goalsHref({ quarter: "2026-Q4", people: [], group: "person" })).toBe("/goals?q=2026-Q4");
    expect(goalsHref({ quarter: "2026-Q3", people: ["golovkin", "reva"], group: "team" })).toBe("/goals?q=2026-Q3&people=golovkin,reva&group=team");
    expect(goalsHref({ people: [NO_OWNER] })).toBe("/goals?people=_none");
  });
  it("адрес читается обратно тем же правилом", () => {
    const href = goalsHref({ quarter: "2026-Q4", people: ["golovkin", NO_OWNER], group: "team" });
    const params = new URLSearchParams(href.split("?")[1]);
    expect(parsePeople(params.get("people"))).toEqual(["golovkin", NO_OWNER]);
    expect(parseGroup(params.get("group"))).toBe("team");
  });
});

describe("люди в целях квартала", () => {
  const goals = [goal("1", TARAS), goal("2", ARAM), goal("3", VLAD), goal("4", ARAM), goal("5", null)];

  it("владельцы без повторов по алфавиту", () => {
    expect(goalPeople(goals).map((p) => p.fullName)).toEqual(["Головкин Владислав", "Мурадян Арам", "Рева Тарас"]);
  });
  it("цели без владельца и свои цели определяются отдельно", () => {
    expect(hasUnowned(goals)).toBe(true);
    expect(hasUnowned(goals.filter((g) => g.owner))).toBe(false);
    expect(hasOwnGoals(goals, "muradyan")).toBe(true);
    expect(hasOwnGoals(goals, "loginova")).toBe(false);
  });
});

describe("выбор людей после смены квартала или команды", () => {
  const people = [VLAD, ARAM];

  it("остаются только владельцы новых целей, порядок и повторы не мешают", () => {
    expect(pruneSelection(["reva", "muradyan", "golovkin", "muradyan"], people, false)).toEqual(["muradyan", "golovkin"]);
  });
  it("выбранного человека, которого в новом квартале нет, не остаётся: выбор пустеет", () => {
    expect(pruneSelection(["reva"], people, false)).toEqual([]);
  });
  it("«без владельца» остаётся, только если такие цели есть", () => {
    expect(pruneSelection([NO_OWNER, "golovkin"], people, true)).toEqual([NO_OWNER, "golovkin"]);
    expect(pruneSelection([NO_OWNER, "golovkin"], people, false)).toEqual(["golovkin"]);
  });
});

describe("отбор целей по людям", () => {
  const goals = [goal("1", ARAM), goal("2", VLAD), goal("3", null), goal("4", ARAM)];
  const ids = (list: G[]) => list.map((g) => g.id);

  it("пустой выбор показывает все цели, включая цели без владельца", () => {
    expect(ids(selectGoals(goals, []))).toEqual(["1", "2", "3", "4"]);
  });
  it("выбор людей оставляет только их цели", () => {
    expect(ids(selectGoals(goals, ["muradyan"]))).toEqual(["1", "4"]);
    expect(ids(selectGoals(goals, ["muradyan", "golovkin"]))).toEqual(["1", "2", "4"]);
  });
  it("цели без владельца попадают только по метке, отдельно или вместе с людьми", () => {
    expect(ids(selectGoals(goals, [NO_OWNER]))).toEqual(["3"]);
    expect(ids(selectGoals(goals, [NO_OWNER, "golovkin"]))).toEqual(["2", "3"]);
  });
  it("человек без целей даёт пустой список", () => {
    expect(selectGoals(goals, ["reva"])).toEqual([]);
  });
});

describe("три состояния отбора и выбор в меню", () => {
  it("все, только мои и выбранные взаимоисключающие", () => {
    expect(selectionState([], "muradyan")).toBe("all");
    expect(selectionState(["muradyan"], "muradyan")).toBe("mine");
    expect(selectionState(["golovkin"], "muradyan")).toBe("picked");
    expect(selectionState(["muradyan", "golovkin"], "muradyan")).toBe("picked");
    expect(selectionState([NO_OWNER], "muradyan")).toBe("picked");
  });
  it("человека добавляют и убирают, остальные остаются", () => {
    expect(toggleSlug(["a", "b"], "c", true)).toEqual(["a", "b", "c"]);
    expect(toggleSlug(["a", "b"], "a", false)).toEqual(["b"]);
    expect(toggleSlug(["a"], "a", true)).toEqual(["a"]);
    expect(toggleSlug([], "a", false)).toEqual([]);
  });
});

describe("подписи выбранных", () => {
  const names: Record<string, string> = { muradyan: "Мурадян Арам", golovkin: "Головкин Владислав", reva: "Рева Тарас" };
  const nameOf = (slug: string) => names[slug] ?? slug;

  it("по алфавиту, «Без владельца» последней", () => {
    expect(selectedLabels([NO_OWNER, "reva", "muradyan", "golovkin"], nameOf)).toEqual(["Головкин Владислав", "Мурадян Арам", "Рева Тарас", "Без владельца"]);
  });
  it("неизвестный слаг называется через переданную функцию, а не «Я»", () => {
    expect(selectedLabels(["ghost"], nameOf)).toEqual(["ghost"]);
  });
});

describe("группы целей, одно правило для карточек и таблицы", () => {
  const goals = [
    goal("1", ARAM),
    goal("2", null),
    goal("3", VLAD, OSAGO),
    goal("4", TARAS),
    goal("5", ARAM, OSAGO),
    goal("6", null, OSAGO),
  ];

  it("по людям: по алфавиту, «Без владельца» последней, внутри группы порядок целей с сервера", () => {
    const groups = groupGoals(goals, "person");
    expect(groups.map((g) => g.label)).toEqual(["Головкин Владислав", "Мурадян Арам", "Рева Тарас", "Без владельца"]);
    expect(groups.map((g) => g.key)).toEqual(["golovkin", "muradyan", "reva", NO_OWNER]);
    expect(groups[1]!.goals.map((g) => g.id)).toEqual(["1", "5"]);
    expect(groups[3]!.goals.map((g) => g.id)).toEqual(["2", "6"]);
  });
  it("«Без владельца» последняя, даже если такие цели идут первыми", () => {
    const groups = groupGoals([goal("1", null), goal("2", TARAS)], "person");
    expect(groups.map((g) => g.label)).toEqual(["Рева Тарас", "Без владельца"]);
  });
  it("порядок по людям не зависит от порядка целей на входе", () => {
    const direct = groupGoals(goals, "person").map((g) => g.key);
    const reversed = groupGoals([...goals].reverse(), "person").map((g) => g.key);
    expect(reversed).toEqual(direct);
  });
  it("по командам: в порядке целей с сервера, цели департамента первыми", () => {
    const groups = groupGoals(goals, "team");
    expect(groups.map((g) => g.label)).toEqual(["Команда страхования и инвестиций", "Сектор ОСАГО"]);
    expect(groups[0]!.goals.map((g) => g.id)).toEqual(["1", "2", "4"]);
    expect(groups[1]!.goals.map((g) => g.id)).toEqual(["3", "5", "6"]);
  });
  it("пустой список даёт пустой список групп", () => {
    expect(groupGoals([], "person")).toEqual([]);
    expect(groupGoals([], "team")).toEqual([]);
  });
});
