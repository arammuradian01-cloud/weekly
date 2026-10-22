// «Смотреть как» (этап 63): владелец при личном входе в режиме управления смотрит приложение глазами любого включённого
// человека компании. Только просмотр: любые изменения отказывают на сервере одним текстом. Модуль без базы: подпись и
// проверка cookie, срок, правила и текст отказа. Его берут вход на сервере (src/lib/auth.ts), сервис просмотра и тесты.

import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@/generated/prisma/enums";
import type { ManagementRole } from "./session";
import { TaskRuleError } from "./rule-error";

export const VIEW_AS_COOKIE = "wk_view_as";
/** Команда, выбранная в просмотре: отдельно от cookie команды владельца, снимается вместе с просмотром */
export const TEAM_VIEW_COOKIE = "team_view";
/** Просмотр живёт 2 часа и не дольше режима управления */
export const VIEW_AS_TTL_MS = 2 * 60 * 60 * 1000;
/**
 * Сколько cookie живёт после конца режима управления. Пока она есть, вход знает, что просмотр был и закончился:
 * вкладка, оставшаяся от просмотра, не запишет ничего от имени владельца. Снимают её только «Выйти из просмотра»
 * («Вернуться к себе»), выход из ресурса, новый вход и новый просмотр
 */
export const VIEW_AS_KEEP_AFTER_MS = 12 * 60 * 60 * 1000;
import { VIEW_AS_DENIED, VIEW_AS_ENDED } from "./view-as-texts";
import { VIEW_AS_TAB_HEADER_NAME } from "./view-as-fetch";

export { VIEW_AS_DENIED, VIEW_AS_ENDED };

/**
 * Отказ записи в режиме просмотра и после его конца. Наследник ошибки правила: все действия экранов уже показывают
 * такой текст человеку как есть, а не «не получилось сохранить»
 */
export class ViewAsReadOnlyError extends TaskRuleError {
  constructor(message: string = VIEW_AS_DENIED) {
    super(message);
    this.name = "ViewAsReadOnlyError";
  }
}

/**
 * Что лежит в подписанной cookie: номер просмотра (id, по нему в журнале связаны начало и конец), чья сессия (владелец
 * и запись его устройства), кого смотрим, до какого момента и при каком режиме управления (его срок, grant). Режим
 * управления включили заново: это уже другой режим, и старая cookie не оживает
 */
export type ViewAsToken = { id: string; ownerId: string; sid: string; targetId: string; until: number; grant: number };

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

/** До какого момента живёт cookie: конец режима управления и ещё VIEW_AS_KEEP_AFTER_MS */
export function viewAsKeepUntil(token: Pick<ViewAsToken, "until" | "grant">): number {
  return Math.max(token.until, token.grant) + VIEW_AS_KEEP_AFTER_MS;
}

export async function signViewAs(data: ViewAsToken, secret: string, now = Date.now()): Promise<string> {
  return new SignJWT({ id: data.id, ownerId: data.ownerId, sid: data.sid, targetId: data.targetId, until: data.until, grant: data.grant })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUDIENCE)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.ceil(viewAsKeepUntil(data) / 1000))
    .sign(keyFrom(secret));
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Подпись и срок жизни cookie. null: cookie нет, она чужая, подделана или прошло VIEW_AS_KEEP_AFTER_MS после конца
 * режима управления. Срок самого просмотра (until) здесь не проверяется: закончившийся просмотр тоже нужно узнать
 */
export async function verifyViewAs(token: string | undefined, secret: string, now = Date.now()): Promise<ViewAsToken | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, keyFrom(secret), { algorithms: ["HS256"], audience: AUDIENCE, currentDate: new Date(now) });
    const { id, ownerId, sid, targetId, until, grant } = payload;
    const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
    if (!text(id) || !text(ownerId) || !text(sid) || !text(targetId) || !num(until) || !num(grant)) return null;
    return { id, ownerId, sid, targetId, until, grant };
  } catch {
    return null;
  }
}

/** Пометка просмотра в названии вкладки: «Как <ФИО>». Вкладки просмотра не спутать с обычными */
export function viewAsTitleMark(fullName: string): string {
  return `Как ${fullName}`;
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

/** cookie этой же сессии: та же запись устройства и тот же владелец. Чужую (осталась от прежнего входа) вход не замечает */
export function viewAsOwnSession(token: ViewAsToken, who: Pick<ViewAsHolder, "sid" | "personId">): boolean {
  return !!who.sid && token.sid === who.sid && token.ownerId === who.personId;
}

/** Почему просмотр закончился: для журнала (поле записи «viewAs.stop») и плашки */
export type ViewAsEnd = "stop" | "logout" | "expired" | "management" | "role" | "inactive" | "session";

export const VIEW_AS_END_TEXTS: Record<ViewAsEnd, string> = {
  stop: "Выйти из просмотра",
  logout: "Выход из ресурса",
  expired: "Вышел срок просмотра",
  management: "Закончился режим управления",
  role: "Снята роль владельца",
  inactive: "Человек выключен",
  session: "Вход завершён",
};

/**
 * Почему просмотр этой сессии уже не действует, или null, если действует. Проверяется на каждом запросе: срок не
 * вышел, профиль по-прежнему владелец при личном входе в том же режиме управления владельца, выбранный человек
 * включён (его вход читает из базы)
 */
export function viewAsEndReason(token: ViewAsToken, who: ViewAsHolder, targetActive: boolean, now = Date.now()): ViewAsEnd | null {
  if (token.until <= now) return "expired";
  if (who.role !== "OWNER") return "role";
  if (!who.personal) return "session";
  if (who.management !== "OWNER" || who.managementUntil !== token.grant) return "management";
  if (!targetActive || token.targetId === who.personId) return "inactive";
  return null;
}

/** Просмотр действует: cookie этой сессии и причины конца нет (включённость выбранного человека проверяет вход) */
export function viewAsHolds(token: ViewAsToken, who: ViewAsHolder, now = Date.now()): boolean {
  return viewAsOwnSession(token, who) && viewAsEndReason(token, who, true, now) === null && token.targetId !== who.personId;
}

/**
 * Метка вкладки (этап 63, второй круг): в каком состоянии сервер показал эту вкладку. Клиент кладёт её в заголовок
 * X-Weekly-View каждого серверного действия и каждого изменения через /api, сервер по ней отличает вкладку, оставшуюся
 * от просмотра, от обычной вкладки владельца. view:<номер просмотра>, ended:<номер>, self
 */
export const VIEW_AS_TAB_HEADER = VIEW_AS_TAB_HEADER_NAME;

export type ViewAsTab = { kind: "view"; id: string } | { kind: "ended"; id: string } | { kind: "self" };

/** Разбор метки вкладки из заголовка. null: заголовка нет или он не по форме (тогда прежнее правило без метки) */
export function parseViewAsTab(value: string | null | undefined): ViewAsTab | null {
  if (!value) return null;
  if (value === "self") return { kind: "self" };
  const m = /^(view|ended):([A-Za-z0-9-]{1,80})$/.exec(value);
  if (!m) return null;
  return m[1] === "view" ? { kind: "view", id: m[2]! } : { kind: "ended", id: m[2]! };
}

/** Метка вкладки по состоянию, в котором её показал сервер */
export function viewAsTabState(state: { viewing: string | null; ended: string | null }): string {
  return state.viewing ? `view:${state.viewing}` : state.ended ? `ended:${state.ended}` : "self";
}

/**
 * Можно ли записывать из этой вкладки. null: можно, иначе текст отказа. viewing: номер идущего просмотра, ended:
 * номер закончившегося просмотра, cookie которого ещё есть.
 * - вкладка view:X: идёт тот же просмотр X, отказ «изменения недоступны»; просмотра X больше нет (вышли в другой
 *   вкладке, срок, новый просмотр), отказ «просмотр закончился»: вкладка показывает чужие данные;
 * - вкладка ended: отказ «просмотр закончился», пока владелец не вернётся к себе;
 * - вкладка self (обычная вкладка владельца): отказ только во время просмотра, конец просмотра её не блокирует;
 * - без метки (запрос без скрипта страницы): во время просмотра отказ, после его конца «просмотр закончился»
 */
export function viewAsWriteRefusal(state: { viewing: string | null; ended: string | null }, tab: ViewAsTab | null): string | null {
  if (tab?.kind === "view") return state.viewing === tab.id ? VIEW_AS_DENIED : VIEW_AS_ENDED;
  if (tab?.kind === "ended") return VIEW_AS_ENDED;
  if (state.viewing) return VIEW_AS_DENIED;
  if (tab?.kind === "self") return null;
  return state.ended ? VIEW_AS_ENDED : null;
}
