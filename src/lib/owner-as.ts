// «Сменить профиль» у владельца (этап 71). Владелец при личном входе (не по общему логину) входит в профиль другого
// включённого человека: экраны, права и правки как у этого человека, каждая запись журнала с пометкой, кто из владельцев
// вошёл (способ входа OWNER_AS и ФИО владельца). Возврат в свой профиль без пароля, только с того же устройства и только
// к тому владельцу, который вошёл: состояние входа лежит в подписанной cookie сессии (поле ownerAs в src/lib/session.ts),
// владелец в ней остаётся хозяином записи устройства, человек, в чей профиль вошли, только targetId.
//
// Модуль без базы: срок, правила, тексты и метка вкладки. Проверка на каждом запросе во входе (src/lib/auth.ts), начало
// и конец с записью в журнал в src/lib/owner-as-service.ts. Его берут и тесты.

import type { Role } from "@/generated/prisma/enums";
import type { OwnerAsGrant } from "./session";
import { TaskRuleError } from "./rule-error";
import { OWNER_AS_ENDED, OWNER_AS_STALE } from "./view-as-texts";

export { OWNER_AS_ENDED, OWNER_AS_STALE };

/** Вход в чужой профиль живёт не дольше обычного режима управления: 12 часов */
export const OWNER_AS_TTL_MS = 12 * 60 * 60 * 1000;

export const OWNER_AS_TEXTS = {
  ownerOnly: "Входить в профиль другого человека может только владелец",
  personal: "В профиль другого человека входят только при личном входе, не по общему логину",
  email: "В профиль другого человека владелец входит только после входа своим логином и паролем: вход по ссылке на почту для этого не подходит",
  viewing: "Сначала выйдите из просмотра «Смотреть как»",
  inside: "Вы уже в профиле другого человека: сначала вернитесь в свой профиль",
  missing: "Такого человека нет",
  inactive: "Нельзя войти в профиль выключенного человека",
  self: "Это вы: выберите другого человека",
  owner: "В профиль другого владельца войти нельзя",
  management: "Во время входа в профиль другого человека режим управления недоступен. Сначала вернитесь в свой профиль",
  viewAs: "Во время входа в профиль другого человека «Смотреть как» недоступно. Сначала вернитесь в свой профиль",
  account:
    "Во время входа владельца учётная запись человека закрыта: пароль, логин, почту, входы на устройствах, ссылку на календарь и уведомления он меняет только сам",
  notInside: "Вы и так в своём профиле",
} as const;

/**
 * Кто входит: профиль, его роль, личный ли вход, вошёл ли он по ссылке на почту, идёт ли просмотр «Смотреть как», идёт
 * ли уже вход в чужой профиль
 */
export type OwnerAsStarter = { personId: string; role: Role; personal: boolean; byEmail: boolean; viewing: boolean; inside: boolean };

/**
 * Можно ли войти в профиль. null: можно. Только владелец, только при личном входе и не по ссылке на почту, не во время
 * просмотра и не во время другого такого входа (из него только возврат). Входить можно только к включённому человеку,
 * не к себе и не к другому владельцу: владельцы равны, а вход в чужой профиль открыл бы роль OWNER в профиле другого
 * владельца, с его учётной записью и правками от его имени
 */
export function ownerAsStartError(who: OwnerAsStarter, target: { id: string; active: boolean; role: Role } | null): string | null {
  if (who.inside) return OWNER_AS_TEXTS.inside;
  // Во время просмотра профиль выбранного человека, а не владельца: сначала понятный отказ про просмотр
  if (who.viewing) return OWNER_AS_TEXTS.viewing;
  if (who.role !== "OWNER") return OWNER_AS_TEXTS.ownerOnly;
  if (!who.personal) return OWNER_AS_TEXTS.personal;
  // Доступ к одной почте не даёт права владельца (как с режимом управления, src/lib/login/service.ts): из входа по ссылке
  // на почту в чужой профиль не входят
  if (who.byEmail) return OWNER_AS_TEXTS.email;
  if (!target) return OWNER_AS_TEXTS.missing;
  if (target.id === who.personId) return OWNER_AS_TEXTS.self;
  if (!target.active) return OWNER_AS_TEXTS.inactive;
  if (target.role === "OWNER") return OWNER_AS_TEXTS.owner;
  return null;
}

/** До какого момента действует вход: 12 часов от начала */
export function ownerAsUntil(now: number): number {
  return now + OWNER_AS_TTL_MS;
}

/** Почему вход закончился: для журнала (поле записи «ownerAs.stop») и плашки */
export type OwnerAsEnd = "return" | "logout" | "expired" | "inactive" | "promoted" | "role" | "owner" | "session";

export const OWNER_AS_END_TEXTS: Record<OwnerAsEnd, string> = {
  return: "Вернулся в свой профиль",
  logout: "Выход из ресурса",
  expired: "Вышел срок входа",
  inactive: "Человек выключен",
  promoted: "Человек стал владельцем",
  role: "Снята роль владельца",
  owner: "Владелец выключен",
  session: "Вход завершён",
};

/**
 * Можно ли после такого конца вернуться в свой профиль без пароля. Срок вышел, человека выключили или сделали
 * владельцем: владелец по-прежнему владелец, возврат есть. Владельца выключили, сняли с него роль или завершили вход на
 * устройстве: возврата нет, сессия заканчивается, войти можно заново своим логином и паролем
 */
export function ownerAsReturnable(reason: OwnerAsEnd): boolean {
  return reason === "expired" || reason === "inactive" || reason === "promoted" || reason === "return";
}

/**
 * Почему вход этой сессии уже не действует, или null, если действует. Проверяется на каждом запросе: владелец всё ещё
 * владелец, срок не вышел, человек включён и не стал владельцем. Сначала то, после чего возврата нет
 */
export function ownerAsEndReason(grant: OwnerAsGrant, owner: { id: string; role: Role; active: boolean }, target: { id: string; active: boolean; role: Role } | null, now = Date.now()): OwnerAsEnd | null {
  if (!owner.active) return "owner";
  if (owner.role !== "OWNER") return "role";
  if (grant.until <= now) return "expired";
  if (!target || !target.active || target.id === owner.id) return "inactive";
  if (target.role === "OWNER") return "promoted";
  return null;
}

/** Пометка входа в названии вкладки: «Профиль <ФИО>». Вкладки чужого профиля не спутать со своими */
export function ownerAsTitleMark(fullName: string): string {
  return `Профиль ${fullName}`;
}

/** Метка вкладки с самой вкладки (заголовок X-Weekly-View): тот же разбор, что у «Смотреть как» (src/lib/view-as.ts) */
type Tab = { kind: "view" | "ended" | "as" | "as-ended"; id: string } | { kind: "self" };

/**
 * Можно ли записывать из этой вкладки во время входа владельца в чужой профиль и после него. null: можно, иначе текст
 * отказа. active: номер идущего входа, ended: номер закончившегося входа, cookie которого ещё в сессии.
 * - вход идёт: записывает только вкладка этого же входа (as:<номер>) или запрос без метки (без скрипта страницы);
 *   вкладка, показанная до входа (self) или для другого входа, отказ: правка ушла бы не от того имени;
 * - вход закончился сам, а владелец ещё не вернулся: отказ из любой вкладки, пока он не вернётся в свой профиль;
 * - входа нет: вкладка, оставшаяся от входа (as или as-ended), отказ, остальное решает правило «Смотреть как»
 */
export function ownerAsWriteRefusal(state: { active: string | null; ended: string | null }, tab: Tab | null): string | null {
  if (state.active) {
    if (!tab) return null;
    return tab.kind === "as" && tab.id === state.active ? null : OWNER_AS_STALE;
  }
  if (state.ended) return OWNER_AS_ENDED;
  if (tab?.kind === "as" || tab?.kind === "as-ended") return OWNER_AS_STALE;
  return null;
}

/**
 * Учётная запись человека во время входа владельца (этап 71): пароль, логин, почта, входы на устройствах, ссылки для
 * входа, ссылка на календарь сроков, уведомления и письма. Отказ на сервере ошибкой правила, экраны показывают текст
 */
export function refuseOwnerAs(actor: { via?: string | null }): void {
  if (actor.via === "OWNER_AS") throw new TaskRuleError(OWNER_AS_TEXTS.account);
}
