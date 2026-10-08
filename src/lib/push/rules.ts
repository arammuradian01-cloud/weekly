// Уведомления в браузере (этап 26, модуль М11). Чистые функции без базы.
//
// Правила плана Weekly 2.0 для любого канала:
// - уведомляем только адресно: поручили, упомянули, ждут ответа, отреагировали;
// - в уведомлении только кто, что и ссылка, содержимое видно после входа;
// - рабочие часы 9:00-20:00 по Москве в будни, вне них ничего не приходит;
// - события одного человека за проход склеиваются: одно уведомление на предмет или одно «N событий ждут вас».

import type { InboxKind } from "@/generated/prisma/enums";
import { WORK_HOURS, prefOfKind } from "@/lib/letters/schedule";
import { moscowDate, moscowDateTime } from "@/lib/week";
import { eventPhrase, pathOf, plural, type EventLine } from "@/lib/letters/phrases";

/** Через сколько после события уходит уведомление: серия правок за минуту приходит одним уведомлением */
export const PUSH_DELAY_MS = 60_000;
/** Старше этого уведомлением не уходит: утром не будим вчерашним */
export const PUSH_MAX_AGE_MS = 12 * 3_600_000;
/** Дольше этого служба уведомлений недоставленное не хранит */
export const PUSH_TTL_SEC = 12 * 3_600;
/** После стольких неудач подряд подписка удаляется */
export const PUSH_MAX_FAILURES = 10;

/**
 * Сколько служба уведомлений хранит недоставленное: до конца рабочего дня по Москве, не больше 12 часов.
 * Телефон был выключен в 19:55 и включился в 23:00: вчерашнее уже не придёт, рабочие часы соблюдены
 */
export function pushTtlSec(now: Date): number {
  const end = moscowDateTime(moscowDate(now), WORK_HOURS.end).getTime();
  return Math.max(60, Math.min(PUSH_TTL_SEC, Math.floor((end - now.getTime()) / 1000)));
}

export type PushPrefs = { tasks: boolean; mentions: boolean; reactions: boolean };
export type PushPrefKey = keyof PushPrefs;

export const DEFAULT_PUSH_PREFS: PushPrefs = { tasks: true, mentions: true, reactions: true };
export const PUSH_PREF_ORDER: PushPrefKey[] = ["tasks", "mentions", "reactions"];

export const PUSH_LABELS: Record<PushPrefKey, { title: string; hint: string }> = {
  tasks: {
    title: "Задачи и просьбы",
    hint: "Вам поставили, передали или предложили задачу, прокомментировали её, просят обновить, подошёл срок вашей задачи, изменилась задача, за которой вы следите, просьба к вам или ответ на вашу",
  },
  mentions: { title: "Упоминания и обсуждения", hint: "Вас упомянули или поблагодарили, прокомментировали вашу запись weekly, протокол и решения встречи" },
  reactions: { title: "Реакции", hint: "Отреагировали на вашу запись или комментарий" },
};

export function pushPrefsOf(value: unknown): PushPrefs {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const out = { ...DEFAULT_PUSH_PREFS };
  for (const key of PUSH_PREF_ORDER) if (typeof raw[key] === "boolean") out[key] = raw[key] as boolean;
  return out;
}

/** К какой настройке относится событие: те же группы, что у писем */
export function pushPrefOfKind(kind: InboxKind): PushPrefKey {
  const key = prefOfKind(kind);
  return key === "mentions" || key === "reactions" ? key : "tasks";
}

export type PushPayload = { title: string; body: string; url: string; tag: string };

/**
 * Одно уведомление на человека за проход. Один предмет: «кто: что» и ссылка на предмет, повтор по тому же предмету
 * заменяет прежнее уведомление (tag). Несколько предметов: «N событий ждут вас» и ссылка на «Мне»
 */
export function pushPayload(items: (EventLine & { subject: string; createdAt: Date })[]): PushPayload | null {
  if (!items.length) return null;
  const bySubject = new Map<string, { last: EventLine; count: number }>();
  for (const e of [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const found = bySubject.get(e.subject);
    if (found) found.count += 1;
    else bySubject.set(e.subject, { last: e, count: 1 });
  }
  const groups = [...bySubject.entries()];
  if (groups.length === 1) {
    const [subject, g] = groups[0]!;
    return { title: "Weekly", body: `${eventPhrase(g.last)}${g.count > 1 ? ` (и ещё ${g.count - 1})` : ""}`, url: pathOf({ ...g.last, subject }), tag: subject };
  }
  return { title: "Weekly", body: `${groups.length} ${plural(groups.length, ["событие ждёт", "события ждут", "событий ждут"])} вас в «Мне»`, url: "/me", tag: "inbox" };
}

/** Подписка, которую прислал браузер: адрес службы уведомлений https и два ключа */
export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * Службы уведомлений браузеров: Chrome, Яндекс Браузер и Edge на Android через Google, Firefox, Safari, Edge на Windows.
 * Адрес не из списка не принимаем: иначе сервер ходил бы по любому адресу, который прислали
 */
const PUSH_HOSTS = ["googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com", "yandex.net", "yandex.ru"];

export function isPushHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Проверка подписки от браузера. null: прислали не то */
export function parseSubscription(value: unknown): PushSubscriptionInput | null {
  const v = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!v || typeof v.endpoint !== "string" || v.endpoint.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(v.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !isPushHost(url.hostname) || url.username || url.password || (url.port && url.port !== "443")) return null;
  const p256dh = v.keys?.p256dh;
  const auth = v.keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (p256dh.length < 20 || p256dh.length > 200 || auth.length < 8 || auth.length > 100 || !B64URL.test(p256dh) || !B64URL.test(auth)) return null;
  return { endpoint: v.endpoint, keys: { p256dh, auth } };
}

/** Ответ службы уведомлений, после которого подписку надо удалить: устройство отписалось */
export function isGoneStatus(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

/**
 * Служба отказала в подписи (401, 403): ключи VAPID не те, с которыми подписывалось устройство, или ошибка настройки.
 * Подписку не удаляем сразу: при ошибке настройки иначе пропали бы все. Неудачи копятся, в профиле видно, что делать
 */
export function isAuthStatus(status: number | undefined): boolean {
  return status === 401 || status === 403;
}
