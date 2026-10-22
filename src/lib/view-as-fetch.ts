// Метка вкладки в запросах (этап 63, второй круг): к серверным действиям (заголовок Next-Action) и к изменениям через
// /api добавляется заголовок X-Weekly-View с состоянием просмотра, в котором сервер показал вкладку. Без React и без
// window: обёртку fetch ставит ViewAsSync, правило проверяет tests/unit/view-as.test.ts.

export const VIEW_AS_TAB_HEADER_NAME = "x-weekly-view";

/**
 * Параметры запроса с меткой вкладки или null, если метка этому запросу не нужна (чтение, чужой адрес, статика).
 * origin: адрес страницы, base: от чего считать относительный адрес
 */
export function labelRequest(input: RequestInfo | URL, init: RequestInit | undefined, tab: string | null, page: { origin: string; href: string }): RequestInit | null {
  if (!tab) return null;
  const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
  const headers = new Headers(init?.headers ?? request?.headers);
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const url = new URL(request ? request.url : String(input), page.href);
  const change = method !== "GET" && method !== "HEAD" && url.origin === page.origin && url.pathname.startsWith("/api/");
  if (!headers.has("next-action") && !change) return null;
  headers.set(VIEW_AS_TAB_HEADER_NAME, tab);
  return { ...init, headers };
}
