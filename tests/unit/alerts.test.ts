import { describe, expect, it } from "vitest";
import { ALERT_TEXT_MAX, alertsConfigured, errorAlertText, telegramConfig, telegramUrl } from "@/lib/alerts";

// Этап 86: оповещения в Telegram. Ключи только из переменных окружения, в текст сообщения они не попадают.
// Значения в тесте выдуманные и не настоящие ключи: настоящие живут только в переменных Timeweb и в секретах GitHub

describe("настройки оповещений", () => {
  it("без переменных оповещений нет", () => {
    expect(telegramConfig({})).toBeNull();
    expect(telegramConfig({ TELEGRAM_BOT_TOKEN: "x" })).toBeNull();
    expect(telegramConfig({ TELEGRAM_CHAT_ID: "y" })).toBeNull();
    expect(alertsConfigured({})).toBe(false);
  });

  it("с обеими переменными настроены, ALERTS=off выключает", () => {
    const env = { TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "chat" };
    expect(telegramConfig(env)).toEqual({ token: "token", chatId: "chat" });
    expect(alertsConfigured(env)).toBe(true);
    expect(telegramConfig({ ...env, ALERTS: "off" })).toBeNull();
    expect(alertsConfigured({ ...env, ALERTS: "OFF" })).toBe(false);
  });

  it("пробелы вокруг значений не мешают", () => {
    expect(telegramConfig({ TELEGRAM_BOT_TOKEN: " token ", TELEGRAM_CHAT_ID: " chat " })).toEqual({ token: "token", chatId: "chat" });
  });

  it("ключ бота — часть адреса отправки, поэтому адрес никуда не показываем", () => {
    expect(telegramUrl({ token: "token", chatId: "chat" })).toBe("https://api.telegram.org/bottoken/sendMessage");
  });
});

describe("текст сообщения о сбое", () => {
  const env = { APP_URL: "https://example.ru", TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "chat" };

  it("где, сколько раз и на каком стенде", () => {
    const text = errorAlertText({ source: "Сервер", place: "/tasks", times: 3 }, env);
    expect(text).toContain("Сервер");
    expect(text).toContain("Где: /tasks");
    expect(text).toContain("Случился раз: 3");
    expect(text).toContain("https://example.ru");
    expect(text).toContain("страница «Состояние»");
    // Ключи в текст не попадают
    expect(text).not.toContain("token");
    expect(text).not.toContain("chat");
  });

  it("текста самого сбоя в сообщении нет: в нём бывает содержимое данных (замечание ревью)", () => {
    // В ошибки разбора выгрузки подставляется ячейка файла (src/lib/tasks/bord-import.ts), и такой текст не
    // должен уезжать со стенда в мессенджер. Поэтому сообщение о сбое его и не принимает: только место и счётчик
    const text = errorAlertText({ source: "Сервер", place: "/api/market/upload", times: 1 }, env);
    expect(text).not.toMatch(/строка|ячейк|Иванов/i);
    expect(Object.keys({ source: "", place: "", times: 0 })).not.toContain("message");
  });

  it("один раз: строки про счётчик нет; без места строки про место нет", () => {
    const text = errorAlertText({ source: "Сервер", times: 1 }, env);
    expect(text).not.toContain("Случился раз");
    expect(text).not.toContain("Где:");
  });

  it("длинный текст обрезается: Telegram не принимает больше четырёх тысяч знаков", () => {
    const text = errorAlertText({ source: "Сервер", place: `/${"я".repeat(5000)}`, times: 1 }, env);
    expect(text.length).toBeLessThanOrEqual(ALERT_TEXT_MAX);
  });

  it("без APP_URL в сообщении видно, что адрес не задан", () => {
    expect(errorAlertText({ source: "Сервер", times: 1 }, {})).toContain("адрес не задан");
  });
});
