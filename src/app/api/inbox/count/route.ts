import { NextResponse } from "next/server";
import { requireContext } from "@/lib/auth";
import { inboxCount } from "@/lib/inbox/service";
import { subjectOf } from "@/lib/org/current";

export const dynamic = "force-dynamic";

/** Счётчик «Мне» для меню: браузер спрашивает раз в полминуты и при возвращении на вкладку */
export async function GET() {
  const ctx = await requireContext();
  return NextResponse.json({ count: await inboxCount(ctx.person.id, new Date(), subjectOf(ctx)) }, { headers: { "Cache-Control": "no-store" } });
}
