// Личный вход (этап 9): имя устройства, отпечаток ссылки, сессия с устройством
import { describe, expect, it } from "vitest";
import { deviceLabel } from "@/lib/login/device-label";
import { signSession, verifySession } from "@/lib/session";
import { hashToken, linkUrl, newToken } from "@/lib/login/service";
import { mailConfigured } from "@/lib/mail";

const secret = "test-secret-0123456789-0123456789-abcdef";

describe("имя устройства", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36", "Chrome, Windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", "Safari, Mac"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Safari, iPhone"],
    ["Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 YaBrowser/25.8 Mobile Safari/537.36", "Яндекс Браузер, Android"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0", "Edge, Windows"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0", "Firefox, Linux"],
  ])("%s", (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });

  it("без заголовка: неизвестное устройство", () => {
    expect(deviceLabel(null)).toBe("Неизвестное устройство");
    expect(deviceLabel("curl/8.0")).toBe("Неизвестное устройство");
  });
});

describe("ссылка для входа", () => {
  it("каждый раз новая и длинная, в базе только отпечаток", () => {
    const a = newToken();
    const b = newToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a);
  });

  it("адрес собирается без двойной косой черты", () => {
    expect(linkUrl("https://weekly.example.ru/", "abc-_")).toBe("https://weekly.example.ru/login/link?t=abc-_");
    expect(linkUrl("https://weekly.example.ru", "x", "/manage/confirm")).toBe("https://weekly.example.ru/manage/confirm?t=x");
  });
});

describe("сессия личного входа", () => {
  it("устройство и способ входа переживают подпись, чужой способ отбрасывается", async () => {
    const token = await signSession({ epoch: 1, personId: "p1", sid: "d1", via: "INVITE" }, secret);
    expect(await verifySession(token, secret)).toEqual({ epoch: 1, personId: "p1", sid: "d1", via: "INVITE" });
    const odd = await signSession({ epoch: 1, personId: "p1", via: "ROOT" as never }, secret);
    expect(await verifySession(odd, secret)).toEqual({ epoch: 1, personId: "p1" });
  });
});

describe("почта", () => {
  it("настроена, только когда заданы и сервер, и отправитель", () => {
    expect(mailConfigured({})).toBe(false);
    expect(mailConfigured({ SMTP_URL: "smtps://u:p@smtp.example.ru:465" })).toBe(false);
    expect(mailConfigured({ SMTP_URL: "smtps://u:p@smtp.example.ru:465", MAIL_FROM: "weekly@example.ru" })).toBe(true);
    expect(mailConfigured({ MAIL_TRANSPORT: "log" })).toBe(true);
  });
});
