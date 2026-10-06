import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_SEC, refreshSessionToken, verifySession } from "@/lib/session";
import { sessionSecretFromEnv } from "@/lib/database-url";

// Без входа открыты экран входа, первичная настройка паролей и проверки здоровья для хостинга
const PUBLIC_PATHS = ["/login", "/setup", "/api/health", "/api/live"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const session = await verifySession(
    request.cookies.get(SESSION_COOKIE)?.value,
    sessionSecretFromEnv(),
  );
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (!session.personId && pathname !== "/choose") {
    return NextResponse.redirect(new URL("/choose", request.url));
  }
  const response = NextResponse.next();
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
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
