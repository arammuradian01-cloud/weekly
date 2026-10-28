// Ответы обработчиков рынка в браузере (этап 62): загрузка пакета и данные для окна. Текст ошибки сервера (JSON
// {ok:false, error}) показывается как есть. Ответ не JSON разбирается по статусу: 401 или переход на экран входа:
// вход закончился; 413: файл слишком большой; остальное (сбой прокси, ошибка сервера страницей): общий текст.
// Этап 83: отказ по размеру от чужого прокси приходит не нашим ответом (не JSON), и текст для него свой:
// он подсказывает загрузить сжатый файл.
// Чистая функция над Response: её проверяют тесты без браузера.

export type MarketAnswerKind = "upload" | "data";

export const MARKET_ANSWER_TEXTS = {
  upload: {
    signedOut: "Вход закончился: обновите страницу, войдите и загрузите пакет снова",
    tooBig: "Файл больше 25 МБ: пакет рынка может быть не больше 25 МБ",
    proxyTooBig: "Сервер отклонил файл по размеру. Загрузите сжатый файл .json.gz",
    tooBigPacked: "Сжатый файл больше 25 МБ: столько пакет рынка весить не должен",
    wrongFile: "Нужен файл пакета рынка: .json или сжатый .json.gz",
    badGzip: "Сжатый файл не распаковывается: похоже, он повреждён. Соберите пакет заново и загрузите снова",
    failed: "Не получилось загрузить, попробуйте ещё раз",
  },
  data: {
    signedOut: "Вход закончился: обновите страницу и войдите снова",
    tooBig: "Не получилось получить данные рынка",
    proxyTooBig: "Не получилось получить данные рынка",
    tooBigPacked: "Не получилось получить данные рынка",
    wrongFile: "Не получилось получить данные рынка",
    badGzip: "Не получилось получить данные рынка",
    failed: "Не получилось получить данные рынка",
  },
} as const;

export type MarketAnswer<T> = { ok: true; value: T } | { ok: false; error: string };

/** Ответ обработчика: тело успешного ответа или понятный текст ошибки */
export async function readMarketAnswer<T>(res: Response, kind: MarketAnswerKind): Promise<MarketAnswer<T>> {
  const texts = MARKET_ANSWER_TEXTS[kind];
  // Сервер отправил на экран входа (proxy перенаправляет без входа), а не ответил сам
  if (res.redirected) return { ok: false, error: texts.signedOut };
  const json = (res.headers.get("content-type") ?? "").includes("application/json");
  const body = json ? ((await res.json().catch(() => null)) as Record<string, unknown> | null) : null;
  if (body && typeof body === "object") {
    if (res.ok && body.ok === true) return { ok: true, value: body as T };
    if (body.ok === false && typeof body.error === "string" && body.error.trim()) return { ok: false, error: body.error };
  }
  if (res.status === 401) return { ok: false, error: texts.signedOut };
  // Отказ по размеру нашим обработчиком приходит JSON выше; сюда попадает отказ прокси, его текст подсказывает сжатый файл
  if (res.status === 413) return { ok: false, error: texts.proxyTooBig };
  return { ok: false, error: texts.failed };
}
