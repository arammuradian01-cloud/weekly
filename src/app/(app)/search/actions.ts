"use server";

// Общий поиск из командной строки (этап 25): права проверяет сервис

import { unstable_rethrow } from "next/navigation";
import { requireContext } from "@/lib/auth";
import { subjectOf } from "@/lib/org/current";
import { search, type SearchResult } from "@/lib/search/service";
import { rateLimit } from "@/lib/rate-limit";

export type SearchActionResult = { ok: true; value: SearchResult } | { ok: false; error: string };

export async function searchAction(query: string): Promise<SearchActionResult> {
  try {
    const ctx = await requireContext();
    // Командная строка шлёт запрос на каждое слово: лимит щадящий, но от зацикленного экрана защищает
    if (!rateLimit(`search:${ctx.person.id}`, 120, 60_000)) return { ok: false, error: "Слишком много запросов подряд, подождите минуту" };
    return { ok: true, value: await search(subjectOf(ctx), String(query ?? ""), "palette") };
  } catch (error) {
    unstable_rethrow(error);
    console.error("Поиск не прошёл", error);
    return { ok: false, error: "Поиск не отвечает. Попробуйте ещё раз" };
  }
}
