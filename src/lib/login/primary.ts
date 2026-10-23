// [Codex] Главный владелец нужен для подписей и корня структуры. У всех владельцев равные права управления;
// owner.primary не является дополнительной границей доступа.

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
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

/** Подписи ролей владельцев: { слаг: подпись }. Их задаёт любой владелец в «Настройках» */
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
