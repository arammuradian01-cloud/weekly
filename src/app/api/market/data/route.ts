import { NextResponse } from "next/server";
import { requireContext } from "@/lib/auth";
import { canSeeMarket, MARKET_CLOSED_TEXT } from "@/lib/market/access";
import { marketDataBody } from "@/lib/market/service";

export const dynamic = "force-dynamic";

/** Цифры рынка браузер не сохраняет ни в памяти, ни на диске: как и остальные ответы API, без кэша и отпечатков */
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Данные рынка КАСКО и ОСАГО для окна дашборда (этап 62): код страницы и наборы. Доступ проверяется до чтения:
 * без доступа ответ 403 без цифр. Ответ всегда полный (200), без ETag и 304: готовый текст ответа сервер держит в
 * памяти по версии пакета (marketDataBody), поэтому повторный запрос дешёвый
 */
export async function GET() {
  const ctx = await requireContext();
  if (!(await canSeeMarket({ personId: ctx.person.id, via: ctx.via, management: ctx.management?.role ?? null }))) return NextResponse.json({ ok: false, error: MARKET_CLOSED_TEXT }, { status: 403, headers: NO_STORE });
  const data = await marketDataBody();
  if (!data) return NextResponse.json({ ok: false, error: "Пакет рынка ещё не загружен" }, { status: 404, headers: NO_STORE });
  return new Response(data.body, { headers: { ...NO_STORE, "Content-Type": "application/json; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" } });
}
