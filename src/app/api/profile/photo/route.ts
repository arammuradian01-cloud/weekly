import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { sameSiteOrigin } from "@/lib/app-url";
import { writingActor } from "@/lib/action-runner";
import { ViewAsReadOnlyError } from "@/lib/view-as";
import { readSession } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { TaskRuleError } from "@/lib/rule-error";
import type { Actor } from "@/lib/tasks/service";
import { AVATAR_MAX_BYTES, AvatarError, PROFILE_TEXTS } from "@/lib/profile/rules";
import { profileTarget, savePhoto } from "@/lib/profile/service";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
/** Загрузок фото одного человека за 10 минут: обработка картинки нагружает маленький сервер */
const UPLOADS_PER_WINDOW = 20;
const WINDOW_MS = 10 * 60 * 1000;

const answer = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });

/**
 * Фото профиля (этап 80). Тело запроса: сам файл картинки, поэтому обработчик, а не серверное действие (у того предел
 * 1 МБ, а снимок с телефона бывает до 10 МБ). ?person=<короткое имя>: чьё фото (владелец в режиме управления), без
 * него своё. Путь идёт мимо proxy (src/proxy.ts), как загрузки этапов 62 и 67: иначе Next прочитал бы всё тело в
 * память до вызова обработчика. Поэтому до чтения тела обработчик сам проверяет адрес страницы (Origin), вход (подпись
 * cookie сессии, затем профиль и устройство в базе; в режиме «Смотреть как» отказ), права и размер по Content-Length;
 * тело читается потоком и обрывается на 10 МБ. Тип файла проверяется по содержимому, не по имени и не по заголовку.
 * Картинка в лог не пишется
 */
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && !sameSiteOrigin(origin, request)) return answer(403, "Запрос с чужого сайта");
    // Без действующей cookie ответ сразу, а не перенаправление на вход: браузер повторил бы POST с файлом
    if (!(await readSession())) return answer(401, PROFILE_TEXTS.signedOut);
    const actor = await actorOrNull();
    if (!actor) return answer(401, PROFILE_TEXTS.signedOut);
    const slug = new URL(request.url).searchParams.get("person");
    // Права до чтения тела: по общему логину и чужое фото без режима управления владельца отказ сразу
    try {
      await profileTarget(actor, slug);
    } catch (error) {
      if (error instanceof TaskRuleError) return answer(error.message === PROFILE_TEXTS.noPerson ? 404 : 403, error.message);
      throw error;
    }
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > AVATAR_MAX_BYTES) return answer(413, PROFILE_TEXTS.tooBig);
    if (!rateLimit(`avatar-upload:${actor.personId}`, UPLOADS_PER_WINDOW, WINDOW_MS)) return answer(429, PROFILE_TEXTS.tooMany);
    const body = await readBytes(request, AVATAR_MAX_BYTES);
    if (!body) return answer(413, PROFILE_TEXTS.tooBig);
    if (!body.byteLength) return answer(400, PROFILE_TEXTS.empty);
    const { version } = await savePhoto(actor, slug, body);
    return NextResponse.json({ ok: true, value: { version } }, { headers: NO_STORE });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ViewAsReadOnlyError) return answer(403, error.message);
    if (error instanceof AvatarError) return answer(415, error.message);
    if (error instanceof TaskRuleError) return answer(400, error.message);
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : error instanceof Error ? error.name : "ошибка";
    console.error("Фото профиля: загрузка не прошла", code);
    return answer(500, PROFILE_TEXTS.failed);
  }
}

/** Человек из сессии или null, если вход больше не действует. В режиме «Смотреть как» отказ до чтения тела (этап 63) */
async function actorOrNull(): Promise<Actor | null> {
  try {
    return await writingActor();
  } catch (error) {
    if (isRedirectError(error)) return null;
    throw error;
  }
}

/** Тело запроса с пределом размера: null, если файл больше предела. Чтение обрывается, как только предел превышен */
async function readBytes(request: Request, limit: number): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
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
  return all;
}
