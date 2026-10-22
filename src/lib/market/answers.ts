// Ответы обработчиков рынка в браузере (этап 62): загрузка пакета и данные для окна. Текст ошибки сервера (JSON
// {ok:false, error}) показывается как есть. Ответ не JSON разбирается по статусу: 401 или переход на экран входа:
// вход закончился; 413: файл слишком большой; остальное (сбой прокси, ошибка сервера страницей): общий текст.
// Чистая функция над Response: её проверяют тесты без браузера.

export type MarketAnswerKind = "upload" | "data";

export const MARKET_ANSWER_TEXTS = {
  upload: {
    signedOut: "Вход закончился: обновите страницу, войдите и загрузите пакет снова",
    tooBig: "Файл больше 25 МБ: пакет рынка может быть не больше 25 МБ",
    failed: "Не получилось загрузить, попробуйте ещё раз",
  },
  data: {
    signedOut: "Вход закончился: обновите страницу и войдите снова",
    tooBig: "Не получилось получить данные рынка",
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
  if (res.status === 413) return { ok: false, error: texts.tooBig };
  return { ok: false, error: texts.failed };
}
