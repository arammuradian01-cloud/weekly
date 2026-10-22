// «Смотреть как» (этап 63): владелец при личном входе в режиме управления смотрит приложение глазами любого включённого
// человека компании. Только просмотр: любые изменения отказывают на сервере одним текстом. Модуль без базы: подпись и
// проверка cookie, срок, правила и текст отказа. Его берут вход на сервере (src/lib/auth.ts), сервис просмотра и тесты.

import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@/generated/prisma/enums";
import type { ManagementRole } from "./session";
import { TaskRuleError } from "./rule-error";

export const VIEW_AS_COOKIE = "wk_view_as";
/** Просмотр живёт 2 часа и не дольше режима управления */
export const VIEW_AS_TTL_MS = 2 * 60 * 60 * 1000;
/** Ответ на любое изменение в режиме просмотра */
export const VIEW_AS_DENIED = "В режиме «Смотреть как» изменения недоступны";

/**
 * Отказ записи в режиме просмотра. Наследник ошибки правила: все действия экранов уже показывают такой текст человеку
 * как есть, а не «не получилось сохранить»
 */
export class ViewAsReadOnlyError extends TaskRuleError {
  constructor() {
    super(VIEW_AS_DENIED);
    this.name = "ViewAsReadOnlyError";
  }
}

/**
 * Что лежит в подписанной cookie: чья сессия (владелец и запись его устройства), кого смотрим, до какого момента и при
 * каком режиме управления (его срок, grant). Режим управления включили заново: это уже другой режим, и старая cookie
 * не оживает
 */
export type ViewAsToken = { ownerId: string; sid: string; targetId: string; until: number; grant: number };

const AUDIENCE = "weekly:view-as";

function keyFrom(secret: string) {
  if (!secret || secret.length < 32) {
    throw new Error("Ключ сессий не задан или короче 32 символов: задайте SESSION_SECRET или пароль базы. Запустите npm run setup");
  }
  // Свой ключ, выведенный из ключа сессий: подпись просмотра не годится как cookie сессии, и наоборот
  return new TextEncoder().encode(`${secret}\u0000view-as`);
}

/** До какого момента действует просмотр: 2 часа, но не дольше режима управления */
export function viewAsUntil(now: number, managementUntil: number): number {
  return Math.min(now + VIEW_AS_TTL_MS, managementUntil);
}

export async function signViewAs(data: ViewAsToken, secret: string, now = Date.now()): Promise<string> {
  return new SignJWT({ ownerId: data.ownerId, sid: data.sid, targetId: data.targetId, until: data.until, grant: data.grant })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUDIENCE)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.ceil(data.until / 1000))
    .sign(keyFrom(secret));
}

/** Подпись и срок. null: cookie нет, она чужая, подделана или срок вышел */
export async function verifyViewAs(token: string | undefined, secret: string, now = Date.now()): Promise<ViewAsToken | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, keyFrom(secret), { algorithms: ["HS256"], audience: AUDIENCE, currentDate: new Date(now) });
    const { ownerId, sid, targetId, until, grant } = payload;
    if (typeof ownerId !== "string" || !ownerId || typeof sid !== "string" || !sid || typeof targetId !== "string" || !targetId) return null;
    if (typeof until !== "number" || !Number.isFinite(until) || until <= now) return null;
    if (typeof grant !== "number" || !Number.isFinite(grant)) return null;
    return { ownerId, sid, targetId, until, grant };
  } catch {
    return null;
  }
}

export const VIEW_AS_TEXTS = {
  ownerOnly: "«Смотреть как» доступно только владельцу",
  personal: "«Смотреть как» включается только при личном входе, не по общему логину",
  management: "Сначала включите режим управления: «Смотреть как» работает только в нём",
  viewing: "Вы уже смотрите как другой человек: сначала выйдите из просмотра",
  missing: "Такого человека нет",
  inactive: "Нельзя смотреть как выключенного человека",
  self: "Это вы: выберите другого человека",
} as const;

/** Кто включает просмотр: роль профиля, личный ли вход, какой режим управления включён, идёт ли уже просмотр */
export type ViewAsStarter = { personId: string; role: Role; personal: boolean; management: ManagementRole | null; viewing: boolean };

/**
 * Можно ли начать просмотр. null: можно. Владелец при личном входе (общий логин не годится: профиль в нём выбирают
 * сами), в режиме управления владельца, не во время другого просмотра; смотреть можно только как включённого
 * человека и не как самого себя
 */
export function viewAsStartError(who: ViewAsStarter, target: { id: string; active: boolean } | null): string | null {
  if (who.role !== "OWNER") return VIEW_AS_TEXTS.ownerOnly;
  if (!who.personal) return VIEW_AS_TEXTS.personal;
  if (who.management !== "OWNER") return VIEW_AS_TEXTS.management;
  if (who.viewing) return VIEW_AS_TEXTS.viewing;
  if (!target) return VIEW_AS_TEXTS.missing;
  if (!target.active) return VIEW_AS_TEXTS.inactive;
  if (target.id === who.personId) return VIEW_AS_TEXTS.self;
  return null;
}

/** Кто сейчас вошёл: запись устройства из сессии, профиль, его роль, режим управления и срок этого режима */
export type ViewAsHolder = { sid: string | undefined; personId: string; role: Role; personal: boolean; management: ManagementRole | null; managementUntil: number | null };

/**
 * Просмотр ещё действует. Проверяется на каждом запросе: та же сессия владельца (та же запись устройства и тот же
 * профиль), он по-прежнему владелец при личном входе в том же режиме управления владельца, срок не вышел. Владелец
 * вышел, его вход завершили, роль сменили, режим управления погас или его включили заново: просмотр гаснет.
 * Включённость выбранного человека вход проверяет по базе
 */
export function viewAsHolds(token: ViewAsToken, who: ViewAsHolder, now = Date.now()): boolean {
  if (token.until <= now) return false;
  if (!who.sid || token.sid !== who.sid) return false;
  if (token.ownerId !== who.personId || token.targetId === who.personId) return false;
  if (who.managementUntil !== token.grant) return false;
  return who.role === "OWNER" && who.personal && who.management === "OWNER";
}
