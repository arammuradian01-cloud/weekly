import type { Role } from "@/generated/prisma/enums";
import type { ManagementRole } from "./session";
import type { PasswordKind } from "./passwords";

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Владелец",
  ADMIN: "Администратор",
  LEADER: "Лидер",
  OBSERVER: "Наблюдатель",
};

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
