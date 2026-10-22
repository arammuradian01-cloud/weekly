// Главный владелец (этап 52). Владельцев может быть несколько: главный (Крайник) и совладельцы с теми же правами
// администрирования. Главного владельца меняет только он сам: совладелец не понижает и не выключает его, не сбрасывает
// ему пароль, не завершает его входы и не назначает главным себя. Отдельный модуль без зависимостей от сервисов людей
// и входа: его вызывают и те, и другие.

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { TaskRuleError } from "@/lib/tasks/service";
import { OWNER_TITLES_KEY, ownerTitlesFrom } from "@/lib/owner-title";
import type { OwnerLabels } from "@/lib/roles";

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

/** Подписи ролей владельцев (этап 69): { слаг: подпись }. Подпись задаёт главный владелец в «Настройках» */
export async function ownerTitles(db: Db = prisma): Promise<Record<string, string>> {
  const row = await db.setting.findUnique({ where: { key: OWNER_TITLES_KEY } });
  return ownerTitlesFrom(row?.value);
}

/** Главный владелец и подписи владельцев: всё, что нужно экранам для подписи роли (roleLabelOf) */
export async function ownerLabels(db: Db = prisma): Promise<OwnerLabels> {
  // По очереди: в транзакции запросы идут по одному соединению
  const primary = await primaryOwnerSlug(db);
  return { primary, titles: await ownerTitles(db) };
}

/** Действие над главным владельцем делает только он сам. what: «понижает роль», «сбрасывает пароль» */
export async function guardPrimary(db: Db, actorSlug: string, targetSlug: string, what: string): Promise<void> {
  if (actorSlug === targetSlug) return;
  if ((await primaryOwnerSlug(db)) === targetSlug) throw new TaskRuleError(`Главного владельца меняет только он сам: совладелец не ${what}`);
}
