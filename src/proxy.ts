import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_SEC, refreshSessionToken, verifySession } from "@/lib/session";
import { sessionSecretFromEnv } from "@/lib/database-url";
import { APP_URL_REDIRECT, appUrlRedirect } from "@/lib/app-url";
import { securityHeaders, type SecurityHeaders } from "@/lib/security";

// Без входа открыты экран входа, первичная настройка паролей, проверки здоровья для хостинга и сбор ошибок. Календарь
// сроков (этап 29) забирают сервисы календарей без cookie: доступ даёт секретная часть адреса. Сбор ошибок
// (этап 86) открыт без входа нарочно: жалобы политики CSP и сбои браузера приходят и с экрана входа, и без cookie
const PUBLIC_PATHS = ["/login", "/setup", "/api/health", "/api/live", "/api/calendar", "/api/errors"];

/** Заголовки запроса со своими добавками: из них Next берёт метку встроенных скриптов (этап 86) */
function withRequestHeaders(request: NextRequest, security: SecurityHeaders): Headers {
  const headers = new Headers(request.headers);
  // Заголовок запроса от браузера не должен подменить метку: свои значения ставятся последними
  for (const [key, value] of Object.entries(security.request)) headers.set(key, value);
  return headers;
}

/** Заголовки безопасности на готовый ответ (этап 86) */
function secured(response: NextResponse, security: SecurityHeaders): NextResponse {
  for (const [key, value] of Object.entries(security.response)) response.headers.set(key, value);
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Заголовки безопасности (этап 86): HSTS и CSP. Считаются до всех переходов, чтобы уходили с любым ответом,
  // включая переходы на вход. Политика одна на всё приложение: она живёт на документе, а не на адресе страницы
  const security = securityHeaders();
  // Свой адрес приложения (этап 69): с REDIRECT_TO_APP_URL=1 страницы, открытые по другому адресу (например по
  // техническому адресу хостинга), уходят переходом 308 на тот же путь основного адреса из APP_URL, раньше проверки
  // входа и открытых путей. /api, загрузки и серверные действия не переводятся. Ответ не кэшируется: выключенный
  // переход перестаёт действовать сразу. Правила в src/lib/app-url.ts
  const moved = appUrlRedirect({ method: request.method, pathname, search: request.nextUrl.search, headers: request.headers });
  if (moved) {
    const response = NextResponse.redirect(moved, APP_URL_REDIRECT.status);
    for (const [key, value] of Object.entries(APP_URL_REDIRECT.headers)) response.headers.set(key, value);
    return secured(response, security);
  }
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return secured(NextResponse.next({ request: { headers: withRequestHeaders(request, security) } }), security);
  }

  const session = await verifySession(
    request.cookies.get(SESSION_COOKIE)?.value,
    sessionSecretFromEnv(),
  );
  if (!session) {
    return secured(NextResponse.redirect(new URL("/login", request.url)), security);
  }
  if (!session.personId && pathname !== "/choose") {
    return secured(NextResponse.redirect(new URL("/choose", request.url)), security);
  }
  const response = NextResponse.next({ request: { headers: withRequestHeaders(request, security) } });
  // Скользящая сессия: раз в сутки та же cookie подписывается заново на 30 дней. Отозванный личный вход это не оживит:
  // его проверяет запись устройства в базе
  // Только на обычных переходах (GET): действия входа и выхода сами пишут cookie, их не перебиваем
  const fresh = request.method === "GET" ? await refreshSessionToken(request.cookies.get(SESSION_COOKIE)?.value, sessionSecretFromEnv()) : null;
  if (fresh) {
    response.cookies.set(SESSION_COOKIE, fresh, {
      httpOnly: true,
      sameSite: "lax",
      secure: (process.env.APP_URL ?? "").startsWith("https://"),
      path: "/",
      maxAge: SESSION_TTL_SEC,
    });
  }
  return secured(response, security);
}

// Без проверки входа: файлы сборки, значки и логотип, а для приложения на экране «Домой» (этап 26) описание приложения,
// служебный обработчик и страница «Нет сети»: браузер запрашивает их без cookie, данных в них нет.
// Загрузка пакета рынка (этап 62, /api/market/upload) и пакета наполнения (этап 67, /api/content-import) идёт мимо
// proxy: для запросов с телом Next копит всё тело в памяти до вызова proxy и обработчика, а пакет бывает до 25 МБ и
// 5 МБ. Вход, права, адрес страницы и размер обработчик проверяет сам до чтения тела. Обновлять cookie сессии на этом
// POST не нужно: proxy делает это только на GET.
// Заголовки безопасности (этап 86) этим путям не нужны: файлы сборки и значки не страницы, а два обработчика
// загрузки отвечают JSON
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|logo/|icons/|manifest.webmanifest|sw.js|offline.html|api/market/upload/?$|api/content-import/?$).*)"],
};
