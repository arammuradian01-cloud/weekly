import { NextResponse } from "next/server";
import { requireContext } from "@/lib/auth";
import { canSeeMarket, MARKET_CLOSED_TEXT } from "@/lib/market/access";
import { marketDataBody, marketGzipBody } from "@/lib/market/service";
import { acceptsGzip, MARKET_VARY } from "@/lib/market/http";

export const dynamic = "force-dynamic";

/** Цифры рынка браузер не сохраняет ни в памяти, ни на диске: как и остальные ответы API, без кэша и отпечатков */
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Данные рынка КАСКО и ОСАГО для окна дашборда (этап 62, сжатие на этапе 82). Код страницы и наборы. Доступ
 * проверяется до чтения: без доступа ответ 403 без цифр.
 *
 * Пакет весит мегабайты, поэтому ответ уходит сжатым gzip: сжатие считается один раз на версию пакета и лежит в
 * памяти рядом с готовым телом. Отпечатков и ответов 304 нет намеренно: раздел открыт в том числе по общему логину,
 * и на общем устройстве пакет осел бы в дисковом кэше профиля и остался там после выхода. Ответ всегда полный
 * и всегда no-store
 */
export async function GET(request?: Request) {
  const ctx = await requireContext();
  if (!(await canSeeMarket({ personId: ctx.person.id, via: ctx.via, management: ctx.management?.role ?? null }))) return NextResponse.json({ ok: false, error: MARKET_CLOSED_TEXT }, { status: 403, headers: NO_STORE });
  const data = await marketDataBody();
  if (!data) return NextResponse.json({ ok: false, error: "Пакет рынка ещё не загружен" }, { status: 404, headers: NO_STORE });
  const headers: Record<string, string> = {
    ...NO_STORE,
    Vary: MARKET_VARY,
    "Content-Type": "application/json; charset=utf-8",
    "X-Robots-Tag": "noindex, nofollow",
  };
  const packed = acceptsGzip(request?.headers.get("accept-encoding") ?? null) ? await marketGzipBody(data) : null;
  if (packed) return new Response(packed as unknown as BodyInit, { headers: { ...headers, "Content-Encoding": "gzip", "Content-Length": String(packed.byteLength) } });
  return new Response(data.body as unknown as BodyInit, { headers: { ...headers, "Content-Length": String(data.body.byteLength) } });
}
