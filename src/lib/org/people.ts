// Условия на людей (этап 14): для выбора профиля при общем логине (этап 71: все люди структуры) и списков коллег.

import type { Prisma } from "@/generated/prisma/client";

/**
 * Кого можно выбрать по общему логину team (этап 71): все включённые люди структуры, у которых ещё нет личного пароля
 * (Person.passwordHash). Человек с личным паролем входит сам: по общему логину его профиль никто не откроет. Владелец
 * без личного пароля в списке есть (поправка Арама 23.10), но по общему логину режим управления, «Смотреть как» и вход
 * в чужой профиль ему закрыты (requireContext, managementContext). Тем же условием проверяет выбор сервер
 * (chooseProfile) и каждый запрос общего логина (requireContext)
 */
export const teamChoosableWhere = { active: true, passwordHash: null } satisfies Prisma.PersonWhereInput;

/** То же условие для уже прочитанного человека */
export function teamChoosable(person: { active: boolean; passwordHash: string | null }): boolean {
  return person.active && !person.passwordHash;
}

/** Коллеги: люди из команд, где человек участник или руководитель */
export function colleaguesOf(personId: string): Prisma.PersonWhereInput {
  const myTeams: Prisma.TeamWhereInput = { OR: [{ leaderId: personId }, { members: { some: { personId } } }] };
  return { OR: [{ teams: { some: { team: myTeams } } }, { leads: { some: myTeams } }] };
}
