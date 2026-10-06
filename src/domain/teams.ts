// Команды департамента для экранов (этап 14). Снимок приходит с сервера вместе с людьми и справочниками.

import type { PersonSlug } from "./types";

/** id топ-команды: её создаёт миграция, все задачи до команд принадлежат ей */
export const TOP_TEAM = "top";
/** «Все мои команды» в переключателе */
export const ALL_TEAMS = "*";

export type TeamEntry = {
  id: string;
  name: string;
  kind: "TOP" | "UNIT" | "CUSTOM";
  leader: PersonSlug | null;
  parent: string | null;
  members: PersonSlug[];
  active: boolean;
};

export const TEAMS: TeamEntry[] = [];

export function applyTeams(list: TeamEntry[]) {
  TEAMS.splice(0, TEAMS.length, ...list);
}

export function teamOf(id: string | null | undefined): TeamEntry | undefined {
  return id ? TEAMS.find((t) => t.id === id) : undefined;
}

export function teamName(id: string | null | undefined): string {
  if (id === ALL_TEAMS) return "Все мои команды";
  return teamOf(id)?.name ?? (id === TOP_TEAM ? "Топ-команда" : "Команда");
}

/** Люди команды: руководитель и участники */
export function teamPeople(team: TeamEntry): PersonSlug[] {
  return [...new Set([...(team.leader ? [team.leader] : []), ...team.members])];
}
