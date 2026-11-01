import { describe, expect, it } from "vitest";
import { CSP_REPORT_PATH, HSTS_MAX_AGE, NONCE_HEADER, cspMode, cspPolicy, cspRelaxed, hstsValue, isHttps, newNonce, securityHeaders } from "@/lib/security";

// Этап 86: заголовки безопасности. HSTS только на https, политика CSP с одноразовой меткой, у страниц рынка своя

describe("режим политики", () => {
  it("по умолчанию политика действует", () => {
    expect(cspMode({})).toBe("on");
    expect(cspMode({ CSP_MODE: "" })).toBe("on");
    expect(cspMode({ CSP_MODE: "что-то своё" })).toBe("on");
  });

  it("report-only и off читаются, регистр и пробелы не важны", () => {
    expect(cspMode({ CSP_MODE: "report-only" })).toBe("report-only");
    expect(cspMode({ CSP_MODE: " REPORT " })).toBe("report-only");
    expect(cspMode({ CSP_MODE: "Off" })).toBe("off");
  });
});

describe("HSTS", () => {
  it("на http заголовка нет: по http он всё равно не действует", () => {
    expect(isHttps({ APP_URL: "http://localhost:3000" })).toBe(false);
    expect(hstsValue({ APP_URL: "http://localhost:3000" })).toBeNull();
    expect(hstsValue({})).toBeNull();
  });

  it("на https год, срок можно задать своим", () => {
    expect(hstsValue({ APP_URL: "https://example.ru" })).toBe(`max-age=${HSTS_MAX_AGE}`);
    expect(hstsValue({ APP_URL: "https://example.ru", HSTS_MAX_AGE: "600" })).toBe("max-age=600");
    // Нечисловое значение не ломает заголовок: берётся год
    expect(hstsValue({ APP_URL: "https://example.ru", HSTS_MAX_AGE: "скоро" })).toBe(`max-age=${HSTS_MAX_AGE}`);
  });

  it("HSTS=off выключает заголовок", () => {
    expect(hstsValue({ APP_URL: "https://example.ru", HSTS: "off" })).toBeNull();
  });
});

describe("политика", () => {
  const strict = cspPolicy({ nonce: "abc123", https: true });

  it("встроенные скрипты только с меткой, файлы свои", () => {
    expect(strict).toContain("script-src 'self' 'nonce-abc123'");
    expect(strict).not.toContain("'unsafe-inline' 'nonce-");
    // 'strict-dynamic' не берём намеренно: с ним файл сборки без метки дал бы белый экран
    expect(strict).not.toContain("strict-dynamic");
  });

  it("шрифты, картинки, живые обновления и служебный обработчик разрешены со своего адреса", () => {
    expect(strict).toContain("font-src 'self' data:");
    expect(strict).toContain("img-src 'self' data: blob:");
    expect(strict).toContain("connect-src 'self'");
    expect(strict).toContain("worker-src 'self' blob:");
    expect(strict).toContain("manifest-src 'self'");
    // Окно дашборда рынка живёт в iframe
    expect(strict).toContain("frame-src 'self' blob:");
  });

  it("страницу не встроить в чужую, формы только к себе, жалобы на свой адрес", () => {
    expect(strict).toContain("frame-ancestors 'none'");
    expect(strict).toContain("form-action 'self'");
    expect(strict).toContain("base-uri 'none'");
    expect(strict).toContain("object-src 'none'");
    expect(strict).toContain(`report-uri ${CSP_REPORT_PATH}`);
  });

  it("на http адреса не переводятся на https: иначе разработка не работает", () => {
    expect(cspPolicy({ nonce: "abc123", https: false })).not.toContain("upgrade-insecure-requests");
    expect(strict).toContain("upgrade-insecure-requests");
  });

  it("без метки встроенные скрипты разрешены как есть: это политика страниц рынка", () => {
    const soft = cspPolicy({ nonce: null, https: true });
    expect(soft).toContain("script-src 'self' 'unsafe-inline'");
    // Запрета встраивания в мягкой политике нет: окно дашборда наследует политику родителя
    expect(soft).not.toContain("frame-ancestors");
  });
});

describe("страницы рынка", () => {
  it("рынок и его подстраницы без метки, остальные со строгой политикой", () => {
    expect(cspRelaxed("/market")).toBe(true);
    expect(cspRelaxed("/market/data")).toBe(true);
    expect(cspRelaxed("/marketing")).toBe(false);
    expect(cspRelaxed("/tasks")).toBe(false);
    expect(cspRelaxed("/")).toBe(false);
  });
});

describe("метка", () => {
  it("каждый раз новая, только буквы и цифры", () => {
    const first = newNonce();
    const second = newNonce();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("заголовки ответа", () => {
  const https = { APP_URL: "https://example.ru" };

  it("на обычной странице уходит политика, метка есть и в ответе, и в заголовке запроса", () => {
    const headers = securityHeaders("/tasks", https, "nonce1");
    expect(headers.nonce).toBe("nonce1");
    expect(headers.response["Content-Security-Policy"]).toContain("'nonce-nonce1'");
    expect(headers.response["Content-Security-Policy-Report-Only"]).toBeUndefined();
    expect(headers.response["Strict-Transport-Security"]).toBe(`max-age=${HSTS_MAX_AGE}`);
    expect(headers.response["Reporting-Endpoints"]).toContain(CSP_REPORT_PATH);
    // Next берёт метку из заголовка запроса и ставит её своим встроенным скриптам
    expect(headers.request[NONCE_HEADER]).toBe("nonce1");
    expect(headers.request["Content-Security-Policy"]).toBe(headers.response["Content-Security-Policy"]);
  });

  it("режим жалоб: другой заголовок, ничего не блокируется", () => {
    const headers = securityHeaders("/tasks", { ...https, CSP_MODE: "report-only" }, "nonce2");
    expect(headers.response["Content-Security-Policy"]).toBeUndefined();
    expect(headers.response["Content-Security-Policy-Report-Only"]).toContain("'nonce-nonce2'");
  });

  it("на странице рынка метки нет: встроенный код окна дашборда наследует политику родителя", () => {
    const headers = securityHeaders("/market", https, "nonce3");
    expect(headers.nonce).toBeNull();
    expect(headers.request[NONCE_HEADER]).toBeUndefined();
    expect(headers.response["Content-Security-Policy"]).toContain("'unsafe-inline'");
  });

  it("CSP_MODE=off: остаётся только HSTS", () => {
    const headers = securityHeaders("/tasks", { ...https, CSP_MODE: "off" }, "nonce4");
    expect(headers.response["Content-Security-Policy"]).toBeUndefined();
    expect(headers.response["Content-Security-Policy-Report-Only"]).toBeUndefined();
    expect(headers.response["Strict-Transport-Security"]).toBe(`max-age=${HSTS_MAX_AGE}`);
    expect(headers.nonce).toBeNull();
  });

  it("на http политика есть, HSTS нет", () => {
    const headers = securityHeaders("/tasks", { APP_URL: "http://localhost:3000" }, "nonce5");
    expect(headers.response["Strict-Transport-Security"]).toBeUndefined();
    expect(headers.response["Content-Security-Policy"]).toContain("'nonce-nonce5'");
  });
});
