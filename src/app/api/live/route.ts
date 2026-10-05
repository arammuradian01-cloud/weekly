export const dynamic = "force-dynamic";

/**
 * Проверка живости для хостинга (путь проверки состояния в App Platform).
 * Не зависит от базы: если база ненадолго недоступна, перезапуск приложения не поможет.
 * Состояние базы показывает /api/health.
 */
export function GET() {
  return Response.json({ ok: true });
}
