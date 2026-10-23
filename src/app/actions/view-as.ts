"use server";

// «Смотреть как» (этап 63): владелец при личном входе в режиме управления выбирает человека, приложение показывает
// всё его глазами, изменения недоступны. Выбор, начало и конец просмотра. Правила в src/lib/view-as.ts.

import { redirect, unstable_rethrow } from "next/navigation";
import { closeViewAs, requestIp, requireContext, writeViewAs, type AppContext } from "@/lib/auth";
import { TaskRuleError } from "@/lib/rule-error";
import { VIEW_AS_TEXTS } from "@/lib/view-as";
import { OWNER_AS_ENDED, OWNER_AS_TEXTS } from "@/lib/owner-as";
import { beginViewAs, viewAsPeople, viewAsTarget, type ViewAsOwner, type ViewAsPerson } from "@/lib/view-as-service";

export type ViewAsResult<T> = { ok: true; value: T } | { ok: false; error: string };

function ownerOf(ctx: AppContext, ip: string): ViewAsOwner {
  return { person: ctx.person, sid: ctx.session.sid, via: ctx.via, management: ctx.management, viewing: !!ctx.viewAs, ip };
}

/** Этап 71: во входе владельца в чужой профиль «Смотреть как» не открывается, после его конца сначала возврат к себе */
function ownerAsRefusal(ctx: AppContext): string | null {
  return ctx.ownerAs ? OWNER_AS_TEXTS.viewAs : ctx.ownerAsEnded ? OWNER_AS_ENDED : null;
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
    const refusal = ownerAsRefusal(ctx);
    if (refusal) return { ok: false, error: refusal };
    return { ok: true, value: await viewAsPeople(ownerOf(ctx, await requestIp())) };
  } catch (error) {
    return failure("Список для «Смотреть как»", error);
  }
}

/**
 * Начать просмотр: подписанная cookie, просмотр 2 часа (не дольше режима управления), запись в журнал, переход на
 * «Мою неделю». Если прежний просмотр закончился сам, сначала пишется его конец с причиной
 */
export async function startViewAsAction(personId: string): Promise<ViewAsResult<null>> {
  try {
    const ctx = await requireContext();
    if (ctx.viewAs) return { ok: false, error: VIEW_AS_TEXTS.viewing };
    const refusal = ownerAsRefusal(ctx);
    if (refusal) return { ok: false, error: refusal };
    const owner = ownerOf(ctx, await requestIp());
    const target = await viewAsTarget(owner, String(personId ?? ""));
    await closeViewAs("start");
    await writeViewAs(await beginViewAs(owner, target));
  } catch (error) {
    return failure("Начало «Смотреть как»", error);
  }
  redirect("/");
}

/**
 * «Выйти из просмотра» и «Вернуться к себе» после конца просмотра: действия, которые режим просмотра пропускает.
 * Запись в журнал, кого смотрели и почему кончилось, cookie снимается, владелец снова видит себя и может вносить
 * изменения. Режим управления остаётся, если его срок не вышел
 */
export async function stopViewAsAction(back?: string): Promise<void> {
  await closeViewAs("stop");
  // «Вернуться к себе» остаётся на той же странице, «Выйти из просмотра» ведёт на «Мою неделю»
  const path = typeof back === "string" && back.startsWith("/") && !back.startsWith("//") && !back.includes("\\") ? back : "/";
  redirect(path);
}

/**
 * Выход из ресурса во время просмотра (меню профиля): сначала просмотр снимается с записью «выход из ресурса», потом
 * экран отправляет черновики владельца с устройства и выходит. Без перехода: дальше идёт обычный выход
 */
export async function endViewAsForLogoutAction(): Promise<{ ok: true }> {
  await closeViewAs("logout");
  return { ok: true };
}
