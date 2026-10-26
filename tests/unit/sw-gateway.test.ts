import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// Этап 75: служебный обработчик загружается в песочницу с поддельными self, caches и fetch, и проверяется по
// поведению: какие переходы он подменяет своей страницей ошибки и с каким кодом, а какие пропускает как есть
type Handler = (event: unknown) => void;

function loadSw(fetchImpl: (req: unknown) => Promise<Response>, cached = true) {
  const handlers: Record<string, Handler> = {};
  const html = readFileSync("public/offline.html", "utf8");
  const cache = { match: async () => undefined, put: async () => {}, keys: async () => [], delete: async () => true, addAll: async () => {} };
  const context = {
    self: { addEventListener: (type: string, fn: Handler) => (handlers[type] = fn), location: { origin: "https://w.test" } },
    caches: { match: async () => (cached ? new Response(html) : undefined), open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: fetchImpl,
    Response,
    URL,
    console,
  };
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), context);
  return async (path: string, init: { method?: string; mode?: string } = {}) => {
    let answer: Promise<Response> | undefined;
    handlers.fetch({
      request: { method: init.method ?? "GET", url: `https://w.test${path}`, mode: init.mode ?? "navigate" },
      respondWith: (p: Promise<Response>) => (answer = p),
    });
    return answer ? await answer : undefined;
  };
}

describe("служебный обработчик: ответы прокси и сбои сети", () => {
  it.each([502, 503, 504])("ответ прокси %i на переход заменяется своей страницей с тем же кодом", async (code) => {
    const open = loadSw(async () => new Response("прокси", { status: code }));
    const res = await open("/me");
    expect(res?.status).toBe(code);
    expect(await res?.text()).toContain(`<main data-code="${code}">`);
    expect(res?.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res?.headers.get("Cache-Control")).toBe("no-store");
  });

  it("сервер не ответил вовсе: своя страница с кодом 503", async () => {
    const open = loadSw(async () => Promise.reject(new TypeError("Failed to fetch")));
    const res = await open("/weekly");
    expect(res?.status).toBe(503);
    expect(await res?.text()).toContain('<main data-code="503">');
  });

  it("ответы 200, 404, 500 и редирект проходят без изменений", async () => {
    for (const status of [200, 404, 500]) {
      const original = new Response("своё", { status });
      const open = loadSw(async () => original);
      expect(await open("/tasks")).toBe(original);
    }
    const redirect = Response.redirect("https://w.test/login", 302);
    expect(await loadSw(async () => redirect)("/")).toBe(redirect);
  });

  it("переходы на /api/, запросы не GET и чужие адреса не перехватываются", async () => {
    const open = loadSw(async () => new Response("", { status: 503 }));
    expect(await open("/api/health")).toBeUndefined();
    expect(await open("/weekly", { method: "POST" })).toBeUndefined();
    expect(await open("/weekly", { method: "HEAD" })).toBeUndefined();
  });

  it("страницы ошибки нет в кэше: короткий текст с кодом прокси", async () => {
    const open = loadSw(async () => new Response("", { status: 502 }), false);
    const res = await open("/me");
    expect(res?.status).toBe(502);
    expect(await res?.text()).toBe("Ошибка 502");
  });
});
