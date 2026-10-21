import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { currentActor } from "@/lib/action-runner";
import { TaskRuleError } from "@/lib/tasks/service";
import { canUploadMarket } from "@/lib/market/access";
import { MARKET_MAX_BYTES, MarketBundleError, parseBundle } from "@/lib/market/bundle";
import { MARKET_UPLOAD_ONLY, uploadMarketBundle } from "@/lib/market/service";

export const dynamic = "force-dynamic";

const TOO_BIG = "Файл больше 25 МБ: пакет рынка может быть не больше 25 МБ";
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Загрузка пакета рынка КАСКО и ОСАГО (этап 62). Тело запроса: файл пакета JSON целиком, поэтому обработчик, а не
 * серверное действие (у того предел 1 МБ). Права проверяются до чтения тела: владелец при личном входе. Пакет
 * заменяет прежний одной транзакцией. Содержимое файла в лог не пишется: в нём цифры рынка
 */
export async function POST(request: Request) {
  try {
    // Запрос только со страницы ресурса: чужой сайт не отправит файл от имени вошедшего человека
    const origin = request.headers.get("origin");
    if (origin && !sameSite(origin, request.url)) return NextResponse.json({ ok: false, error: "Запрос с чужого сайта" }, { status: 403, headers: NO_STORE });
    const actor = await currentActor();
    if (!canUploadMarket(actor)) return NextResponse.json({ ok: false, error: MARKET_UPLOAD_ONLY }, { status: 403, headers: NO_STORE });
    // Размер по заголовку до чтения тела, и ещё раз по ходу чтения: большой файл не держим в памяти
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MARKET_MAX_BYTES) return NextResponse.json({ ok: false, error: TOO_BIG }, { status: 413, headers: NO_STORE });
    const body = await readBody(request, MARKET_MAX_BYTES);
    if (!body) return NextResponse.json({ ok: false, error: TOO_BIG }, { status: 413, headers: NO_STORE });
    const bundle = parseBundle(body.text, body.bytes);
    const meta = await uploadMarketBundle(actor, bundle, body.bytes);
    return NextResponse.json({ ok: true, value: { datasetsCount: meta.datasetsCount, rowsTotal: meta.rowsTotal, uploadedAt: meta.uploadedAt, version: meta.version } }, { headers: NO_STORE });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof MarketBundleError || error instanceof TaskRuleError) return NextResponse.json({ ok: false, error: error.message }, { status: 400, headers: NO_STORE });
    // Только вид ошибки: в тексте ошибки базы могут оказаться строки пакета
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : error instanceof Error ? error.name : "ошибка";
    console.error("Пакет рынка: загрузка не прошла", code);
    return NextResponse.json({ ok: false, error: "Не получилось загрузить пакет. Обновите страницу и попробуйте ещё раз" }, { status: 500, headers: NO_STORE });
  }
}

/** Тело запроса с пределом размера: null, если файл больше предела */
async function readBody(request: Request, limit: number): Promise<{ text: string; bytes: number } | null> {
  const reader = request.body?.getReader();
  if (!reader) return { text: "", bytes: 0 };
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(bytes);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return { text: new TextDecoder("utf-8").decode(all), bytes };
}

function sameSite(origin: string, url: string): boolean {
  if (origin === process.env.APP_URL?.replace(/\/+$/, "")) return true;
  try {
    return new URL(origin).host === new URL(url).host;
  } catch {
    return false;
  }
}
