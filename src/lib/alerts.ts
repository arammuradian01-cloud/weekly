// Оповещения в Telegram (этап 86): сообщение владельцу, когда приложение сбоит.
//
// Ключ бота и номер разговора живут только в переменных окружения (TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID), в коде,
// тестах и документах их нет. Переменных нет — оповещения просто не уходят, остальное работает как обычно.
// Выключить при заданных переменных: ALERTS=off.
//
// Отсюда уходят сбои приложения (src/lib/errors.ts). Внешний пинг «приложение не отвечает» шлёт сообщение сам,
// из проверки в GitHub (.github/workflows/ping.yml): если упал сервер целиком, он сообщить о себе не может.

export type AlertEnv = { TELEGRAM_BOT_TOKEN?: string; TELEGRAM_CHAT_ID?: string; ALERTS?: string; APP_URL?: string };

export type TelegramConfig = { token: string; chatId: string };

/** Сколько ждём ответ Telegram: оповещение не должно задерживать ответ страницы */
export const ALERT_TIMEOUT_MS = 5_000;
/** Предел длины сообщения: Telegram не принимает больше 4096 знаков */
export const ALERT_TEXT_MAX = 3_000;

/** Настройки оповещений или null, если они не заданы или выключены */
export function telegramConfig(env: AlertEnv = process.env): TelegramConfig | null {
  if ((env.ALERTS ?? "").trim().toLowerCase() === "off") return null;
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const chatId = (env.TELEGRAM_CHAT_ID ?? "").trim();
  if (!token || !chatId) return null;
  return { token, chatId };
}

/** Настроены ли оповещения: для страницы «Состояние». Ни ключа, ни номера разговора наружу не отдаём */
export function alertsConfigured(env: AlertEnv = process.env): boolean {
  return telegramConfig(env) !== null;
}

/** Адрес отправки. Ключ бота — часть адреса, поэтому адрес в журнал и на экран не попадает */
export function telegramUrl(config: TelegramConfig): string {
  return `https://api.telegram.org/bot${config.token}/sendMessage`;
}

export type ErrorAlert = { source: string; message: string; place?: string | null; stack?: string | null; times: number };

/** Текст сообщения о сбое: что, где, сколько раз и на каком стенде */
export function errorAlertText(alert: ErrorAlert, env: AlertEnv = process.env): string {
  const where = (env.APP_URL ?? "").trim() || "адрес не задан";
  const lines = [
    `Weekly: сбой (${alert.source})`,
    alert.message,
    alert.place ? `Где: ${alert.place}` : null,
    alert.times > 1 ? `Случился раз: ${alert.times}` : null,
    `Стенд: ${where}`,
    "Подробности: страница «Состояние»",
  ].filter((x): x is string => !!x);
  const text = lines.join("\n");
  return text.length > ALERT_TEXT_MAX ? `${text.slice(0, ALERT_TEXT_MAX - 1)}…` : text;
}

/**
 * Отправка сообщения. Не бросает исключение и не ждёт долго: оповещение не должно ронять страницу.
 * true: Telegram принял сообщение
 */
export async function sendTelegram(text: string, env: AlertEnv = process.env): Promise<boolean> {
  const config = telegramConfig(env);
  if (!config || !text.trim()) return false;
  try {
    const response = await fetch(telegramUrl(config), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: config.chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    });
    // В журнал сервера только код ответа: в адресе отправки лежит ключ бота, его не пишем
    if (!response.ok) console.error("Оповещение в Telegram не ушло, код ответа", response.status);
    return response.ok;
  } catch (error) {
    console.error("Оповещение в Telegram не ушло", error instanceof Error ? error.message : error);
    return false;
  }
}

/** Оповещение о сбое приложения */
export function notifyError(alert: ErrorAlert, env: AlertEnv = process.env): Promise<boolean> {
  if (!telegramConfig(env)) return Promise.resolve(false);
  return sendTelegram(errorAlertText(alert, env), env);
}
