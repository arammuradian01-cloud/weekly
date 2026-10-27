import { NextResponse } from "next/server";
import { requireContext } from "@/lib/auth";
import { attentionCountFor } from "@/lib/inbox/attention";
import { subjectOf } from "@/lib/org/current";

export const dynamic = "force-dynamic";

/** Счётчик «ждут N» у пункта «Моя неделя» (этап 76, раньше у «Мне»): браузер спрашивает раз в полминуты и при возвращении на вкладку */
export async function GET() {
  const ctx = await requireContext();
  return NextResponse.json({ count: await attentionCountFor(ctx.person.id, new Date(), subjectOf(ctx)) }, { headers: { "Cache-Control": "no-store" } });
}
