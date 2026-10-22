// Этап 62: ответы обработчиков рынка в браузере. Текст ошибки сервера показывается как есть, ответ не JSON
// разбирается по статусу: 401 и переход на экран входа: вход закончился, 413: файл слишком большой, остальное общий
// текст. Раньше любой ответ не JSON показывался как «Вход закончился»
import { describe, expect, it } from "vitest";
import { MARKET_ANSWER_TEXTS, readMarketAnswer } from "@/lib/market/answers";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (status: number) => new Response("<html><body>Ошибка</body></html>", { status, headers: { "content-type": "text/html" } });
const redirected = (res: Response) => Object.defineProperty(res, "redirected", { value: true });

describe("ответ загрузки пакета", () => {
  const read = (res: Response) => readMarketAnswer<{ value: { datasetsCount: number } }>(res, "upload");

  it("успех и ошибка проверки текстом сервера", async () => {
    expect(await read(json(200, { ok: true, value: { datasetsCount: 2 } }))).toEqual({ ok: true, value: { ok: true, value: { datasetsCount: 2 } } });
    expect(await read(json(400, { ok: false, error: "В пакете нет библиотеки графиков d3.min.js" }))).toEqual({ ok: false, error: "В пакете нет библиотеки графиков d3.min.js" });
    expect(await read(json(401, { ok: false, error: MARKET_ANSWER_TEXTS.upload.signedOut }))).toEqual({ ok: false, error: MARKET_ANSWER_TEXTS.upload.signedOut });
  });

  it("ответ не JSON по статусу: 401 вход, 413 размер, остальное общий текст", async () => {
    expect(await read(html(401))).toEqual({ ok: false, error: "Вход закончился: обновите страницу, войдите и загрузите пакет снова" });
    expect(await read(html(413))).toEqual({ ok: false, error: "Файл больше 25 МБ: пакет рынка может быть не больше 25 МБ" });
    expect(await read(html(502))).toEqual({ ok: false, error: "Не получилось загрузить, попробуйте ещё раз" });
    expect(await read(html(500))).toEqual({ ok: false, error: "Не получилось загрузить, попробуйте ещё раз" });
    // Ответ 200, но не JSON (чужая страница) и битый JSON: тоже общий текст, а не «Вход закончился»
    expect(await read(html(200))).toEqual({ ok: false, error: "Не получилось загрузить, попробуйте ещё раз" });
    expect(await read(new Response("{", { status: 200, headers: { "content-type": "application/json" } }))).toEqual({ ok: false, error: "Не получилось загрузить, попробуйте ещё раз" });
    // Перешли на экран входа
    expect(await read(redirected(html(200)))).toEqual({ ok: false, error: MARKET_ANSWER_TEXTS.upload.signedOut });
  });
});

describe("ответ с данными рынка", () => {
  const read = (res: Response) => readMarketAnswer<{ version: number }>(res, "data");

  it("успех, нет доступа текстом сервера, по статусу и общий текст", async () => {
    expect(await read(json(200, { ok: true, version: 3 }))).toEqual({ ok: true, value: { ok: true, version: 3 } });
    expect(await read(json(403, { ok: false, error: "Раздел открыт отдельным людям, доступ даёт владелец." }))).toEqual({ ok: false, error: "Раздел открыт отдельным людям, доступ даёт владелец." });
    expect(await read(redirected(html(200)))).toEqual({ ok: false, error: "Вход закончился: обновите страницу и войдите снова" });
    expect(await read(html(401))).toEqual({ ok: false, error: "Вход закончился: обновите страницу и войдите снова" });
    expect(await read(html(504))).toEqual({ ok: false, error: "Не получилось получить данные рынка" });
    expect(await read(html(200))).toEqual({ ok: false, error: "Не получилось получить данные рынка" });
  });
});
