import { checkHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

/**
 * Проверка для сервера и наблюдения: приложение живо и видит базу.
 * Этап 86: удачная проверка отмечается в базе, страница «Состояние» показывает её время. Сюда же ходит внешний
 * пинг из GitHub: ответ не 200 — владельцу уходит сообщение в Telegram
 */
export async function GET() {
  const result = await checkHealth();
  return Response.json(result, { status: result.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
