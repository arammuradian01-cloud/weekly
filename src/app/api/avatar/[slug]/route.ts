import { unstable_rethrow } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { readSession, requireContext } from "@/lib/auth";
import { PROFILE_TEXTS } from "@/lib/profile/rules";
import { avatarImage } from "@/lib/profile/service";

export const dynamic = "force-dynamic";

const TEXT = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
const refuse = (status: number, text: string) => new Response(text, { status, headers: TEXT });

/**
 * Фото профиля (этап 80): /api/avatar/<короткое имя>?v=<версия>[&size=64]. Только тем, кто вошёл, любым способом
 * (личный вход или общий логин с выбранным профилем); без входа отказ 401 текстом, а не переход на экран входа: путь
 * идёт мимо proxy (src/proxy.ts), вход проверяется здесь. Адрес с текущей версией браузер держит год без повторных
 * запросов (private: только в своём браузере, не в общих кэшах): новая загрузка или «Убрать фото» меняют версию, а
 * с ней адрес. Адрес без версии или со старой версией отдаёт текущее фото с проверкой по ETag при каждом показе.
 * Картинка уже обработана при загрузке: квадрат WebP без метаданных
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    if (!(await readSession())) return refuse(401, PROFILE_TEXTS.avatarSignedOut);
    try {
      await requireContext();
    } catch (error) {
      // Вход завершён, профиль выключен или не выбран: отказ, а не переход
      if (isRedirectError(error)) return refuse(401, PROFILE_TEXTS.avatarSignedOut);
      throw error;
    }
    const { slug } = await params;
    const url = new URL(request.url);
    const size = url.searchParams.get("size") === "64" ? "small" : "large";
    // Короткие имена латиницей: раскодировать нечего
    const image = await avatarImage(slug, size);
    if (!image) return refuse(404, PROFILE_TEXTS.avatarMissing);
    const etag = `"${image.personId.slice(-8)}-${image.version}-${size === "small" ? 64 : 256}"`;
    const current = url.searchParams.get("v") === String(image.version);
    const headers = {
      "Content-Type": "image/webp",
      "Cache-Control": current ? "private, max-age=31536000, immutable" : "private, no-cache",
      ETag: etag,
      "Content-Disposition": "inline",
    };
    const match = request.headers.get("if-none-match");
    if (match && match.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) return new Response(null, { status: 304, headers });
    return new Response(image.data as Uint8Array<ArrayBuffer>, { headers: { ...headers, "Content-Length": String(image.data.byteLength) } });
  } catch (error) {
    unstable_rethrow(error);
    console.error("Фото профиля: отдача не прошла", error instanceof Error ? error.name : "ошибка");
    return refuse(500, "Не получилось показать фото");
  }
}
