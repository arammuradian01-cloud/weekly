// Адрес приложения (этап 69). Основной адрес задаёт APP_URL: по нему строятся ссылки в письмах, приглашениях,
// календаре, уведомлениях и таблице. Дополнительные адреса, с которых тоже открывают ресурс (например технический
// адрес хостинга, пока к приложению привязан свой домен), перечисляет APP_ALIASES через запятую. С ними загрузки
// файлов не отвечают «Запрос с чужого сайта». REDIRECT_TO_APP_URL=1 включает постоянный переход 308 со всех других
// адресов на основной для обычных открытий страниц. Модуль без базы и без Node: его зовут proxy, обработчики загрузок
// и модульные тесты.

type Env = Record<string, string | undefined>;
type HeaderSource = { get(name: string): string | null };

/** Адрес из переменной: с https:// или без, лишние пробелы и косые черты в конце не мешают. null: не адрес */
function originOf(value: string | undefined | null): string | null {
  const v = (value ?? "").trim().replace(/\/+$/, "");
  if (!v) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Основной адрес приложения из APP_URL (только начало: протокол, домен, порт) или null, если не задан */
export function appOrigin(env: Env = process.env): string | null {
  return originOf(env.APP_URL);
}

/** Все адреса ресурса: основной из APP_URL и дополнительные из APP_ALIASES, без повторов */
export function appOrigins(env: Env = process.env): string[] {
  const list = [env.APP_URL, ...(env.APP_ALIASES ?? "").split(",")].map(originOf).filter((o): o is string => !!o);
  return [...new Set(list)];
}

/**
 * Запрос пришёл со страницы ресурса: заголовок Origin совпадает с основным или дополнительным адресом либо с адресом
 * самого запроса. Чужой сайт и «Origin: null» (страница из файла, песочница) не проходят
 */
export function sameSiteOrigin(origin: string, requestUrl: string, env: Env = process.env): boolean {
  const from = originOf(origin);
  if (!from || origin.trim() === "null") return false;
  if (appOrigins(env).includes(from)) return true;
  try {
    return new URL(from).host === new URL(requestUrl).host;
  } catch {
    return false;
  }
}

/** Переход на основной адрес включён: REDIRECT_TO_APP_URL=1 (или true) */
export function redirectEnabled(env: Env = process.env): boolean {
  return ["1", "true", "yes", "on"].includes((env.REDIRECT_TO_APP_URL ?? "").trim().toLowerCase());
}

/** Хост без регистра, точки в конце и порта по умолчанию для протокола основного адреса */
function normalHost(host: string, protocol: string): string {
  let h = host.trim().toLowerCase().replace(/\.$/, "");
  if (protocol === "https:" && h.endsWith(":443")) h = h.slice(0, -4);
  if (protocol === "http:" && h.endsWith(":80")) h = h.slice(0, -3);
  return h.replace(/\.$/, "");
}

/** Хост, на который пришёл запрос: как его видит Next в серверных действиях, сначала X-Forwarded-Host, потом Host */
export function requestHost(headers: HeaderSource): string | null {
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return forwarded || headers.get("host")?.trim() || null;
}

export type RedirectRequest = { method: string; pathname: string; search: string; headers: HeaderSource };

/**
 * Куда перевести запрос со старого адреса, или null, если не нужно. Переводятся только открытия страниц (GET и HEAD)
 * и только при REDIRECT_TO_APP_URL=1, если хост запроса не совпадает с хостом APP_URL. Путь и параметры сохраняются.
 * Не трогаются: /api (проверку здоровья хостинг зовёт, возможно, по техническому адресу, календари забирают ленту по
 * старой ссылке), загрузки и серверные действия (это POST, они доделываются там, где начаты). Вкладка, открытая на
 * старом адресе до включения перехода, при следующем переходе по ссылке внутри ресурса получает отказ служебного
 * запроса Next (заголовки RSC до proxy не доходят) и открывает страницу целиком, уже на основном адресе
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
  const app = new URL(target);
  if (normalHost(host, app.protocol) === normalHost(app.host, app.protocol)) return null;
  const search = req.search && req.search !== "?" ? (req.search.startsWith("?") ? req.search : `?${req.search}`) : "";
  return `${target}${path.startsWith("/") ? path : `/${path}`}${search}`;
}
