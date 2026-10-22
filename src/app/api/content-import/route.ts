import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { currentActor } from "@/lib/action-runner";
import { readSession } from "@/lib/auth";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { isIsoDate } from "@/lib/tasks/dates";
import { PACKAGE_MAX_BYTES, PACKAGE_MAX_LABEL, PackageError, parsePackage } from "@/lib/content-import/package";
import { IMPORT_ONLY, applyContentImport, canImportContent, previewContentImport } from "@/lib/content-import/service";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const CONTENT_SIGNED_OUT = "Вход больше не действует: войдите заново и загрузите пакет ещё раз";
const TOO_BIG = `Файл пакета больше ${PACKAGE_MAX_LABEL}: разделите его на части`;

const answer = (status: number, error: string, problems?: string[]) => NextResponse.json({ ok: false, error, ...(problems ? { problems } : {}) }, { status, headers: NO_STORE });

/**
 * Импорт наполнения (этап 67). Тело: файл пакета JSON целиком. ?mode=preview только считает, что добавится,
 * обновится и пропустится; ?mode=apply загружает одной транзакцией. &duplicates=1: загружать все вероятные дубли,
 * &dup=task/ключ,decision/ключ: только выбранные. &due=ГГГГ-ММ-ДД: срок для открытых задач, у которых срок в пакете уже
 * прошёл (по умолчанию через две недели). Владелец при личном входе в режиме управления.
 *
 * Путь идёт мимо proxy (src/proxy.ts), как загрузка пакета рынка: иначе Next прочитал бы всё тело в память до вызова
 * обработчика. Поэтому до чтения тела обработчик сам проверяет адрес страницы (Origin), вход (подпись cookie, затем
 * профиль и устройство в базе; без входа ответ 401 текстом, а не перенаправление), права и размер по Content-Length;
 * тело читается потоком и обрывается на пределе. Содержимое пакета в лог не пишется: в нём внутренние имена и цифры
 */
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && !sameSite(origin, request.url)) return answer(403, "Запрос с чужого сайта");
    if (!(await readSession())) return answer(401, CONTENT_SIGNED_OUT);
    const actor = await actorOrNull();
    if (!actor) return answer(401, CONTENT_SIGNED_OUT);
    if (!canImportContent(actor)) return answer(403, IMPORT_ONLY);
    const params = new URL(request.url).searchParams;
    const mode = params.get("mode");
    if (mode !== "preview" && mode !== "apply") return answer(400, "Неизвестное действие: нужен предпросмотр или загрузка");
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > PACKAGE_MAX_BYTES) return answer(413, TOO_BIG);
    const body = await readBody(request, PACKAGE_MAX_BYTES);
    if (!body) return answer(413, TOO_BIG);
    const { pkg, problems } = parsePackage(body.text, body.bytes);
    if (problems.length) return answer(400, `В пакете ошибки: ${problems.length}. Исправьте их в файле, база не тронута`, problems.slice(0, 100));
    const due = params.get("due");
    if (due && !isIsoDate(due)) return answer(400, "Срок для задач без актуального срока: дата в виде ГГГГ-ММ-ДД");
    const duplicateKeys = (params.get("dup") ?? "")
      .split(",")
      .filter((id) => /^(task|decision)\/[A-Za-z0-9._:-]{3,120}$/.test(id))
      .slice(0, 2000);
    const opts = { duplicates: params.get("duplicates") === "1", duplicateKeys, ...(due ? { staleDue: due } : {}) };
    const value = mode === "preview" ? await previewContentImport(actor, pkg, opts) : await applyContentImport(actor, pkg, opts);
    return NextResponse.json({ ok: true, value }, { headers: NO_STORE });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof PackageError || error instanceof TaskRuleError) return answer(400, error.message);
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : error instanceof Error ? error.name : "ошибка";
    console.error("Импорт наполнения: не прошёл", code);
    return answer(500, "Не получилось загрузить пакет. Обновите страницу и попробуйте ещё раз");
  }
}

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
