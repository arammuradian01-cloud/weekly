// Заголовки безопасности (этап 86). Чистые функции: их считает proxy на каждом ответе, а проверяют тесты.
//
// HSTS: браузер ходит на адрес только по https. Включается, когда APP_URL начинается с https: по http заголовок
// всё равно не действует (в разработке и в сквозных тестах адрес http), а на боевом адресе защищает от подмены.
//
// CSP: откуда странице можно брать скрипты, стили, шрифты и картинки и куда ходить. Next подставляет на страницу
// свои встроенные скрипты, поэтому каждому ответу выдаётся одноразовая метка nonce: proxy кладёт её в заголовки
// запроса (x-nonce и Content-Security-Policy, оттуда метку берёт сам Next), корневой макет ставит её своему скрипту
// темы. Скрипты файлами разрешены как 'self', 'strict-dynamic' не берём намеренно: с ним любой файл сборки без
// метки давал бы белый экран. Встроенные стили разрешены ('unsafe-inline'): React пишет style="" прямо в разметку,
// а стили скриптами не становятся. Шрифты и картинки у ресурса свои, из сборки и папки public, внешних адресов нет.
// Живые обновления (/api/events) и обычные запросы со страницы разрешены как connect-src 'self'.
//
// Рынок КАСКО и ОСАГО (этап 62) живёт в окне iframe srcdoc. Такое окно наследует политику родителя, а код пакета
// внутри встроенный и без метки: со строгой политикой дашборд перестал бы работать. Поэтому у страниц рынка своя
// политика со встроенными скриптами и без метки (самому окну сеть закрывает его собственная политика, см.
// src/lib/market/srcdoc.ts).
//
// Режим задаёт переменная CSP_MODE: on (по умолчанию, политика действует), report-only (жалобы приходят в
// /api/errors, но ничего не блокируется), off (заголовка нет совсем). Если после выкладки что-то отвалилось,
// владелец ставит CSP_MODE=report-only и перезапускает приложение, а жалобы видит на странице «Состояние».

/** Переменные окружения, которые читают эти функции */
export type SecurityEnv = { APP_URL?: string; CSP_MODE?: string; HSTS?: string; HSTS_MAX_AGE?: string; [key: string]: string | undefined };

export type CspMode = "on" | "report-only" | "off";

/** Куда приходят жалобы политики: тот же обработчик, что собирает ошибки браузера (этап 86) */
export const CSP_REPORT_PATH = "/api/errors";
/** Имя группы для современного report-to: адрес группы объявляет заголовок Reporting-Endpoints */
export const REPORT_GROUP = "weekly";
/** Год: столько браузер помнит, что на адрес ходят только по https */
export const HSTS_MAX_AGE = 31_536_000;
/** Заголовок запроса с одноразовой меткой: из него метку берёт корневой макет */
export const NONCE_HEADER = "x-nonce";

export function cspMode(env: SecurityEnv = process.env): CspMode {
  const value = (env.CSP_MODE ?? "").trim().toLowerCase();
  if (value === "off") return "off";
  if (value === "report-only" || value === "report") return "report-only";
  return "on";
}

/** Ресурс открывают по https: смотрим на адрес из APP_URL, как и cookie сессии */
export function isHttps(env: SecurityEnv = process.env): boolean {
  return (env.APP_URL ?? "").startsWith("https://");
}

/** Значение Strict-Transport-Security или null, если заголовок не нужен */
export function hstsValue(env: SecurityEnv = process.env): string | null {
  if (!isHttps(env)) return null;
  if ((env.HSTS ?? "").trim().toLowerCase() === "off") return null;
  const raw = Number.parseInt((env.HSTS_MAX_AGE ?? "").trim(), 10);
  const maxAge = Number.isFinite(raw) && raw >= 0 ? raw : HSTS_MAX_AGE;
  return `max-age=${maxAge}`;
}

/** Страницы рынка: встроенные скрипты окна дашборда наследуют политику родителя, строгая их сломает */
export function cspRelaxed(pathname: string): boolean {
  return pathname === "/market" || pathname.startsWith("/market/");
}

/** Политика одной строкой. nonce: метка встроенных скриптов; null — встроенные скрипты разрешены как есть */
export function cspPolicy({ nonce, https }: { nonce: string | null; https: boolean }): string {
  const script = nonce ? `'self' 'nonce-${nonce}'` : "'self' 'unsafe-inline'";
  const parts = [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${REPORT_GROUP}`,
  ];
  // Страницу не встроить в чужую. В мягкой политике (страницы рынка) этого правила нет нарочно: окно дашборда
  // наследует политику родителя, и запрет встраивания мог бы закрыть само окно. Встраивание страниц рынка в чужие
  // страницы и так закрыто заголовком X-Frame-Options: DENY (next.config.mjs)
  if (nonce) parts.push("frame-ancestors 'none'");
  // Остатки http-адресов в разметке на боевом адресе браузер дотянет по https, а не уронит страницу
  if (https) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

export type SecurityHeaders = {
  /** Заголовки, которые уходят браузеру */
  response: Record<string, string>;
  /** Заголовки, которые дописываются к запросу: из них Next берёт метку для своих встроенных скриптов */
  request: Record<string, string>;
  /** Метка этого ответа или null, если политика выключена или это страница рынка */
  nonce: string | null;
};

/** Одноразовая метка: 32 знака из случайного номера. Годится и в Node, и в облегчённой среде proxy */
export function newNonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** Все заголовки безопасности для одного ответа */
export function securityHeaders(pathname: string, env: SecurityEnv = process.env, nonce = newNonce()): SecurityHeaders {
  const response: Record<string, string> = {};
  const request: Record<string, string> = {};
  const hsts = hstsValue(env);
  if (hsts) response["Strict-Transport-Security"] = hsts;
  const mode = cspMode(env);
  if (mode === "off") return { response, request, nonce: null };
  const used = cspRelaxed(pathname) ? null : nonce;
  const policy = cspPolicy({ nonce: used, https: isHttps(env) });
  response[mode === "on" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only"] = policy;
  response["Reporting-Endpoints"] = `${REPORT_GROUP}="${CSP_REPORT_PATH}"`;
  // Next читает метку из заголовка запроса: так его собственные встроенные скрипты получают ту же метку
  request["Content-Security-Policy"] = policy;
  if (used) request[NONCE_HEADER] = used;
  return { response, request, nonce: used };
}
