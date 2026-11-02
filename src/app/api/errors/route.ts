import { clientIp } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { REPORTS_PER_IP, REPORTS_WINDOW_MS, REPORT_BODY_MAX, parseErrorReport, recordError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * Сбор сбоев (этап 86): сюда приходят ошибки из браузера и жалобы политики CSP.
 *
 * Открыт без входа нарочно: сбой случается и на экране входа, а жалобу политики браузер шлёт сам, без cookie.
 * Поэтому обработчик ничего не читает из базы по запросу, тело принимает не больше REPORT_BODY_MAX, с одного
 * адреса не больше REPORTS_PER_IP сообщений в минуту, и всегда отвечает «принято» без текста: по ответу нельзя
 * узнать ни про ресурс, ни про людей.
 */
export async function POST(request: Request) {
  const accepted = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const ip = clientIp(request.headers);
  if (!rateLimit(`errors:${ip}`, REPORTS_PER_IP, REPORTS_WINDOW_MS)) return accepted;
  // Тело принимаем только с заявленной длиной в пределе: без заголовка (тело частями) и с нечисловым значением
  // отказываем, иначе предел не действовал бы вовсе и обработчик читал бы сколько прислали
  const declared = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0 || declared > REPORT_BODY_MAX) return accepted;
  let body = "";
  try {
    body = await request.text();
  } catch {
    return accepted;
  }
  const reports = parseErrorReport(request.headers.get("content-type") ?? "", body);
  // Одно сообщение может нести несколько жалоб; больше пяти за раз не записываем
  for (const report of reports.slice(0, 5)) await recordError(report);
  return accepted;
}
