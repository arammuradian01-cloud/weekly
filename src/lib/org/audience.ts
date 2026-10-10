// Лента weekly выбранной команды (этапы 14-15) и поиск команды, в ленте которой есть человек (этап 39).
// Чистые функции без базы и cookie: их считают и сервер, и тесты

import { ALL_TEAMS, TOP_TEAM } from "@/domain/teams";
import type { WeekAudience } from "@/lib/weekly/service";
import { expectedOf, leadersOf } from "./rhythm";
import { teamPeopleIds, type Scope, type TeamNode } from "./scope";

export type TeamOption = {
  id: string;
  name: string;
  /** Отступ в списке: глубина в дереве команд */
  depth: number;
  /** Как человек связан с командой: участник, руководитель или видит её как команду ниже своей */
  relation: "member" | "leader" | "below" | "all";
};

export type CurrentTeam = {
  /** id выбранной команды, ALL_TEAMS или null, если человека ещё не добавили ни в одну команду */
  id: string | null;
  name: string;
  options: TeamOption[];
  scope: Scope;
  nodes: TeamNode[];
  /** id людей выбранной команды (руководитель и участники) */
  people: string[];
};

/**
 * Чей weekly показывать для выбранной команды (этапы 14-15). В полосе сдачи те, от кого команда ждёт weekly,
 * в ленте записи всех участников и то, что они подняли наверх из своих команд. Weekly руководителя команды
 * принадлежит команде выше: в ленте его собственной команды его нет. Общие записи без автора только у топ-команды
 */
export function audienceOf(current: CurrentTeam): WeekAudience {
  const shared = current.id === TOP_TEAM || (current.id === ALL_TEAMS && current.options.some((o) => o.id === TOP_TEAM));
  const ids = current.id === ALL_TEAMS ? current.options.map((o) => o.id) : current.id ? [current.id] : [];
  if (!ids.length) return { personIds: current.people, shared };
  const byId = new Map(current.nodes.map((n) => [n.id, n]));
  const leaders = leadersOf(current.nodes);
  const expected = new Set<string>();
  const authors = new Set<string>();
  for (const id of ids) {
    const n = byId.get(id);
    if (!n) continue;
    for (const m of expectedOf(n, leaders)) expected.add(m);
    for (const m of n.members) authors.add(m);
    if (n.id === TOP_TEAM && n.leaderId) authors.add(n.leaderId);
  }
  return { personIds: [...expected], authorIds: [...authors], shared, teamIds: ids };
}

/** Есть ли человек в ленте: от него ждут weekly или его записи в ней видны */
function inAudience(audience: WeekAudience, personId: string): boolean {
  return audience.personIds.includes(personId) || (audience.authorIds ?? []).includes(personId);
}

/**
 * Где смотреть weekly человека (этап 39, ссылка из дерева подчинённых). here: человек в ленте выбранной команды.
 * Иначе самая узкая из видимых команд, в ленте которой он есть, или null: ни одна видимая команда его не включает
 */
export function feedTeamFor(current: CurrentTeam, personId: string): { here: boolean; team: { id: string; name: string } | null } {
  if (inAudience(audienceOf(current), personId)) return { here: true, team: null };
  const byId = new Map(current.nodes.map((n) => [n.id, n]));
  let best: TeamOption | null = null;
  for (const o of current.options) {
    const node = byId.get(o.id);
    if (!node) continue;
    if (!inAudience(audienceOf({ ...current, id: o.id, name: o.name, people: teamPeopleIds(node) }), personId)) continue;
    if (!best || o.depth > best.depth) best = o;
  }
  return { here: false, team: best ? { id: best.id, name: best.name } : null };
}
