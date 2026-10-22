"use server";

// «Смотреть как» (этап 63): владелец при личном входе в режиме управления выбирает человека, приложение показывает
// всё его глазами, изменения недоступны. Выбор, начало и конец просмотра. Правила в src/lib/view-as.ts.

import { redirect, unstable_rethrow } from "next/navigation";
import { clearViewAs, readViewAsToken, requestIp, requireContext, writeViewAs, type AppContext } from "@/lib/auth";
import { TaskRuleError } from "@/lib/rule-error";
import { VIEW_AS_TEXTS } from "@/lib/view-as";
import { beginViewAs, endViewAs, viewAsPeople, type ViewAsOwner, type ViewAsPerson } from "@/lib/view-as-service";

export type ViewAsResult<T> = { ok: true; value: T } | { ok: false; error: string };

function ownerOf(ctx: AppContext, ip: string): ViewAsOwner {
  return { person: ctx.person, sid: ctx.session.sid, via: ctx.via, management: ctx.management, viewing: !!ctx.viewAs, ip };
}

function failure(what: string, error: unknown): { ok: false; error: string } {
  unstable_rethrow(error);
  if (error instanceof TaskRuleError) return { ok: false, error: error.message };
  console.error(`${what}: не прошло`, error);
  return { ok: false, error: "Не получилось. Обновите страницу и попробуйте ещё раз" };
}

/** Люди для выбора: все включённые люди компании. Только владельцу при личном входе в режиме управления */
export async function viewAsPeopleAction(): Promise<ViewAsResult<ViewAsPerson[]>> {
  try {
    const ctx = await requireContext();
    if (ctx.viewAs) return { ok: false, error: VIEW_AS_TEXTS.viewing };
    return { ok: true, value: await viewAsPeople(ownerOf(ctx, await requestIp())) };
  } catch (error) {
    return failure("Список для «Смотреть как»", error);
  }
}

/** Начать просмотр: подписанная cookie на 2 часа (не дольше режима управления), запись в журнал, переход на «Мою неделю» */
export async function startViewAsAction(personId: string): Promise<ViewAsResult<null>> {
  try {
    const ctx = await requireContext();
    if (ctx.viewAs) return { ok: false, error: VIEW_AS_TEXTS.viewing };
    const { token } = await beginViewAs(ownerOf(ctx, await requestIp()), String(personId ?? ""));
    await writeViewAs(token);
  } catch (error) {
    return failure("Начало «Смотреть как»", error);
  }
  redirect("/");
}

/**
 * «Выйти из просмотра»: единственное действие, которое режим просмотра пропускает. Запись в журнал, кого смотрели,
 * cookie гаснет, владелец снова видит себя. Режим управления остаётся, если его срок не вышел
 */
export async function stopViewAsAction(): Promise<void> {
  const ctx = await requireContext();
  const token = await readViewAsToken();
  if (ctx.viewAs && token) await endViewAs(ctx.viewAs.owner, token.targetId, "stop", { ip: await requestIp(), via: ctx.via });
  await clearViewAs();
  redirect("/");
}
