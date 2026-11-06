import { describe, expect, it } from "vitest";
import { MESSAGE_MAX, NOTIFY_REPEAT_MS, REPORT_BODY_MAX, fingerprintOf, normalizeError, parseErrorReport, pathOf, serverNoise, shortText, shouldNotify } from "@/lib/errors";

// Этап 86: разбор сообщений о сбоях. Браузер, жалоба политики по-старому и по Reporting API

describe("короткие строки", () => {
  it("переводы строк и лишние пробелы убираются, длинное обрезается", () => {
    expect(shortText("  две\n\nстроки  ", 100)).toBe("две строки");
    expect(shortText("", 10)).toBe("");
    expect(shortText(null, 10)).toBe("");
    expect(shortText("а".repeat(50), 10)).toHaveLength(10);
    expect(shortText("а".repeat(50), 10).endsWith("…")).toBe(true);
  });
});

describe("путь из адреса", () => {
  it("остаётся только путь, без адреса и параметров", () => {
    expect(pathOf("https://example.ru/tasks?team=top")).toBe("/tasks");
    expect(pathOf("/weekly?week=2026-10-26")).toBe("/weekly");
    // Запросы Next несут случайную метку в адресе: без обрезки у каждого был бы свой отпечаток
    expect(pathOf("/weekly/submit?_rsc=tXyZJ52UQVBCVsD3")).toBe("/weekly/submit");
    expect(pathOf("https://example.ru")).toBe("/");
    expect(pathOf("")).toBeNull();
    expect(pathOf(undefined)).toBeNull();
  });
});

describe("шум сервера", () => {
  it("оборванный поток ответа не сбой: нашли сквозные тесты, в список он не попадает", () => {
    expect(serverNoise("The destination stream closed early.")).toBe(true);
    expect(serverNoise("Error: The destination stream closed early. (render)")).toBe(true);
  });

  it("обрывы связи и таймауты это настоящие аварии, глушить их нельзя (замечание ревью)", () => {
    // Управляемая база рвёт соединения, а SELECT 1 в /api/health проходит: без этих записей вышло бы
    // «база отвечает, сбоев нет», пока люди получают пятисотые
    expect(serverNoise("read ECONNRESET")).toBe(false);
    expect(serverNoise("write EPIPE")).toBe(false);
    // Свои таймауты (AbortSignal.timeout к Google-таблице, почте, лентам) тоже должны быть видны
    expect(serverNoise("AbortError: The operation was aborted due to timeout")).toBe(false);
    expect(serverNoise("Response aborted")).toBe(false);
    // И обычный сбой базы
    expect(serverNoise("current transaction is aborted, commands ignored until end of transaction block")).toBe(false);
    expect(serverNoise("Нет связи с базой")).toBe(false);
    expect(serverNoise("")).toBe(false);
    expect(serverNoise(undefined)).toBe(false);
  });
});

describe("о чём оповещаем в Telegram", () => {
  const now = new Date("2026-11-02T10:00:00Z");

  it("только о сбоях сервера: открытый обработчик не должен писать владельцу", () => {
    // Сбой браузера и жалобу политики присылает кто угодно из интернета, без входа и с любым текстом
    expect(shouldNotify("BROWSER", null, now)).toBe(false);
    expect(shouldNotify("CSP", null, now)).toBe(false);
    expect(shouldNotify("SERVER", null, now)).toBe(true);
  });

  it("об одном и том же сбое не чаще раза в час", () => {
    const halfHour = new Date(now.getTime() - 30 * 60_000);
    const twoHours = new Date(now.getTime() - 2 * 60 * 60_000);
    expect(shouldNotify("SERVER", halfHour, now)).toBe(false);
    expect(shouldNotify("SERVER", twoHours, now)).toBe(true);
    expect(shouldNotify("SERVER", new Date(now.getTime() - NOTIFY_REPEAT_MS), now)).toBe(true);
  });
});

describe("отпечаток", () => {
  it("один сбой с разными числами складывается в одну запись", () => {
    const a = fingerprintOf({ source: "SERVER", message: "Задача 412 не найдена", place: "/tasks/412" });
    const b = fingerprintOf({ source: "SERVER", message: "Задача 907 не найдена", place: "/tasks/907" });
    expect(a).toBe(b);
  });

  it("разные сбои, разные места и разные источники не складываются", () => {
    const base = { source: "SERVER" as const, message: "Нет связи с базой", place: "/" };
    expect(fingerprintOf(base)).not.toBe(fingerprintOf({ ...base, message: "Нет связи с Google" }));
    expect(fingerprintOf(base)).not.toBe(fingerprintOf({ ...base, place: "/weekly" }));
    expect(fingerprintOf(base)).not.toBe(fingerprintOf({ ...base, source: "BROWSER" }));
  });
});

describe("подготовка записи", () => {
  it("пустое сообщение не записывается", () => {
    expect(normalizeError({ source: "BROWSER", message: "   " })).toBeNull();
  });

  it("длинное сообщение обрезается, пустые место и стек становятся пустыми", () => {
    const ready = normalizeError({ source: "SERVER", message: "я".repeat(MESSAGE_MAX + 100), place: "", stack: " " })!;
    expect(ready.message.length).toBe(MESSAGE_MAX);
    expect(ready.place).toBeNull();
    expect(ready.stack).toBeNull();
  });
});

describe("сообщение из браузера", () => {
  it("текст, путь и стек", () => {
    const [one] = parseErrorReport("application/json", JSON.stringify({ message: "Не удалось сохранить", place: "/weekly?week=1", stack: "app.js:12" }));
    expect(one).toEqual({ source: "BROWSER", message: "Не удалось сохранить", place: "/weekly", stack: "app.js:12" });
  });

  it("битое тело, чужое тело и пустое сообщение дают пустой список", () => {
    expect(parseErrorReport("application/json", "не json")).toEqual([]);
    expect(parseErrorReport("application/json", JSON.stringify([1, 2, 3]))).toEqual([]);
    expect(parseErrorReport("application/json", JSON.stringify({ message: "" }))).toEqual([]);
    expect(parseErrorReport("application/json", JSON.stringify("строка"))).toEqual([]);
  });

  it("слишком длинное тело не разбирается", () => {
    const big = JSON.stringify({ message: "а".repeat(REPORT_BODY_MAX) });
    expect(parseErrorReport("application/json", big)).toEqual([]);
  });
});

describe("жалоба политики", () => {
  it("по-старому: что заблокировано и на какой странице", () => {
    const body = JSON.stringify({
      "csp-report": {
        "document-uri": "https://example.ru/tasks",
        "effective-directive": "script-src-elem",
        "blocked-uri": "inline",
        "source-file": "https://example.ru/tasks",
        "line-number": 42,
      },
    });
    const [one] = parseErrorReport("application/csp-report", body);
    expect(one.source).toBe("CSP");
    expect(one.message).toBe("script-src-elem заблокировал inline");
    expect(one.place).toBe("/tasks");
    expect(one.stack).toContain(":42");
  });

  it("по Reporting API: список, берутся только жалобы политики", () => {
    const body = JSON.stringify([
      { type: "csp-violation", url: "https://example.ru/weekly", body: { effectiveDirective: "font-src", blockedURL: "https://fonts.example/x.woff2" } },
      { type: "deprecation", url: "https://example.ru/weekly", body: { id: "старое" } },
    ]);
    const reports = parseErrorReport("application/reports+json", body);
    expect(reports).toHaveLength(1);
    expect(reports[0].message).toContain("font-src заблокировал");
    expect(reports[0].place).toBe("/weekly");
  });

  it("жалобы расширений браузера не записываются", () => {
    const body = JSON.stringify({ "csp-report": { "document-uri": "https://example.ru/", "effective-directive": "script-src", "blocked-uri": "chrome-extension://abc/inject.js" } });
    expect(parseErrorReport("application/csp-report", body)).toEqual([]);
  });

  it("тело с типом жалобы, но без жалобы внутри: записывать нечего", () => {
    expect(parseErrorReport("application/csp-report", JSON.stringify({ message: "привет" }))).toEqual([]);
  });

  it("без директивы в жалобе пишется default-src, без адреса — встроенный код", () => {
    const [one] = parseErrorReport("application/csp-report", JSON.stringify({ "csp-report": { "document-uri": "https://example.ru/" } }));
    expect(one.message).toBe("default-src заблокировал встроенный код");
  });
});
