// Этап 69: свой адрес приложения. Решение о постоянном переходе со старого адреса на основной из APP_URL (какие
// запросы уходят, какие нет, без переменной перехода нет, при совпадении хоста нет) и проверка Origin загрузок с
// дополнительными адресами из APP_ALIASES. Адреса в тестах условные.
import { describe, expect, it, vi } from "vitest";
import { APP_URL_REDIRECT, appOrigins, appUrlRedirect, redirectEnabled, requestHost, sameSiteOrigin } from "@/lib/app-url";
import { serverActionOrigins } from "@/lib/app-origins.mjs";

const NEW = "https://weekly.example.ru";
const OLD = "app-1234.hosting.example";
const ENV = { APP_URL: NEW, REDIRECT_TO_APP_URL: "1" };

const req = (over: { method?: string; pathname?: string; search?: string; headers?: Record<string, string> } = {}) => ({
  method: over.method ?? "GET",
  pathname: over.pathname ?? "/tasks",
  search: over.search ?? "",
  headers: new Headers(over.headers ?? { host: OLD }),
});

describe("переход на основной адрес", () => {
  it("страница со старого адреса: 308 на тот же путь и параметры основного адреса, GET и HEAD", () => {
    expect(appUrlRedirect(req(), ENV)).toBe(`${NEW}/tasks`);
    expect(appUrlRedirect(req({ pathname: "/login/link", search: "?t=abc%2Bdef&x=1" }), ENV)).toBe(`${NEW}/login/link?t=abc%2Bdef&x=1`);
    expect(appUrlRedirect(req({ pathname: "/" }), ENV)).toBe(`${NEW}/`);
    expect(appUrlRedirect(req({ method: "HEAD", pathname: "/weekly" }), ENV)).toBe(`${NEW}/weekly`);
    expect(appUrlRedirect(req({ method: "get", pathname: "/people/structure", search: "?team=top" }), ENV)).toBe(`${NEW}/people/structure?team=top`);
  });

  it("ответ перехода: 308 и запрет кэша, чтобы выключенный переход перестал действовать сразу", () => {
    expect(APP_URL_REDIRECT).toEqual({ status: 308, headers: { "Cache-Control": "no-store" } });
  });

  it("хост, который не разобрать как адрес, не переводится", () => {
    expect(appUrlRedirect(req({ headers: { host: "bad host" } }), ENV)).toBeNull();
    expect(appUrlRedirect(req({ headers: { host: "user@weekly.example.ru" } }), ENV)).toBeNull();
  });

  it("без переменной или с выключенной переменной поведение как раньше: перехода нет", () => {
    expect(appUrlRedirect(req(), { APP_URL: NEW })).toBeNull();
    for (const off of ["", "0", "false", "нет"]) expect(appUrlRedirect(req(), { APP_URL: NEW, REDIRECT_TO_APP_URL: off }), off).toBeNull();
    expect(redirectEnabled({ REDIRECT_TO_APP_URL: " TRUE " })).toBe(true);
    // Без APP_URL или с неверным APP_URL переводить некуда
    expect(appUrlRedirect(req(), { REDIRECT_TO_APP_URL: "1" })).toBeNull();
    expect(appUrlRedirect(req(), { APP_URL: "ftp://weekly.example.ru", REDIRECT_TO_APP_URL: "1" })).toBeNull();
  });

  it("запрос уже на основном адресе: перехода нет, регистр, точка в конце и порт по умолчанию не мешают", () => {
    for (const host of ["weekly.example.ru", "WEEKLY.example.ru", "weekly.example.ru.", "weekly.example.ru:443"]) {
      expect(appUrlRedirect(req({ headers: { host } }), ENV), host).toBeNull();
    }
    // Нестандартный порт: это другой адрес
    expect(appUrlRedirect(req({ headers: { host: "weekly.example.ru:8443" } }), ENV)).toBe(`${NEW}/tasks`);
    // Основной адрес на http с портом
    expect(appUrlRedirect(req({ headers: { host: "localhost:3100" } }), { APP_URL: "http://localhost:3100/", REDIRECT_TO_APP_URL: "1" })).toBeNull();
    expect(appUrlRedirect(req({ headers: { host: "127.0.0.1:3100" } }), { APP_URL: "http://localhost:3100/", REDIRECT_TO_APP_URL: "1" })).toBe("http://localhost:3100/tasks");
  });

  it("хост запроса как у Next: сначала X-Forwarded-Host (первый из списка), потом Host; без хоста перехода нет", () => {
    expect(appUrlRedirect(req({ headers: { host: "10.0.0.5:3000", "x-forwarded-host": "weekly.example.ru" } }), ENV)).toBeNull();
    expect(appUrlRedirect(req({ headers: { host: "10.0.0.5:3000", "x-forwarded-host": `${OLD}, proxy.local` } }), ENV)).toBe(`${NEW}/tasks`);
    expect(requestHost(new Headers({ host: OLD }))).toBe(OLD);
    expect(appUrlRedirect(req({ headers: {} }), ENV)).toBeNull();
  });

  it("не трогаются /api (проверка здоровья, календарь, загрузки), служебные файлы Next, POST и серверные действия", () => {
    for (const pathname of ["/api", "/api/health", "/api/live", "/api/calendar/abc.ics", "/api/market/upload", "/api/goals/leader-board", "/_next/static/chunk.js"]) {
      expect(appUrlRedirect(req({ pathname }), ENV), pathname).toBeNull();
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) expect(appUrlRedirect(req({ method }), ENV), method).toBeNull();
    expect(appUrlRedirect(req({ headers: { host: OLD, "next-action": "abc123" } }), ENV)).toBeNull();
    // Путь, который только начинается с «api», это обычная страница
    expect(appUrlRedirect(req({ pathname: "/apiary" }), ENV)).toBe(`${NEW}/apiary`);
  });
});

describe("проверка Origin загрузок", () => {
  /** Запрос к обработчику загрузки: адрес, как его видит Next, и заголовки прокси */
  const at = (url: string, headers: Record<string, string> = {}) => ({ url, headers: new Headers(headers) });
  // За прокси хостинга Next строит адрес запроса из адреса, на котором слушает сервер, а не из Host
  const INNER = "https://0.0.0.0:3000/api/market/upload";

  it("Origin: null, пустой и не адрес отклоняются явно, даже если совпали бы по списку или по запросу", () => {
    for (const origin of ["null", " NULL ", "", "не адрес", "weekly example ru", "*.example.ru"]) {
      expect(sameSiteOrigin(origin, at(`${NEW}/api/market/upload`, { host: "weekly.example.ru" }), { APP_URL: NEW, APP_ALIASES: "null" }), origin).toBe(false);
    }
    // «null» в списке адресов не становится адресом https://null
    expect(appOrigins({ APP_URL: NEW, APP_ALIASES: "null" })).toEqual([NEW]);
    expect(sameSiteOrigin("null", at("https://null/api/market/upload"), { APP_ALIASES: "null" })).toBe(false);
  });

  it("основной адрес и адрес, на который пришёл запрос, проходят; чужой сайт нет", () => {
    expect(sameSiteOrigin(NEW, at(INNER), { APP_URL: NEW })).toBe(true);
    expect(sameSiteOrigin(`${NEW}/`, at(INNER), { APP_URL: `${NEW}/` })).toBe(true);
    // Адрес запроса по заголовкам прокси: X-Forwarded-Host и X-Forwarded-Proto
    expect(sameSiteOrigin(`https://${OLD}`, at(INNER, { host: "10.0.0.5:3000", "x-forwarded-host": OLD, "x-forwarded-proto": "https" }), { APP_URL: NEW })).toBe(true);
    // Без прокси: Host и протокол самого запроса
    expect(sameSiteOrigin("http://localhost:3100", at("http://localhost:3100/api/market/upload", { host: "localhost:3100" }), {})).toBe(true);
    expect(sameSiteOrigin("https://evil.example", at(INNER, { host: OLD, "x-forwarded-proto": "https" }), { APP_URL: NEW })).toBe(false);
  });

  it("сравниваются и протокол, и порт: тот же домен по http или на другом порту это другой сайт", () => {
    expect(sameSiteOrigin("http://weekly.example.ru", at(`${NEW}/api/x`, { host: "weekly.example.ru" }), {})).toBe(false);
    expect(sameSiteOrigin("http://weekly.example.ru", at(INNER, { host: "weekly.example.ru", "x-forwarded-proto": "https" }), { APP_URL: NEW })).toBe(false);
    expect(sameSiteOrigin("https://weekly.example.ru:8443", at(INNER, { host: "weekly.example.ru", "x-forwarded-proto": "https" }), { APP_URL: NEW })).toBe(false);
    expect(sameSiteOrigin("https://weekly.example.ru", at(INNER, { host: "weekly.example.ru:443", "x-forwarded-proto": "https" }), {})).toBe(true);
  });

  it("хост с точкой в конце и в другом регистре: как в переходе, это тот же адрес", () => {
    expect(sameSiteOrigin("https://weekly.example.ru.", at(INNER), { APP_URL: NEW })).toBe(true);
    expect(sameSiteOrigin("https://WEEKLY.example.ru", at(INNER), { APP_URL: "https://weekly.example.ru." })).toBe(true);
    expect(sameSiteOrigin(NEW, at(INNER, { host: "Weekly.Example.ru.", "x-forwarded-proto": "https" }), {})).toBe(true);
  });

  it("прокси скрыл адрес запроса: технический адрес проходит только по списку APP_ALIASES", () => {
    expect(sameSiteOrigin(`https://${OLD}`, at(INNER), { APP_URL: NEW })).toBe(false);
    expect(sameSiteOrigin(`https://${OLD}`, at(INNER), { APP_URL: NEW, APP_ALIASES: `https://${OLD}` })).toBe(true);
    // Можно без протокола и с лишними пробелами, несколько адресов через запятую
    expect(sameSiteOrigin(`https://${OLD}`, at(INNER), { APP_URL: NEW, APP_ALIASES: ` other.example , ${OLD}/ ` })).toBe(true);
    // Список не открывает чужие сайты
    expect(sameSiteOrigin("https://evil.example", at(INNER), { APP_URL: NEW, APP_ALIASES: `https://${OLD}` })).toBe(false);
    expect(sameSiteOrigin(`https://${OLD}.evil.example`, at(INNER), { APP_URL: NEW, APP_ALIASES: OLD })).toBe(false);
  });

  it("в списке только точные адреса http и https: шаблоны со звёздочкой и другие схемы отбрасываются", () => {
    const env = { APP_URL: NEW, APP_ALIASES: "*.hosting.example, https://*.hosting.example, ftp://files.example, https://user:pw@login.example, ws://socket.example" };
    expect(appOrigins(env)).toEqual([NEW]);
    for (const origin of ["https://app-1.hosting.example", "https://files.example", "http://files.example", "https://login.example", "https://socket.example"]) {
      expect(sameSiteOrigin(origin, at(INNER), env), origin).toBe(false);
    }
  });

  it("список адресов ресурса: основной первым, без повторов и пустых", () => {
    expect(appOrigins({ APP_URL: `${NEW}/`, APP_ALIASES: `${OLD}, , ${NEW}, ftp://x.example` })).toEqual([NEW, `https://${OLD}`]);
    expect(appOrigins({})).toEqual([]);
  });
});

describe("разрешённые адреса серверных действий (next.config.mjs)", () => {
  it("SERVER_ACTIONS_ALLOWED_ORIGINS как есть, плюс хосты точных адресов из APP_URL и APP_ALIASES", () => {
    expect(serverActionOrigins({})).toEqual([]);
    expect(serverActionOrigins({ SERVER_ACTIONS_ALLOWED_ORIGINS: " *.app.github.dev , ", APP_URL: `${NEW}/`, APP_ALIASES: `https://${OLD}, http://localhost:3100` })).toEqual([
      "*.app.github.dev",
      "weekly.example.ru",
      OLD,
      "localhost:3100",
    ]);
  });

  it("звёздочка и другие схемы из APP_ALIASES в разрешённые адреса не попадают, как и в проверку загрузок", () => {
    const aliases = ["*.twc1.net", "https://*.twc1.net", "ftp://x.example", "x.example", "https://y.example:8443", "null"];
    const env = { APP_URL: NEW, APP_ALIASES: aliases.join(",") };
    const allowed = serverActionOrigins(env);
    expect(allowed).not.toContain("*.twc1.net");
    expect(allowed).not.toContain("ftp");
    expect(allowed).not.toContain("x.example:21");
    // Одно правило на оба места: хост разрешён серверным действиям тогда и только тогда, когда адрес принят загрузками
    expect(allowed).toEqual(appOrigins(env).map((o) => new URL(o).host));
  });

  it("next.config.mjs берёт разрешённые адреса из этой функции при запуске сервера", async () => {
    vi.stubEnv("SERVER_ACTIONS_ALLOWED_ORIGINS", "");
    vi.stubEnv("APP_URL", NEW);
    vi.stubEnv("APP_ALIASES", `https://${OLD}, *.hosting.example`);
    vi.resetModules();
    try {
      // @ts-expect-error: у next.config.mjs нет объявления типов, тест читает только разрешённые адреса
      const config = (await import("../../next.config.mjs")).default as { experimental?: { serverActions?: { allowedOrigins?: string[] } } };
      expect(config.experimental?.serverActions?.allowedOrigins).toEqual(["weekly.example.ru", OLD]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
