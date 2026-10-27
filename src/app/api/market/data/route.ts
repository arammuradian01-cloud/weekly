import { NextResponse } from "next/server";
import { requireContext } from "@/lib/auth";
import { canSeeMarket, MARKET_CLOSED_TEXT } from "@/lib/market/access";
import { marketDataBody, marketGzipBody } from "@/lib/market/service";
import { acceptsGzip, etagMatches, MARKET_CACHE_CONTROL, MARKET_VARY } from "@/lib/market/http";

export const dynamic = "force-dynamic";

/** Отказы (403, 404) браузер не хранит вовсе: право на раздел и наличие пакета меняются в любой момент */
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Данные рынка КАСКО и ОСАГО для окна дашборда (этап 62, сжатие и отпечаток версии на этапе 82). Код страницы и
 * наборы. Доступ проверяется до чтения: без доступа ответ 403 без цифр.
 *
 * Пакет весит мегабайты, поэтому ответ уходит сжатым gzip (сжатие считается один раз на версию пакета) и с
 * отпечатком ETag: браузер, у которого этот пакет уже есть, спрашивает сервер и получает короткий 304, а не
 * мегабайты заново. Отпечаток меняется с каждой загрузкой пакета. Ответ помечен private: он только для того, кто
 * вошёл, в общих кэшах его хранить нельзя. Готовый текст ответа сервер вдобавок держит в памяти (marketDataBody)
 */
export async function GET(request?: Request) {
  const ctx = await requireContext();
  if (!(await canSeeMarket({ personId: ctx.person.id, via: ctx.via, management: ctx.management?.role ?? null }))) return NextResponse.json({ ok: false, error: MARKET_CLOSED_TEXT }, { status: 403, headers: NO_STORE });
  const data = await marketDataBody();
  if (!data) return NextResponse.json({ ok: false, error: "Пакет рынка ещё не загружен" }, { status: 404, headers: NO_STORE });
  const headers: Record<string, string> = {
    "Cache-Control": MARKET_CACHE_CONTROL,
    Vary: MARKET_VARY,
    ETag: data.etag,
    "X-Robots-Tag": "noindex, nofollow",
  };
  // У браузера уже есть этот пакет: ответ без тела
  if (etagMatches(request?.headers.get("if-none-match") ?? null, data.etag)) return new Response(null, { status: 304, headers });
  headers["Content-Type"] = "application/json; charset=utf-8";
  if (acceptsGzip(request?.headers.get("accept-encoding") ?? null)) {
    const packed = marketGzipBody(data);
    return new Response(packed as unknown as BodyInit, { headers: { ...headers, "Content-Encoding": "gzip", "Content-Length": String(packed.byteLength) } });
  }
  return new Response(data.body, { headers });
}
