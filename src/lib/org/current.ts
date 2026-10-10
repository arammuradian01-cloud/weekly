import "server-only";
// Выбранная команда (этап 14): переключатель в шапке пишет её в cookie, экраны задач, команды и weekly
// показывают её. Выбрать можно только видимую команду; без выбора открывается топ-команда, если человек в ней,
// иначе первая команда, которой он руководит, иначе первая, где он участник.

import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import type { Role } from "@/generated/prisma/enums";
import { TOP_TEAM, loadTeamNodes, orderTeams, scopeOf, teamPeopleIds, type Scope, type ScopeSubject, type TeamNode } from "./scope";

export { orderTeams };

import { ALL_TEAMS } from "@/domain/teams";
import type { WeekAudience } from "@/lib/weekly/service";
import type { CurrentTeam, TeamOption } from "./audience";

export { audienceOf, feedTeamFor, type CurrentTeam, type TeamOption } from "./audience";

export const TEAM_COOKIE = "team";
export { ALL_TEAMS };

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
  return { id: ctx.person.id, role: ctx.person.role, limited: ctx.via === "TEAM" && !ctx.management, shared: ctx.via === "TEAM" };
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

/** Weekly топ-команды: отчёт CEO собирается из него, как и раньше, плюс отмеченные записи любой команды */
export async function topAudience(): Promise<WeekAudience> {
  const top = await prisma.team.findUnique({ where: { id: TOP_TEAM }, include: { members: { select: { personId: true } } } });
  if (!top) return { personIds: [], shared: true, ceo: true, teamIds: [TOP_TEAM] };
  const people = [...new Set([...(top.leaderId ? [top.leaderId] : []), ...top.members.map((m) => m.personId)])];
  return { personIds: people, authorIds: people, shared: true, ceo: true, teamIds: [TOP_TEAM] };
}
