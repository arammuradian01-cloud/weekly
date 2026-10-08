import { calendarFile, feedByToken } from "@/lib/calendar/service";
import { clientIp } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Ответ не сохраняется ни в браузере, ни в промежуточных кэшах: в нём личные сроки */
const COMMON = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };
/** Неверных ссылок с одного адреса в минуту */
const MISSES_PER_MINUTE = 30;
/** Загрузок одной ссылки в минуту: календари забирают её раз в час, больше похоже на сбой или перебор */
const FETCHES_PER_MINUTE = 30;

const tooMany = () => new Response("Слишком много запросов. Попробуйте через минуту", { status: 429, headers: { ...COMMON, "Retry-After": "60" } });

/**
 * Личный календарь сроков (этап 29). Открыт без входа: календари Google, Яндекс и Outlook забирают его по ссылке.
 * Доступ даёт только секретная часть адреса. Неверная ссылка и отключённая выглядят одинаково.
 * Лимиты раздельные: неверные ссылки считаются по адресу, верные по самой ссылке. Так перебор с одного адреса не
 * закрывает календарь остальным, даже когда все запросы приходят с одного адреса прокси или сервиса календаря
 */
export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  // Ссылка из букв, цифр, дефиса и подчёркивания: раскодировать нечего
  const token = file.replace(/\.ics$/i, "");
  // Поиск ссылки идёт и для адреса, который перебрал лимит неверных ссылок: без прокси у всех один адрес, и верная
  // ссылка не должна закрываться из-за чужого перебора. Поиск по уникальному отпечатку дешёвый, перебор 256-битной
  // ссылки бесполезен, лимит нужен против мусорной нагрузки
  const missKey = `calendar-miss:${clientIp(request.headers)}`;
  const feed = await feedByToken(token);
  if (!feed) {
    if (!rateLimit(missKey, MISSES_PER_MINUTE, 60_000)) return tooMany();
    return new Response("Ссылка на календарь не найдена или отключена", { status: 404, headers: COMMON });
  }
  if (!rateLimit(`calendar-feed:${feed.id}`, FETCHES_PER_MINUTE, 60_000)) return tooMany();
  const base = (process.env.APP_URL || new URL(request.url).origin).replace(/\/+$/, "");
  const body = await calendarFile(feed.personId, feed.withTitles, base);
  return new Response(body, {
    headers: { ...COMMON, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="weekly.ics"' },
  });
}
