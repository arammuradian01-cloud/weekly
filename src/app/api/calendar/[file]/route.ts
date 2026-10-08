import { calendarFile, feedByToken } from "@/lib/calendar/service";
import { clientIp } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Личный календарь сроков (этап 29). Открыт без входа: календари Google, Яндекс и Outlook забирают его по ссылке.
 * Доступ даёт только секретная часть адреса. Неверная ссылка и отключённая выглядят одинаково
 */
export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const ip = clientIp(request.headers);
  if (!rateLimit(`calendar:${ip}`, 120, 60_000)) {
    return new Response("Слишком много запросов. Попробуйте через минуту", { status: 429, headers: { "Retry-After": "60" } });
  }
  const { file } = await params;
  // Ссылка из букв, цифр, дефиса и подчёркивания: раскодировать нечего
  const token = file.replace(/\.ics$/i, "");
  const feed = await feedByToken(token);
  const common = { "Cache-Control": "private, no-cache", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };
  if (!feed) return new Response("Ссылка на календарь не найдена или отключена", { status: 404, headers: common });
  const base = (process.env.APP_URL || new URL(request.url).origin).replace(/\/+$/, "");
  const body = await calendarFile(feed.personId, feed.withTitles, base);
  return new Response(body, {
    headers: { ...common, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="weekly.ics"' },
  });
}
