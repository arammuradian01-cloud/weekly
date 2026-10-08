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
    expect(sw).toMatch(/fetch\(request\)\.catch\(\(\) => caches\.match\(OFFLINE_URL\)\)/);
    // Кэш пополняется только в ветке неизменяемых файлов
    expect(sw.match(/cache\.put\(/g)?.length).toBe(1);
    expect(sw).toContain('url.pathname.startsWith("/_next/static/")');
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
    expect(html).toContain("prefers-color-scheme: dark");
    expect(sw).toContain('const OFFLINE_URL = "/offline.html"');
  });
});
