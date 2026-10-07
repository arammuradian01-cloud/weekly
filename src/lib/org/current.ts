import "server-only";
// Выбранная команда (этап 14): переключатель в шапке пишет её в cookie, экраны задач, команды и weekly
// показывают её. Выбрать можно только видимую команду; без выбора открывается топ-команда, если человек в ней,
// иначе первая команда, которой он руководит, иначе первая, где он участник.

import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import type { Role } from "@/generated/prisma/enums";
import { TOP_TEAM, loadTeamNodes, scopeOf, teamPeopleIds, type Scope, type ScopeSubject, type TeamNode } from "./scope";

import { ALL_TEAMS } from "@/domain/teams";
import type { WeekAudience } from "@/lib/weekly/service";
import { expectedOf, leadersOf } from "./rhythm";

export const TEAM_COOKIE = "team";
export { ALL_TEAMS };

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

/** Команды по дереву: родитель, за ним его команды ниже, по порядку из настроек */
export function orderTeams(nodes: TeamNode[]): { node: TeamNode; depth: number }[] {
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string | null, TeamNode[]>();
  for (const n of nodes) {
    const parent = n.parentId && ids.has(n.parentId) ? n.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(n);
    children.set(parent, list);
  }
  const out: { node: TeamNode; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    const list = (children.get(parent) ?? []).sort((a, b) => Number(b.id === TOP_TEAM) - Number(a.id === TOP_TEAM) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru"));
    for (const n of list) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push({ node: n, depth });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  // Петля в дереве (команда ниже самой себя): такие команды всё равно показываем, в конце
  for (const n of nodes) if (!seen.has(n.id)) out.push({ node: n, depth: 0 });
  return out;
}

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

export function pickCurrent(options: TeamOption[], wanted: string | undefined): string | null {
  if (wanted === ALL_TEAMS && options.length > 1) return ALL_TEAMS;
  if (wanted && options.some((o) => o.id === wanted)) return wanted;
  if (options.some((o) => o.id === TOP_TEAM && (o.relation === "member" || o.relation === "leader"))) return TOP_TEAM;
  const led = options.find((o) => o.relation === "leader");
  if (led) return led.id;
  const member = options.find((o) => o.relation === "member");
  if (member) return member.id;
  // Видит всё, но ни в одной команде не состоит (например, наблюдатель): топ-команда
  if (options.some((o) => o.id === TOP_TEAM)) return TOP_TEAM;
  return options[0]?.id ?? null;
}

/** Чей доступ: профиль и как вошли. Общий логин без режима управления видит только топ-команду */
export function subjectOf(ctx: { person: { id: string; role: Role }; via: string; management: unknown }): ScopeSubject {
  return { id: ctx.person.id, role: ctx.person.role, limited: ctx.via === "TEAM" && !ctx.management };
}

export async function currentTeam(person: ScopeSubject): Promise<CurrentTeam> {
  const [nodes, functional, jar] = await Promise.all([
    loadTeamNodes(prisma),
    prisma.person.findMany({ where: { functionalManagerId: person.id }, select: { id: true } }),
    cookies(),
  ]);
  const scope = scopeOf(nodes, person, functional.map((p) => p.id));
  const options = teamOptions(nodes, scope, person.id);
  const id = pickCurrent(options, jar.get(TEAM_COOKIE)?.value);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let people: string[];
  let name: string;
  if (id === ALL_TEAMS) {
    people = [...new Set(options.flatMap((o) => (byId.get(o.id) ? teamPeopleIds(byId.get(o.id)!) : [])))];
    name = "Все мои команды";
  } else if (id) {
    people = teamPeopleIds(byId.get(id)!);
    name = byId.get(id)!.name;
  } else {
    people = [person.id];
    name = "Без команды";
  }
  return { id, name, options, scope, nodes, people };
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

/** Weekly топ-команды: отчёт CEO собирается из него, как и раньше, плюс отмеченные записи любой команды */
export async function topAudience(): Promise<WeekAudience> {
  const top = await prisma.team.findUnique({ where: { id: TOP_TEAM }, include: { members: { select: { personId: true } } } });
  if (!top) return { personIds: [], shared: true, ceo: true, teamIds: [TOP_TEAM] };
  const people = [...new Set([...(top.leaderId ? [top.leaderId] : []), ...top.members.map((m) => m.personId)])];
  return { personIds: people, authorIds: people, shared: true, ceo: true, teamIds: [TOP_TEAM] };
}
