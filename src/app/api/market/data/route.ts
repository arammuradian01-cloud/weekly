import { NextResponse } from "next/server";
import { requireContext } from "@/lib/auth";
import { canSeeMarket, MARKET_CLOSED_TEXT } from "@/lib/market/access";
import { etagMatches, marketMeta, marketPayload } from "@/lib/market/service";

export const dynamic = "force-dynamic";

/** Ответ с цифрами хранит только браузер человека и каждый раз сверяет отпечаток: пакет сменился, данные свежие */
const CACHE = { "Cache-Control": "private, no-cache", "X-Robots-Tag": "noindex, nofollow", Vary: "Cookie" };
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Данные рынка КАСКО и ОСАГО для окна дашборда (этап 62): код страницы и наборы. Доступ проверяется до чтения:
 * без доступа ответ 403 без цифр. Отпечаток по версии пакета: пока пакет тот же, браузеру хватает ответа 304
 */
export async function GET(request: Request) {
  const ctx = await requireContext();
  if (!(await canSeeMarket({ personId: ctx.person.id, via: ctx.via }))) return NextResponse.json({ ok: false, error: MARKET_CLOSED_TEXT }, { status: 403, headers: NO_STORE });
  const meta = await marketMeta();
  if (!meta) return NextResponse.json({ ok: false, error: "Пакет рынка ещё не загружен" }, { status: 404, headers: NO_STORE });
  if (etagMatches(request.headers.get("if-none-match"), meta.etag)) return new Response(null, { status: 304, headers: { ...CACHE, ETag: meta.etag } });
  const payload = await marketPayload();
  if (!payload) return NextResponse.json({ ok: false, error: "Пакет рынка ещё не загружен" }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ ok: true, version: payload.version, files: payload.files, datasets: payload.datasets }, { headers: { ...CACHE, ETag: payload.etag } });
}
