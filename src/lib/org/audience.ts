// Лента weekly выбранной команды (этапы 14-15) и поиск команды, в ленте которой есть человек (этап 39).
// Чистые функции без базы и cookie: их считают и сервер, и тесты

import { ALL_TEAMS, TOP_TEAM } from "@/domain/teams";
import type { WeekAudience } from "@/lib/weekly/service";
import { expectedOf, leadersOf } from "./rhythm";
import { orderTeams, teamPeopleIds, type Scope, type TeamNode } from "./scope";

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

/** Команды, которые человек может выбрать в шапке: видимые активные, по дереву */
export function teamOptions(nodes: TeamNode[], scope: Scope, personId: string): TeamOption[] {
  const visible = new Set(scope.visible);
  const ordered = orderTeams(nodes.filter((n) => n.active && visible.has(n.id)));
  return ordered.map(({ node, depth }) => ({
    id: node.id,
    name: node.name,
    depth,
    relation: node.leaderId === personId ? "leader" : node.members.includes(personId) ? "member" : scope.all ? "all" : "below",
  }));
}

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

/** Глубина команды в общем дереве команд, а не только среди видимых: корень 0 */
function depthIn(byId: Map<string, TeamNode>, id: string): number {
  let depth = 0;
  const seen = new Set<string>([id]);
  for (let cur = byId.get(id)?.parentId; cur && !seen.has(cur); cur = byId.get(cur)?.parentId) {
    seen.add(cur);
    depth += 1;
  }
  return depth;
}

/**
 * Где смотреть weekly человека (этап 39, ссылка из дерева подчинённых). here: человек в ленте выбранной команды.
 * Иначе из видимых команд, в ленте которых он есть: сначала та, что ждёт его weekly, потом самая глубокая в дереве
 * команд; при равенстве первая по порядку. null: ни одна видимая команда его не включает
 */
export function feedTeamFor(current: CurrentTeam, personId: string): { here: boolean; team: { id: string; name: string } | null } {
  if (inAudience(audienceOf(current), personId)) return { here: true, team: null };
  const byId = new Map(current.nodes.map((n) => [n.id, n]));
  let best: { option: TeamOption; expected: boolean; depth: number } | null = null;
  for (const o of current.options) {
    const node = byId.get(o.id);
    if (!node) continue;
    const audience = audienceOf({ ...current, id: o.id, name: o.name, people: teamPeopleIds(node) });
    if (!inAudience(audience, personId)) continue;
    const candidate = { option: o, expected: audience.personIds.includes(personId), depth: depthIn(byId, o.id) };
    if (!best || (candidate.expected && !best.expected) || (candidate.expected === best.expected && candidate.depth > best.depth)) best = candidate;
  }
  return { here: false, team: best ? { id: best.option.id, name: best.option.name } : null };
}

/** Люди, чей weekly есть в лентах видимых команд: ссылка «Weekly» в дереве ведёт не в тупик (этап 39) */
export function weeklyPeople(current: Pick<CurrentTeam, "options" | "nodes" | "scope">, viewerId: string): Set<string> {
  const ids = current.options.length ? ALL_TEAMS : null;
  const audience = audienceOf({ id: ids, name: "", options: current.options, scope: current.scope, nodes: current.nodes, people: [viewerId] });
  return new Set([...audience.personIds, ...(audience.authorIds ?? [])]);
}
