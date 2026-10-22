// Этап 69: свой адрес приложения. Решение о постоянном переходе со старого адреса на основной из APP_URL (какие
// запросы уходят, какие нет, без переменной перехода нет, при совпадении хоста нет) и проверка Origin загрузок с
// дополнительными адресами из APP_ALIASES. Адреса в тестах условные.
import { describe, expect, it } from "vitest";
import { appOrigins, appUrlRedirect, redirectEnabled, requestHost, sameSiteOrigin } from "@/lib/app-url";

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
  const URL_OLD = `https://${OLD}/api/market/upload`;
  const URL_NEW = `${NEW}/api/market/upload`;

  it("основной адрес и адрес самого запроса проходят, чужой сайт и Origin: null нет", () => {
    expect(sameSiteOrigin(NEW, URL_NEW, { APP_URL: NEW })).toBe(true);
    expect(sameSiteOrigin(`${NEW}/`, URL_OLD, { APP_URL: `${NEW}/` })).toBe(true);
    expect(sameSiteOrigin(`https://${OLD}`, URL_OLD, { APP_URL: NEW })).toBe(true);
    expect(sameSiteOrigin("https://evil.example", URL_NEW, { APP_URL: NEW })).toBe(false);
    expect(sameSiteOrigin("null", URL_NEW, { APP_URL: NEW })).toBe(false);
    expect(sameSiteOrigin("не адрес", URL_NEW, { APP_URL: NEW })).toBe(false);
    // Тот же домен по http: это другой сайт
    expect(sameSiteOrigin("http://weekly.example.ru", "http://10.0.0.5:3000/api/market/upload", { APP_URL: NEW })).toBe(false);
  });

  it("прокси хостинга подменил адрес запроса: основной и технический адреса проходят только по списку", () => {
    const inner = "http://10.0.0.5:3000/api/market/upload";
    expect(sameSiteOrigin(NEW, inner, { APP_URL: NEW })).toBe(true);
    // Технический адрес, пока переход выключен: без APP_ALIASES отказ, с ним проходит
    expect(sameSiteOrigin(`https://${OLD}`, inner, { APP_URL: NEW })).toBe(false);
    expect(sameSiteOrigin(`https://${OLD}`, inner, { APP_URL: NEW, APP_ALIASES: `https://${OLD}` })).toBe(true);
    // Можно без протокола и с лишними пробелами, несколько адресов через запятую
    expect(sameSiteOrigin(`https://${OLD}`, inner, { APP_URL: NEW, APP_ALIASES: ` other.example , ${OLD}/ ` })).toBe(true);
    // Список не открывает чужие сайты
    expect(sameSiteOrigin("https://evil.example", inner, { APP_URL: NEW, APP_ALIASES: `https://${OLD}` })).toBe(false);
    expect(sameSiteOrigin(`https://${OLD}.evil.example`, inner, { APP_URL: NEW, APP_ALIASES: OLD })).toBe(false);
  });

  it("список адресов ресурса: основной первым, без повторов и пустых", () => {
    expect(appOrigins({ APP_URL: `${NEW}/`, APP_ALIASES: `${OLD}, , ${NEW}, ftp://x.example` })).toEqual([NEW, `https://${OLD}`]);
    expect(appOrigins({})).toEqual([]);
  });
});
