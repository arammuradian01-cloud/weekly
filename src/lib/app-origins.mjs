// Адреса ресурса (этап 69): одни правила для разрешённых адресов серверных действий (next.config.mjs) и для проверки
// Origin загрузок и перехода на основной адрес (src/lib/app-url.ts). Обычный JavaScript без зависимостей: его читает
// и Node при запуске сервера (next.config.mjs), и сборка приложения. Типы в app-origins.d.mts.
//
// В APP_URL и APP_ALIASES годятся только точные адреса http или https. Шаблоны со звёздочкой (например все приложения
// хостинга сразу) и другие схемы отбрасываются: проверка загрузок сравнивает адреса буквально, и разрешённые адреса
// серверных действий не должны быть шире её.

/**
 * Точный адрес из переменной или заголовка: протокол, хост без точки в конце, порт, если он не по умолчанию.
 * Без протокола считается https. null: пусто, «null», звёздочка, пробел внутри, логин в адресе, схема не http и не
 * https.
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function exactOrigin(value) {
  const v = String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
  // «null» это значение заголовка Origin у страницы из файла или песочницы, а не адрес
  if (!v || v.toLowerCase() === "null" || v.includes("*") || /\s/.test(v)) return null;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  if (!host) return null;
  return `${url.protocol}//${host}${url.port ? `:${url.port}` : ""}`;
}

/**
 * Все адреса ресурса: основной из APP_URL первым, затем дополнительные из APP_ALIASES через запятую, без повторов
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function appOrigins(env) {
  const list = [env.APP_URL, ...String(env.APP_ALIASES ?? "").split(",")].map(exactOrigin).filter((o) => o !== null);
  return [...new Set(list)];
}

/**
 * Разрешённые адреса серверных действий для next.config.mjs: SERVER_ACTIONS_ALLOWED_ORIGINS как есть (там шаблоны
 * чужих прокси вроде *.app.github.dev допустимы, так было и раньше) и хосты адресов ресурса из APP_URL и APP_ALIASES
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function serverActionOrigins(env) {
  const manual = String(env.SERVER_ACTIONS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const own = appOrigins(env).map((o) => new URL(o).host);
  return [...new Set([...manual, ...own])];
}
