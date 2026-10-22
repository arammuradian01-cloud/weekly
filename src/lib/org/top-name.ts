// Имя топ-команды (этап 66): с 22.10 она называется «Команда страхования и инвестиций». Тексты интерфейса и сообщения
// сервера берут имя из базы: владелец может переименовать команду, и тексты пойдут за ним. Внутреннее понятие в коде
// по-прежнему TOP_TEAM.

import { prisma } from "@/lib/db";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { TOP_TEAM, TOP_TEAM_NAME } from "@/domain/teams";

export { TOP_TEAM_NAME };

/** Прежнее имя топ-команды: старые файлы целей и выгрузки ещё пишут его, загрузка узнаёт команду и по нему */
export const TOP_TEAM_OLD_NAME = "Топ-команда";

export async function topTeamName(db: PrismaClient | Prisma.TransactionClient = prisma): Promise<string> {
  const row = await db.team.findUnique({ where: { id: TOP_TEAM }, select: { name: true } });
  return row?.name?.trim() || TOP_TEAM_NAME;
}
