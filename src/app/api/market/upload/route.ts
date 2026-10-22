import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { currentActor } from "@/lib/action-runner";
import { readSession } from "@/lib/auth";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { canUploadMarket } from "@/lib/market/access";
import { MARKET_MAX_BYTES, MarketBundleError, parseBundle } from "@/lib/market/bundle";
import { MARKET_UPLOAD_ONLY, uploadMarketBundle } from "@/lib/market/service";
import { MARKET_ANSWER_TEXTS } from "@/lib/market/answers";

export const dynamic = "force-dynamic";

const MARKET_TOO_BIG = MARKET_ANSWER_TEXTS.upload.tooBig;
const MARKET_SIGNED_OUT = MARKET_ANSWER_TEXTS.upload.signedOut;
const NO_STORE = { "Cache-Control": "no-store" };

const answer = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });

/**
 * Загрузка пакета рынка КАСКО и ОСАГО (этап 62). Тело запроса: файл пакета JSON целиком, поэтому обработчик, а не
 * серверное действие (у того предел 1 МБ). Этот путь идёт мимо proxy (src/proxy.ts): иначе Next прочитал бы всё тело
 * в память до вызова обработчика. Поэтому до чтения тела обработчик сам проверяет адрес страницы (Origin), вход
 * (подпись cookie сессии, затем профиль и устройство в базе), права (владелец при личном входе) и размер по
 * Content-Length; тело читается потоком и обрывается на 25 МБ. Пакет заменяет прежний одной транзакцией.
 * Содержимое файла в лог не пишется: в нём цифры рынка
 */
export async function POST(request: Request) {
  try {
    // Запрос только со страницы ресурса: чужой сайт не отправит файл от имени вошедшего человека
    const origin = request.headers.get("origin");
    if (origin && !sameSite(origin, request.url)) return answer(403, "Запрос с чужого сайта");
    // Вход: без действующей cookie сразу ответ, а не перенаправление на вход (браузер повторил бы POST с файлом)
    if (!(await readSession())) return answer(401, MARKET_SIGNED_OUT);
    const actor = await actorOrNull();
    if (!actor) return answer(401, MARKET_SIGNED_OUT);
    if (!canUploadMarket(actor)) return answer(403, MARKET_UPLOAD_ONLY);
    // Размер по заголовку до чтения тела, и ещё раз по ходу чтения: большой файл не держим в памяти
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MARKET_MAX_BYTES) return answer(413, MARKET_TOO_BIG);
    const body = await readBody(request, MARKET_MAX_BYTES);
    if (!body) return answer(413, MARKET_TOO_BIG);
    const bundle = parseBundle(body.text, body.bytes);
    const meta = await uploadMarketBundle(actor, bundle, body.bytes);
    return NextResponse.json({ ok: true, value: { datasetsCount: meta.datasetsCount, rowsTotal: meta.rowsTotal, uploadedAt: meta.uploadedAt, version: meta.version } }, { headers: NO_STORE });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof MarketBundleError || error instanceof TaskRuleError) return answer(400, error.message);
    // Только вид ошибки: в тексте ошибки базы могут оказаться строки пакета
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : error instanceof Error ? error.name : "ошибка";
    console.error("Пакет рынка: загрузка не прошла", code);
    return answer(500, "Не получилось загрузить пакет. Обновите страницу и попробуйте ещё раз");
  }
}

/** Человек из сессии или null, если вход больше не действует (устройство отозвано, профиль выключен и т.п.) */
async function actorOrNull(): Promise<Actor | null> {
  try {
    return await currentActor();
  } catch (error) {
    if (isRedirectError(error)) return null;
    throw error;
  }
}

/** Тело запроса с пределом размера: null, если файл больше предела. Чтение обрывается, как только предел превышен */
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
