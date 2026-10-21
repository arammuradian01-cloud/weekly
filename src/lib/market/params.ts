// Параметры страницы рынка в адресе (этап 62): вкладка дашборда и фильтры живут в /market?tab=...&gm=..., чтобы
// ссылкой можно было поделиться. И проверка сообщений из окна дашборда: оно изолировано, поэтому всё, что от него
// приходит, читается как недоверенные данные. Чистые функции без браузера и базы.

/** Фильтры дашборда: имя и значение */
export type MarketParams = Record<string, string>;
export type MarketState = { link: string | null; params: MarketParams };

/** Имя вкладки в адресе */
export const LINK_KEY = "tab";
const LINK = /^[A-Za-z0-9_-]{1,60}$/;
const PARAM_KEY = /^[A-Za-z0-9_]{1,40}$/;
const MAX_PARAMS = 40;
const MAX_VALUE = 200;
/** Высота окна дашборда: от и до, пикселей */
export const FRAME_HEIGHT = { min: 200, max: 20000 };

/** Значение фильтра строкой: текст как есть, число и да или нет текстом, остальное не берётся */
function valueOf(v: unknown): string | null {
  if (typeof v === "string") return v.slice(0, MAX_VALUE);
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return null;
}

/** Фильтры из сообщения или адреса: только понятные имена и короткие значения, пустые значения отбрасываются */
export function cleanParams(raw: unknown): MarketParams {
  const out: MarketParams = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  let n = 0;
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_PARAMS) break;
    if (key === LINK_KEY || !PARAM_KEY.test(key)) continue;
    const value = valueOf(v);
    if (value === null || value === "") continue;
    out[key] = value;
    n++;
  }
  return out;
}

export function cleanLink(raw: unknown): string | null {
  return typeof raw === "string" && LINK.test(raw) ? raw : null;
}

type SearchLike = URLSearchParams | Record<string, string | string[] | undefined>;

/** Состояние из адреса страницы */
export function stateFromSearch(search: SearchLike): MarketState {
  const entries: [string, string][] =
    search instanceof URLSearchParams
      ? [...search.entries()]
      : Object.entries(search).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : Array.isArray(v) && typeof v[0] === "string" ? [[k, v[0]] as [string, string]] : []));
  const raw: Record<string, string> = {};
  for (const [k, v] of entries) if (!(k in raw)) raw[k] = v;
  return { link: cleanLink(raw[LINK_KEY]), params: cleanParams(raw) };
}

/** Строка адреса для состояния: "?tab=insurers&gm=cnt" или пусто. Фильтры по имени, чтобы ссылка не прыгала */
export function searchFromState(state: MarketState): string {
  const q = new URLSearchParams();
  if (state.link) q.set(LINK_KEY, state.link);
  const params = cleanParams(state.params);
  for (const key of Object.keys(params).sort()) q.set(key, params[key]!);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Сообщения окна дашборда родителю */
export type FrameMessage = { type: "ready" } | { type: "height"; height: number } | { type: "params"; params: MarketParams } | { type: "link"; link: string };

/** Сообщение из окна дашборда или null, если оно не по схеме */
export function readFrameMessage(data: unknown): FrameMessage | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const m = data as Record<string, unknown>;
  switch (m.type) {
    case "ready":
      return { type: "ready" };
    case "height": {
      const h = m.height;
      if (typeof h !== "number" || !Number.isFinite(h)) return null;
      return { type: "height", height: Math.round(Math.min(FRAME_HEIGHT.max, Math.max(FRAME_HEIGHT.min, h))) };
    }
    case "params":
      if (!m.params || typeof m.params !== "object" || Array.isArray(m.params)) return null;
      return { type: "params", params: cleanParams(m.params) };
    case "link": {
      const link = cleanLink(m.link);
      return link ? { type: "link", link } : null;
    }
    default:
      return null;
  }
}
