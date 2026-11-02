import { describe, expect, it } from "vitest";
import { CSP_REPORT_PATH, HSTS_MAX_AGE, NONCE_HEADER, cspMode, cspPolicy, hstsValue, isHttps, newNonce, securityHeaders } from "@/lib/security";
import { PUBLIC_PATHS } from "@/proxy";

// Этап 86: заголовки безопасности. HSTS только на https; политика одна на всё приложение (она живёт на документе,
// а не на адресе страницы), по умолчанию со встроенными скриптами, в режиме strict только с меткой nonce

describe("режим политики", () => {
  it("по умолчанию политика действует", () => {
    expect(cspMode({})).toBe("on");
    expect(cspMode({ CSP_MODE: "" })).toBe("on");
    expect(cspMode({ CSP_MODE: "что-то своё" })).toBe("on");
  });

  it("strict, report-only и off читаются, регистр и пробелы не важны", () => {
    expect(cspMode({ CSP_MODE: "strict" })).toBe("strict");
    expect(cspMode({ CSP_MODE: " STRICT " })).toBe("strict");
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
  const inline = cspPolicy({ nonce: null, https: true });
  const strict = cspPolicy({ nonce: "abc123", https: true });

  it("у обеих политик чужие адреса закрыты, формы и запросы только к себе", () => {
    for (const policy of [inline, strict]) {
      expect(policy).toContain("default-src 'self'");
      expect(policy).toContain("style-src 'self' 'unsafe-inline'");
      expect(policy).toContain("font-src 'self' data:");
      expect(policy).toContain("img-src 'self' data: blob:");
      // Данные некуда увести: запросы только на свой адрес. Сюда же живые обновления /api/events
      expect(policy).toContain("connect-src 'self'");
      expect(policy).toContain("worker-src 'self' blob:");
      expect(policy).toContain("manifest-src 'self'");
      // Окно дашборда рынка живёт в iframe
      expect(policy).toContain("frame-src 'self' blob:");
      expect(policy).toContain("object-src 'none'");
      expect(policy).toContain("base-uri 'none'");
      expect(policy).toContain("form-action 'self'");
      expect(policy).toContain(`report-uri ${CSP_REPORT_PATH}`);
    }
  });

  it("по умолчанию встроенные скрипты разрешены: иначе не работает дашборд рынка в окне srcdoc", () => {
    expect(inline).toContain("script-src 'self' 'unsafe-inline'");
    // Запрета встраивания тут нет: окно дашборда наследует политику родителя. Его закрывает X-Frame-Options
    expect(inline).not.toContain("frame-ancestors");
  });

  it("в строгой политике встроенные скрипты только с меткой", () => {
    expect(strict).toContain("script-src 'self' 'nonce-abc123'");
    expect(strict).not.toContain("'unsafe-inline' 'nonce-");
    expect(strict).not.toContain("script-src 'self' 'unsafe-inline'");
    // 'strict-dynamic' не берём намеренно: с ним файл сборки без метки дал бы белый экран
    expect(strict).not.toContain("strict-dynamic");
    expect(strict).toContain("frame-ancestors 'none'");
  });

  it("на http адреса не переводятся на https: иначе разработка не работает", () => {
    expect(cspPolicy({ nonce: "abc123", https: false })).not.toContain("upgrade-insecure-requests");
    expect(strict).toContain("upgrade-insecure-requests");
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

  it("по умолчанию: политика действует, метки нет, встроенные скрипты разрешены", () => {
    const headers = securityHeaders(https, "nonce1");
    expect(headers.nonce).toBeNull();
    expect(headers.request[NONCE_HEADER]).toBeUndefined();
    expect(headers.response["Content-Security-Policy"]).toContain("'unsafe-inline'");
    expect(headers.response["Content-Security-Policy-Report-Only"]).toBeUndefined();
    expect(headers.response["Strict-Transport-Security"]).toBe(`max-age=${HSTS_MAX_AGE}`);
    expect(headers.response["Reporting-Endpoints"]).toContain(CSP_REPORT_PATH);
  });

  it("strict: метка есть и в ответе, и в заголовке запроса, оттуда её берёт Next", () => {
    const headers = securityHeaders({ ...https, CSP_MODE: "strict" }, "nonce2");
    expect(headers.nonce).toBe("nonce2");
    expect(headers.response["Content-Security-Policy"]).toContain("'nonce-nonce2'");
    expect(headers.request[NONCE_HEADER]).toBe("nonce2");
    expect(headers.request["Content-Security-Policy"]).toBe(headers.response["Content-Security-Policy"]);
  });

  it("режим жалоб: другой заголовок и строгая политика, но ничего не блокируется", () => {
    const headers = securityHeaders({ ...https, CSP_MODE: "report-only" }, "nonce3");
    expect(headers.response["Content-Security-Policy"]).toBeUndefined();
    expect(headers.response["Content-Security-Policy-Report-Only"]).toContain("'nonce-nonce3'");
    expect(headers.request[NONCE_HEADER]).toBe("nonce3");
  });

  it("CSP_MODE=off: остаётся только HSTS", () => {
    const headers = securityHeaders({ ...https, CSP_MODE: "off" }, "nonce4");
    expect(headers.response["Content-Security-Policy"]).toBeUndefined();
    expect(headers.response["Content-Security-Policy-Report-Only"]).toBeUndefined();
    expect(headers.response["Strict-Transport-Security"]).toBe(`max-age=${HSTS_MAX_AGE}`);
    expect(headers.nonce).toBeNull();
  });

  it("на http политика есть, HSTS нет", () => {
    const headers = securityHeaders({ APP_URL: "http://localhost:3000" }, "nonce5");
    expect(headers.response["Strict-Transport-Security"]).toBeUndefined();
    expect(headers.response["Content-Security-Policy"]).toContain("script-src 'self' 'unsafe-inline'");
  });
});

describe("открытые пути", () => {
  it("сбор сбоев открыт без входа: жалобу политики браузер присылает без cookie, и сбой бывает на экране входа", () => {
    expect(PUBLIC_PATHS).toContain(CSP_REPORT_PATH);
    expect(PUBLIC_PATHS).toContain("/api/health");
    expect(PUBLIC_PATHS).toContain("/login");
    // Страницы с данными открытыми не становятся
    expect(PUBLIC_PATHS).not.toContain("/");
    expect(PUBLIC_PATHS).not.toContain("/tasks");
    expect(PUBLIC_PATHS).not.toContain("/status");
  });
});
