import type { Role } from "@/generated/prisma/enums";
import type { ManagementRole } from "./session";
import type { PasswordKind } from "./passwords";

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Владелец",
  ADMIN: "Администратор",
  LEADER: "Лидер",
  OBSERVER: "Наблюдатель",
  EMPLOYEE: "Сотрудник",
};

/**
 * Подпись роли человека (этап 52): владельцев несколько, главный подписан «Владелец», остальные «Совладелец».
 * Этап 69: подпись владельца задаёт главный владелец (title), например «ex-Владелец». Права она не меняет
 */
export function personRoleLabel(role: Role, primaryOwner: boolean, title?: string | null): string {
  if (role === "OWNER") {
    const own = title?.trim();
    if (own) return own;
    if (!primaryOwner) return "Совладелец";
  }
  return ROLE_LABELS[role];
}

/** Что нужно для подписи роли владельцев: главный владелец и подписи, которые задал главный (этап 69) */
export type OwnerLabels = { primary: string | null; titles: Record<string, string> };

/** Подпись роли человека по главному владельцу и подписям владельцев */
export function roleLabelOf(person: { slug: string; role: Role }, owners: OwnerLabels): string {
  return personRoleLabel(person.role, person.role === "OWNER" && person.slug === owners.primary, owners.titles[person.slug]);
}

/** Режим управления доступен только профилям владельца и администраторов */
export function managementRoleFor(role: Role): ManagementRole | null {
  if (role === "OWNER") return "OWNER";
  if (role === "ADMIN") return "ADMIN";
  return null;
}

/** Какой пароль открывает режим управления для роли: у владельца свой, у администраторов свой */
export function managementPasswordKind(role: ManagementRole): PasswordKind {
  return role === "OWNER" ? "owner" : "admin";
}

/** Кто открывает разделы режима управления. Этими же списками закрыты страницы, и их же проверяет тест матрицы */
export const JOURNAL_ROLES: ManagementRole[] = ["OWNER", "ADMIN"];
export const OWNER_ROLES: ManagementRole[] = ["OWNER"];

/** Общий журнал изменений: владелец и администраторы в режиме управления (матрица раздела 2) */
export function canSeeJournal(management: ManagementRole | null, role: Role): boolean {
  return role !== "OBSERVER" && management !== null && JOURNAL_ROLES.includes(management);
}

/** Разделы, которые видит режим управления. Люди, пароли и синхронизация только у владельца */
export function canSeeOwnerSections(role: ManagementRole | null): boolean {
  return role !== null && OWNER_ROLES.includes(role);
}
