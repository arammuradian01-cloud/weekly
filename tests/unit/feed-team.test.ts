import { describe, expect, it } from "vitest";
import { audienceOf, feedTeamFor, type CurrentTeam, type TeamOption } from "@/lib/org/audience";
import { ALL_TEAMS, TOP_TEAM } from "@/domain/teams";
import type { TeamNode } from "@/lib/org/scope";

// Этап 39: где смотреть weekly человека по ссылке из дерева подчинённых

const node = (id: string, name: string, leaderId: string | null, parentId: string | null, members: string[], depth = 0): TeamNode & { depth: number } => ({
  id,
  name,
  kind: id === TOP_TEAM ? "TOP" : "UNIT",
  leaderId,
  parentId,
  unitId: null,
  active: true,
  sortOrder: 0,
  members,
  rhythm: { deadline: null, meeting: null, specialists: false },
  depth,
});

// Топ-команда: Арам и Рева. Управление Ревы: Антонов (руководит сектором). Сектор Антонова: Алиса
const nodes = [
  node(TOP_TEAM, "Топ-команда", "aram", null, ["reva"]),
  node("upr", "Управление развития продуктов", "reva", null, ["antonov"]),
  node("sector", "Сектор автострахования", "antonov", "upr", ["alisa"], 1),
];
const options: TeamOption[] = nodes.map((n) => ({ id: n.id, name: n.name, depth: n.depth, relation: "all" }));
const current = (id: string | null, opts = options): CurrentTeam => ({
  id,
  name: id === ALL_TEAMS ? "Все мои команды" : (nodes.find((n) => n.id === id)?.name ?? "Без команды"),
  options: opts,
  scope: { all: true, member: [], leads: [], visible: opts.map((o) => o.id), functional: [], leadPeople: [] },
  nodes,
  people: [],
});

describe("feedTeamFor", () => {
  it("человек в ленте выбранной команды: отбор сразу", () => {
    expect(feedTeamFor(current(TOP_TEAM), "reva")).toEqual({ here: true, team: null });
    expect(feedTeamFor(current(TOP_TEAM), "aram")).toEqual({ here: true, team: null });
  });

  it("weekly руководителя команды в команде выше, а не в его собственной", () => {
    // Антонов руководит сектором: в ленте сектора его нет, он в ленте управления
    expect(feedTeamFor(current("sector"), "antonov")).toEqual({ here: false, team: { id: "upr", name: "Управление развития продуктов" } });
  });

  it("из нескольких подходящих команд берётся самая узкая", () => {
    // Алиса в ленте сектора (участник). Управление её не включает: участник сектора не участник управления
    expect(feedTeamFor(current(TOP_TEAM), "alisa")).toEqual({ here: false, team: { id: "sector", name: "Сектор автострахования" } });
  });

  it("все мои команды включают всех из видимых команд", () => {
    expect(feedTeamFor(current(ALL_TEAMS), "alisa")).toEqual({ here: true, team: null });
  });

  it("человек вне видимых команд: команды нет", () => {
    const onlyTop = options.filter((o) => o.id === TOP_TEAM);
    expect(feedTeamFor(current(TOP_TEAM, onlyTop), "alisa")).toEqual({ here: false, team: null });
    expect(feedTeamFor(current(TOP_TEAM), "stranger")).toEqual({ here: false, team: null });
  });

  it("без команды лента из самого человека", () => {
    const none: CurrentTeam = { ...current(null, []), people: ["me"] };
    expect(audienceOf(none)).toEqual({ personIds: ["me"], shared: false });
    expect(feedTeamFor(none, "me")).toEqual({ here: true, team: null });
    expect(feedTeamFor(none, "reva")).toEqual({ here: false, team: null });
  });
});
