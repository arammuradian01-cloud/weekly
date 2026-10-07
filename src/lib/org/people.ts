// Условия на людей по командам (этап 14): для выбора профиля при общем логине и списков коллег.

import type { Prisma } from "@/generated/prisma/client";
import { TOP_TEAM } from "@/domain/teams";

/** Люди топ-команды: участники и руководитель */
export const topTeamOnly: Prisma.PersonWhereInput = {
  OR: [{ teams: { some: { teamId: TOP_TEAM } } }, { leads: { some: { id: TOP_TEAM } } }],
};

/** Коллеги: люди из команд, где человек участник или руководитель */
export function colleaguesOf(personId: string): Prisma.PersonWhereInput {
  const myTeams: Prisma.TeamWhereInput = { OR: [{ leaderId: personId }, { members: { some: { personId } } }] };
  return { OR: [{ teams: { some: { team: myTeams } } }, { leads: { some: myTeams } }] };
}
