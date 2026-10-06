import "server-only";
// Выбранная команда (этап 14): переключатель в шапке пишет её в cookie, экраны задач, команды и weekly
// показывают её. Выбрать можно только видимую команду; без выбора открывается топ-команда, если человек в ней,
// иначе первая команда, которой он руководит, иначе первая, где он участник.

import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import type { Role } from "@/generated/prisma/enums";
import { TOP_TEAM, loadTeamNodes, scopeOf, teamPeopleIds, type Scope, type TeamNode } from "./scope";

import { ALL_TEAMS } from "@/domain/teams";

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

export async function currentTeam(person: { id: string; role: Role }): Promise<CurrentTeam> {
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

/** Чей weekly показывать для выбранной команды. Общие записи без автора бывают только у топ-команды */
export function audienceOf(current: CurrentTeam): { personIds: string[]; shared: boolean } {
  const shared = current.id === TOP_TEAM || (current.id === ALL_TEAMS && current.options.some((o) => o.id === TOP_TEAM));
  return { personIds: current.people, shared };
}

/** Weekly топ-команды: для отчёта CEO он собирается из неё, как и раньше */
export async function topAudience(): Promise<{ personIds: string[]; shared: boolean }> {
  const top = await prisma.team.findUnique({ where: { id: TOP_TEAM }, include: { members: { select: { personId: true } } } });
  if (!top) return { personIds: [], shared: true };
  return { personIds: [...new Set([...(top.leaderId ? [top.leaderId] : []), ...top.members.map((m) => m.personId)])], shared: true };
}
