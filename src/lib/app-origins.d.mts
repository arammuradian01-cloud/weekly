// Типы для app-origins.mjs (этап 69): модуль на JavaScript, его читает и next.config.mjs
type Env = Record<string, string | undefined>;

/** Точный адрес http или https без точки в конце хоста и порта по умолчанию, или null */
export function exactOrigin(value: string | null | undefined): string | null;
/** Все адреса ресурса: основной из APP_URL первым, затем APP_ALIASES, без повторов */
export function appOrigins(env: Env): string[];
/** Разрешённые адреса серверных действий: SERVER_ACTIONS_ALLOWED_ORIGINS как есть и хосты адресов ресурса */
export function serverActionOrigins(env: Env): string[];
