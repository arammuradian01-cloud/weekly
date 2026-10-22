// Условия на людей (этап 14): для выбора профиля при общем логине (этап 71: все люди структуры) и списков коллег.

import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";

/**
 * Кого можно выбрать по общему логину team (этап 71): все включённые люди структуры, у которых ещё нет личного пароля
 * (Person.passwordHash), и не владельцы. Человек с личным паролем входит сам: по общему логину его профиль никто не
 * откроет. Владелец входит только лично. Тем же условием проверяет выбор сервер (chooseProfile) и каждый запрос
 * общего логина (requireContext)
 */
export const teamChoosableWhere = { active: true, role: { not: "OWNER" }, passwordHash: null } satisfies Prisma.PersonWhereInput;

/** То же условие для уже прочитанного человека */
export function teamChoosable(person: { active: boolean; role: Role; passwordHash: string | null }): boolean {
  return person.active && person.role !== "OWNER" && !person.passwordHash;
}

/** Коллеги: люди из команд, где человек участник или руководитель */
export function colleaguesOf(personId: string): Prisma.PersonWhereInput {
  const myTeams: Prisma.TeamWhereInput = { OR: [{ leaderId: personId }, { members: { some: { personId } } }] };
  return { OR: [{ teams: { some: { team: myTeams } } }, { leads: { some: myTeams } }] };
}
