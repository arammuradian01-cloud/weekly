import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { config } from "@/proxy";

// Приложение на экране «Домой» (этап 26): описание приложения, значки, служебный обработчик и доступ без входа

describe("описание приложения", () => {
  const m = manifest();
  it("открывается без адресной строки с главной, значки лежат в public", () => {
    expect(m).toMatchObject({ start_url: "/", scope: "/", display: "standalone", short_name: "Weekly", lang: "ru" });
    const sizes = (m.icons ?? []).map((i) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
    for (const icon of m.icons ?? []) expect(existsSync(`public${icon.src}`)).toBe(true);
    expect(existsSync("public/icons/apple-touch-icon.png")).toBe(true);
    expect(existsSync("public/icons/badge-96.png")).toBe(true);
  });

  it("быстрые действия ведут в «Мне», сдачу weekly и мои задачи", () => {
    expect((m.shortcuts ?? []).map((s) => s.url)).toEqual(["/me", "/weekly/submit", "/tasks/mine"]);
  });
});

describe("доступ без входа", () => {
  // Шаблон matcher из proxy.ts: путь целиком
  const gated = new RegExp(`^${config.matcher[0]}$`);
  it("описание приложения, обработчик, страница «Нет сети» и значки открыты без cookie", () => {
    for (const path of ["/manifest.webmanifest", "/sw.js", "/offline.html", "/icons/icon-192.png", "/logo/sravni_sign.svg"]) expect(gated.test(path), path).toBe(false);
  });
  it("рабочие страницы по-прежнему за входом", () => {
    for (const path of ["/", "/me", "/weekly/submit", "/tasks/47", "/requests/5", "/profile", "/api/events"]) expect(gated.test(path), path).toBe(true);
  });
});

describe("служебный обработчик", () => {
  const sw = readFileSync("public/sw.js", "utf8");
  it("страницы с данными не кэширует: переход идёт в сеть, без сети страница «Нет сети»", () => {
    expect(sw).toContain('request.mode === "navigate"');
    expect(sw).toContain("() => offlinePage().catch(() => Response.error())");
    // Этап 75: ответ прокси хостинга 502-504 на переход тоже заменяется своей страницей с кодом
    expect(sw).toContain("const GATEWAY = [502, 503, 504];");
    expect(sw).toContain('request.mode === "navigate" && !url.pathname.startsWith("/api/")');
    expect(sw).toContain('const VERSION = "weekly-v2";');
    // Кэш пополняется только в ветке файлов сборки и значков, старые файлы сборки вытесняются
    expect(sw.match(/cache\.put\(/g)?.length).toBe(1);
    expect(sw).toContain("if (isBuild(url) || isBrand(url)) {");
    expect(sw).toContain('url.pathname.startsWith("/_next/static/")');
    expect(sw).toContain("const MAX_STATIC = 250;");
    expect(sw).toContain('if (request.method !== "GET") return;');
  });
  it("уведомление показывает кто и что и открывает предмет только внутри ресурса", () => {
    expect(sw).toContain('self.addEventListener("push"');
    expect(sw).toContain('self.addEventListener("notificationclick"');
    expect(sw).toContain("if (target.origin !== self.location.origin) return;");
  });
  it("страница «Нет сети» самостоятельная и есть в списке заранее загруженного", () => {
    const html = readFileSync("public/offline.html", "utf8");
    expect(html).toContain("Нет сети");
    // Этап 75: при живой сети заголовок «Ошибка <код>», код подставляет обработчик
    expect(html).toContain('<main data-code="503">');
    expect(html).toContain('"Ошибка " + code');
    // Возврат после сбоя: опрос /api/health с растущим интервалом, обрыв запроса и не больше 4 перезагрузок за 10 минут
    expect(html).toContain('fetch("/api/health"');
    expect(html).toContain("var STEPS = [15, 30, 60, 120];");
    expect(html).toContain("now - t < 600000");
    expect(html).toContain("recent().length >= 4");
    expect(html).toContain("ctrl.abort()");
    expect(html).not.toContain("setInterval(");
    expect(html).toContain("Черновик weekly, который вы писали, сохранён на этом устройстве");
    expect(html).toContain("prefers-color-scheme: dark");
    expect(sw).toContain('const OFFLINE_URL = "/offline.html"');
  });
});
