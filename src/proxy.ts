import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// Без входа открыты только экран входа и проверка здоровья для сервера
const PUBLIC_PATHS = ["/login", "/api/health"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const session = await verifySession(
    request.cookies.get(SESSION_COOKIE)?.value,
    process.env.SESSION_SECRET ?? "",
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
