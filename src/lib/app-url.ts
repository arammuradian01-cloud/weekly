// Адрес приложения (этап 69). Основной адрес задаёт APP_URL: по нему строятся ссылки в письмах, приглашениях,
// календаре, уведомлениях и таблице. Дополнительные адреса, с которых тоже открывают ресурс (например технический
// адрес хостинга, пока к приложению привязан свой домен), перечисляет APP_ALIASES через запятую, только точные адреса.
// С ними загрузки файлов не отвечают «Запрос с чужого сайта». REDIRECT_TO_APP_URL=1 включает переход 308 со всех
// других адресов на основной для открытий страниц. Модуль без базы и без Node: его зовут proxy, обработчики загрузок и
// модульные тесты. Правила адресов общие с next.config.mjs: src/lib/app-origins.mjs.

import { appOrigins as originsOf, exactOrigin } from "./app-origins.mjs";

type Env = Record<string, string | undefined>;
type HeaderSource = { get(name: string): string | null };

/** Основной адрес приложения из APP_URL (только начало: протокол, домен, порт) или null, если не задан */
export function appOrigin(env: Env = process.env): string | null {
  return exactOrigin(env.APP_URL);
}

/** Все адреса ресурса: основной из APP_URL и дополнительные из APP_ALIASES, без повторов */
export function appOrigins(env: Env = process.env): string[] {
  return originsOf(env);
}

/** Хост, на который пришёл запрос: как его видит Next в серверных действиях, сначала X-Forwarded-Host, потом Host */
export function requestHost(headers: HeaderSource): string | null {
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return forwarded || headers.get("host")?.trim() || null;
}

/**
 * Адрес, на который пришёл запрос, по заголовкам прокси: X-Forwarded-Proto (иначе протокол адреса запроса) и
 * X-Forwarded-Host (иначе Host). Адрес самого запроса (request.url) у Next за прокси бывает внутренним, вида
 * http://0.0.0.0:3000, поэтому одного его мало
 */
function forwardedOrigin(request: { url: string; headers: HeaderSource }): string | null {
  const host = requestHost(request.headers);
  if (!host) return null;
  let proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() ?? "";
  if (proto !== "http" && proto !== "https") {
    try {
      proto = new URL(request.url).protocol.replace(/:$/, "");
    } catch {
      return null;
    }
  }
  return exactOrigin(`${proto}://${host}`);
}

/**
 * Запрос пришёл со страницы ресурса: заголовок Origin совпадает с основным или дополнительным адресом либо с адресом,
 * на который пришёл запрос (по заголовкам прокси или по адресу запроса). Сравниваются протокол, хост и порт целиком.
 * Чужой сайт, «Origin: null» (страница из файла, песочница) и не адрес не проходят
 */
export function sameSiteOrigin(origin: string, request: { url: string; headers: HeaderSource }, env: Env = process.env): boolean {
  if (origin.trim().toLowerCase() === "null") return false;
  const from = exactOrigin(origin);
  if (!from) return false;
  if (appOrigins(env).includes(from)) return true;
  if (forwardedOrigin(request) === from) return true;
  try {
    return exactOrigin(new URL(request.url).origin) === from;
  } catch {
    return false;
  }
}

/** Переход на основной адрес включён: REDIRECT_TO_APP_URL=1 (или true) */
export function redirectEnabled(env: Env = process.env): boolean {
  return ["1", "true", "yes", "on"].includes((env.REDIRECT_TO_APP_URL ?? "").trim().toLowerCase());
}

export type RedirectRequest = { method: string; pathname: string; search: string; headers: HeaderSource };

/**
 * Куда перевести запрос со старого адреса, или null, если не нужно. Переводятся только открытия страниц (GET и HEAD)
 * и только при REDIRECT_TO_APP_URL=1, если хост запроса не совпадает с хостом APP_URL (регистр, точка в конце и порт
 * по умолчанию не мешают). Путь и параметры сохраняются. Не трогаются: /api (проверку здоровья хостинг зовёт, возможно,
 * по техническому адресу, календари забирают ленту по старой ссылке), загрузки и серверные действия (это POST, они
 * доделываются там, где начаты). Вкладка, открытая на старом адресе до включения перехода, при следующем переходе по
 * ссылке внутри ресурса получает отказ служебного запроса Next (заголовки RSC до proxy не доходят) и открывает страницу
 * целиком, уже на основном адресе
 */
export function appUrlRedirect(req: RedirectRequest, env: Env = process.env): string | null {
  if (!redirectEnabled(env)) return null;
  const target = appOrigin(env);
  if (!target) return null;
  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  const path = req.pathname || "/";
  if (path === "/api" || path.startsWith("/api/") || path.startsWith("/_next/")) return null;
  if (req.headers.get("next-action")) return null;
  const host = requestHost(req.headers);
  if (!host) return null;
  const here = exactOrigin(`${new URL(target).protocol}//${host}`);
  // Хост, который не разобрать как адрес, не переводим: лучше остаться на месте, чем увести неизвестно куда
  if (!here || here === target) return null;
  const search = req.search && req.search !== "?" ? (req.search.startsWith("?") ? req.search : `?${req.search}`) : "";
  return `${target}${path.startsWith("/") ? path : `/${path}`}${search}`;
}

/**
 * Ответ перехода на основной адрес: 308 (метод и тело не меняются, адрес переехал насовсем) с Cache-Control: no-store.
 * Без запрета кэша браузер запомнил бы постоянный переход без срока, и ошибку в APP_URL не исправить, убрав переменную:
 * так каждое открытие снова спрашивает сервер, и выключенный переход перестаёт действовать сразу
 */
export const APP_URL_REDIRECT = { status: 308, headers: { "Cache-Control": "no-store" } } as const;
