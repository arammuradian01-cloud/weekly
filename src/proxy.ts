import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
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
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
