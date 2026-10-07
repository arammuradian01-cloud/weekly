"use server";

// Сохранённые виды списка задач (этап 25)

import { unstable_rethrow } from "next/navigation";
import { requireContext } from "@/lib/auth";
import { deleteView, saveView, ViewRuleError, type SavedViewDto } from "@/lib/views/service";

export type ViewActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function run<T>(fn: (personId: string) => Promise<T>): Promise<ViewActionResult<T>> {
  try {
    const ctx = await requireContext();
    // Общий логин без режима управления ничего личного не хранит: вид приписался бы не тому человеку
    if (ctx.via === "TEAM" && !ctx.management) return { ok: false, error: "Виды сохраняются при личном входе" };
    return { ok: true, value: await fn(ctx.person.id) };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ViewRuleError) return { ok: false, error: error.message };
    console.error("Вид не сохранился", error);
    return { ok: false, error: "Не получилось сохранить. Попробуйте ещё раз" };
  }
}

export async function saveViewAction(input: { path: string; name: string; query: string }): Promise<ViewActionResult<SavedViewDto>> {
  return run((personId) => saveView(personId, input));
}

export async function deleteViewAction(id: string): Promise<ViewActionResult<null>> {
  return run(async (personId) => {
    await deleteView(personId, id);
    return null;
  });
}
