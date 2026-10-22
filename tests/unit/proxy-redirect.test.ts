// Этап 69: переход на основной адрес в самом proxy. Переход срабатывает раньше открытых путей и проверки входа (экран
// входа и страница без cookie на старом адресе уходят на основной, а не на старый /login), отвечает 308 с запретом
// кэша и сохраняет путь и параметры. /api, POST и запросы на основной адрес идут как раньше. Адреса условные.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const NEW = "https://weekly.example.ru";
const OLD = "app-1234.hosting.example";

function request(path: string, host: string, method = "GET") {
  // Адрес запроса у Next за прокси внутренний, хост берётся из заголовков
  return new NextRequest(`http://0.0.0.0:3000${path}`, { method, headers: { host, "x-forwarded-host": host, "x-forwarded-proto": "https" } });
}

const passedOn = (res: Response) => res.headers.get("x-middleware-next") === "1";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("переход на основной адрес в proxy", () => {
  it("экран входа и страница без входа на старом адресе: 308 на основной адрес до открытых путей и проверки входа, без кэша", async () => {
    vi.stubEnv("APP_URL", NEW);
    vi.stubEnv("REDIRECT_TO_APP_URL", "1");
    for (const [path, target] of [
      ["/login?ended=1", `${NEW}/login?ended=1`],
      ["/login/link?t=abc", `${NEW}/login/link?t=abc`],
      ["/setup", `${NEW}/setup`],
      ["/tasks?team=top", `${NEW}/tasks?team=top`],
      ["/", `${NEW}/`],
    ] as const) {
      const res = await proxy(request(path, OLD));
      expect(res.status, path).toBe(308);
      expect(res.headers.get("location"), path).toBe(target);
      expect(res.headers.get("cache-control"), path).toBe("no-store");
    }
    const head = await proxy(request("/weekly", OLD, "HEAD"));
    expect([head.status, head.headers.get("location")]).toEqual([308, `${NEW}/weekly`]);
  });

  it("не переводятся: /api на старом адресе, POST, запросы на основной адрес и всё без переменной", async () => {
    vi.stubEnv("APP_URL", NEW);
    vi.stubEnv("REDIRECT_TO_APP_URL", "1");
    for (const path of ["/api/health", "/api/live", "/api/calendar/abc.ics"]) {
      const res = await proxy(request(path, OLD));
      expect(passedOn(res), path).toBe(true);
      expect(res.headers.get("location"), path).toBeNull();
    }
    // Открытый путь на основном адресе пропускается как раньше
    expect(passedOn(await proxy(request("/login", "weekly.example.ru")))).toBe(true);
    // Страница без входа на основном адресе: обычный переход на вход того же адреса
    const own = await proxy(request("/tasks", "weekly.example.ru"));
    expect(own.status).toBe(307);
    expect(own.headers.get("location")).toMatch(/\/login$/);
    // POST на старом адресе: не 308, а прежняя проверка входа
    const post = await proxy(request("/tasks", OLD, "POST"));
    expect(post.status).toBe(307);
    expect(post.headers.get("location")).not.toContain("weekly.example.ru");

    vi.stubEnv("REDIRECT_TO_APP_URL", "");
    expect(passedOn(await proxy(request("/login", OLD)))).toBe(true);
    expect((await proxy(request("/tasks", OLD))).status).toBe(307);
  });
});
