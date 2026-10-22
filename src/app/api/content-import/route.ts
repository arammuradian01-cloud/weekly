import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { currentActor } from "@/lib/action-runner";
import { readSession } from "@/lib/auth";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { PACKAGE_MAX_BYTES, PackageError, parsePackage } from "@/lib/content-import/package";
import { IMPORT_ONLY, applyContentImport, canImportContent, previewContentImport } from "@/lib/content-import/service";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const SIGNED_OUT = "Вход больше не действует: войдите заново и загрузите пакет ещё раз";
const TOO_BIG = "Файл пакета больше 2 МБ: разделите его на части";

const answer = (status: number, error: string, problems?: string[]) => NextResponse.json({ ok: false, error, ...(problems ? { problems } : {}) }, { status, headers: NO_STORE });

/**
 * Импорт наполнения (этап 67). Тело: файл пакета JSON целиком. ?mode=preview только считает, что добавится,
 * обновится и пропустится; ?mode=apply загружает одной транзакцией. Владелец при личном входе в режиме управления.
 * Содержимое пакета в лог не пишется: в нём внутренние имена и цифры
 */
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && !sameSite(origin, request.url)) return answer(403, "Запрос с чужого сайта");
    if (!(await readSession())) return answer(401, SIGNED_OUT);
    const actor = await actorOrNull();
    if (!actor) return answer(401, SIGNED_OUT);
    if (!canImportContent(actor)) return answer(403, IMPORT_ONLY);
    const mode = new URL(request.url).searchParams.get("mode");
    if (mode !== "preview" && mode !== "apply") return answer(400, "Неизвестное действие: нужен предпросмотр или загрузка");
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > PACKAGE_MAX_BYTES) return answer(413, TOO_BIG);
    const text = await request.text();
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > PACKAGE_MAX_BYTES) return answer(413, TOO_BIG);
    const { pkg, problems } = parsePackage(text, bytes);
    if (problems.length) return answer(400, `В пакете ошибки: ${problems.length}. Исправьте их в файле, база не тронута`, problems.slice(0, 100));
    const value = mode === "preview" ? await previewContentImport(actor, pkg) : await applyContentImport(actor, pkg);
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

function sameSite(origin: string, url: string): boolean {
  if (origin === process.env.APP_URL?.replace(/\/+$/, "")) return true;
  try {
    return new URL(origin).host === new URL(url).host;
  } catch {
    return false;
  }
}
