// Кто видит цифры прогноза и денег (этап 57). Решение Арама 21.10: приложение для всей компании, раздел «Прогноз»
// видят все, но цифры (бюджет и LBE из LRF, прогноз месяца, цифры недели, партнёры) пока только у департамента
// страхования и инвестиций и топ-команды Арама. Прогнозы других продуктов добавятся позже, каждый своим.
//
// Свой департамент: подразделение уровня «департамент», которым руководит руководитель топ-команды, со всеми
// подразделениями ниже. Владельцы и администраторы видят всё.

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { TOP_TEAM } from "@/lib/org/scope";

type Db = Prisma.TransactionClient | typeof prisma;
type Who = { personId: string; role: string; management?: string | null };

export const NUMBERS_CLOSED_TEXT = "Прогноз и цифры сейчас ведёт департамент страхования и инвестиций. Прогнозы других продуктов появятся здесь позже, каждый для своей команды.";

export async function canSeeNumbers(who: Who, db: Db = prisma): Promise<boolean> {
  if (who.management || who.role === "OWNER" || who.role === "ADMIN") return true;
  const [top, person] = await Promise.all([
    db.team.findUnique({ where: { id: TOP_TEAM }, select: { leaderId: true, members: { select: { personId: true } } } }),
    db.person.findUnique({ where: { id: who.personId }, select: { unitId: true } }),
  ]);
  if (!top) return false;
  if (top.leaderId === who.personId || top.members.some((m) => m.personId === who.personId)) return true;
  if (!person?.unitId || !top.leaderId) return false;
  const units = await db.orgUnit.findMany({ select: { id: true, parentId: true, kind: true, headId: true, active: true } });
  const home = units.find((u) => u.kind === "DEPARTMENT" && u.active && u.headId === top.leaderId);
  if (!home) return false;
  const byId = new Map(units.map((u) => [u.id, u]));
  const seen = new Set<string>();
  for (let cur = byId.get(person.unitId); cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    if (cur.id === home.id) return true;
    seen.add(cur.id);
  }
  return false;
}
