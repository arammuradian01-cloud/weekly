import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Проверка для сервера и мониторинга: приложение живо и видит базу */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, db: true });
  } catch {
    return Response.json({ ok: false, db: false }, { status: 503 });
  }
}
