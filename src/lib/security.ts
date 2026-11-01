// Заголовки безопасности (этап 86). Чистые функции: их считает proxy на каждом ответе, а проверяют тесты.
//
// HSTS: браузер ходит на адрес только по https. Включается, когда APP_URL начинается с https: по http заголовок
// всё равно не действует (в разработке и в сквозных тестах адрес http), а на боевом адресе защищает от подмены.
//
// CSP: откуда странице можно брать скрипты, стили, шрифты и картинки и куда ходить.
//
// Важное: политика живёт на документе, а не на адресе страницы. По ресурсу ходят переходами внутри одного документа
// (меню, router), поэтому у отдельной страницы своей политики быть не может: после перехода из меню действует
// политика того документа, с которого человек начал. Первый заход этапа 86 давал страницам рынка мягкую политику по
// пути, и на прямом открытии /market дашборд работал, а после перехода из меню — нет (сквозные тесты рынка,
// прогон 41309777134). Поэтому политика одна на всё приложение. Не возвращать отбор по пути.
//
// Что это значит для рынка КАСКО и ОСАГО (этап 62): дашборд живёт в окне iframe srcdoc, такое окно наследует
// политику родителя, а код пакета внутри встроенный. Значит либо приложение разрешает встроенные скрипты, либо
// дашборд не работает. Поэтому по умолчанию (CSP_MODE=on) политика разрешает встроенные скрипты
// ('unsafe-inline'): она закрывает чужие адреса скриптов, стилей, картинок и шрифтов, запрещает object и base,
// держит формы и запросы на своём адресе (connect-src 'self': данные некуда увести), но от встроенного кода не
// защищает. Самому окну дашборда сеть и внешние файлы закрывает его собственная политика (src/lib/market/srcdoc.ts).
//
// Строгая политика (CSP_MODE=strict) разрешает встроенные скрипты только с одноразовой меткой nonce: proxy кладёт
// метку в заголовки запроса (x-nonce и Content-Security-Policy, оттуда её берёт сам Next для своих встроенных
// скриптов), корневой макет ставит её скрипту темы. Все страницы ресурса с ней работают, кроме дашборда рынка: он
// перестанет показывать цифры. Включать её можно будет, когда окно дашборда начнут отдавать отдельным документом со
// своей политикой вместо srcdoc. 'strict-dynamic' не берём намеренно: с ним любой файл сборки без метки давал бы
// белый экран, а так файлы разрешены как 'self'.
//
// Встроенные стили разрешены в любом режиме ('unsafe-inline'): React пишет style="" прямо в разметку, а стили
// скриптами не становятся. Шрифты и картинки у ресурса свои, из сборки и папки public, внешних адресов нет. Живые
// обновления (/api/events) и обычные запросы со страницы разрешены как connect-src 'self'.
//
// Режим задаёт переменная CSP_MODE: on (по умолчанию), strict (встроенные скрипты только с меткой), report-only
// (строгая политика без запретов: жалобы приходят в /api/errors и видны на странице «Состояние», ничего не
// блокируется — так видно, что сломает strict), off (заголовка нет совсем). Если после выкладки что-то отвалилось,
// владелец ставит CSP_MODE=report-only и перезапускает приложение.

/** Переменные окружения, которые читают эти функции */
export type SecurityEnv = { APP_URL?: string; CSP_MODE?: string; HSTS?: string; HSTS_MAX_AGE?: string; [key: string]: string | undefined };

export type CspMode = "on" | "strict" | "report-only" | "off";

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
  if (value === "strict") return "strict";
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
  // Страницу не встроить в чужую. Только в строгой политике: окно дашборда рынка наследует политику родителя, и
  // запрет встраивания мог бы закрыть само окно. В остальных режимах встраивание закрывает заголовок
  // X-Frame-Options: DENY (next.config.mjs), он действует во всех сегодняшних браузерах
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
  /** Метка этого ответа или null, если встроенные скрипты разрешены без метки */
  nonce: string | null;
};

/** Одноразовая метка: 32 знака из случайного номера. Годится и в Node, и в облегчённой среде proxy */
export function newNonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** Все заголовки безопасности для одного ответа. Адрес страницы не нужен: политика одна на всё приложение */
export function securityHeaders(env: SecurityEnv = process.env, nonce = newNonce()): SecurityHeaders {
  const response: Record<string, string> = {};
  const request: Record<string, string> = {};
  const hsts = hstsValue(env);
  if (hsts) response["Strict-Transport-Security"] = hsts;
  const mode = cspMode(env);
  if (mode === "off") return { response, request, nonce: null };
  // Метка нужна строгой политике и режиму жалоб: в режиме жалоб по ней видно, что сломает strict
  const used = mode === "on" ? null : nonce;
  const policy = cspPolicy({ nonce: used, https: isHttps(env) });
  response[mode === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy"] = policy;
  response["Reporting-Endpoints"] = `${REPORT_GROUP}="${CSP_REPORT_PATH}"`;
  // Next читает метку из заголовка запроса: так его собственные встроенные скрипты получают ту же метку
  request["Content-Security-Policy"] = policy;
  if (used) request[NONCE_HEADER] = used;
  return { response, request, nonce: used };
}
