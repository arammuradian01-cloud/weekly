// Главный владелец (этап 52). Владельцев может быть несколько: главный (Крайник) и совладельцы с теми же правами
// администрирования. Главного владельца меняет только он сам: совладелец не понижает и не выключает его, не сбрасывает
// ему пароль, не завершает его входы и не назначает главным себя. Отдельный модуль без зависимостей от сервисов людей
// и входа: его вызывают и те, и другие.

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { TaskRuleError } from "@/lib/tasks/service";

type Db = Prisma.TransactionClient | typeof prisma;

export const PRIMARY_OWNER_KEY = "owner.primary";

/** Главный владелец: из настройки, а если она пуста или указывает не на включённого владельца, первый владелец списка */
export async function primaryOwnerSlug(db: Db = prisma): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key: PRIMARY_OWNER_KEY } });
  const slug = typeof row?.value === "string" ? row.value : null;
  if (slug) {
    const p = await db.person.findFirst({ where: { slug, role: "OWNER", active: true }, select: { slug: true } });
    if (p) return p.slug;
  }
  const first = await db.person.findFirst({ where: { role: "OWNER", active: true }, orderBy: [{ sortOrder: "asc" }, { fullName: "asc" }], select: { slug: true } });
  return first?.slug ?? null;
}

/** Главный владелец человеком: для подписей, повестки и корня структуры */
export async function primaryOwner(db: Db = prisma) {
  const slug = await primaryOwnerSlug(db);
  return slug ? db.person.findUnique({ where: { slug } }) : null;
}

/** Действие над главным владельцем делает только он сам. what: «понижает роль», «сбрасывает пароль» */
export async function guardPrimary(db: Db, actorSlug: string, targetSlug: string, what: string): Promise<void> {
  if (actorSlug === targetSlug) return;
  if ((await primaryOwnerSlug(db)) === targetSlug) throw new TaskRuleError(`Главного владельца меняет только он сам: совладелец не ${what}`);
}
