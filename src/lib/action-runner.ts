import "server-only";
import { unstable_rethrow } from "next/navigation";
import { requestIp, requireContext } from "@/lib/auth";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Кто действует: выбранный профиль, режим управления и адрес */
export async function currentActor(): Promise<Actor> {
  const ctx = await requireContext();
  return {
    personId: ctx.person.id,
    slug: ctx.person.slug,
    fullName: ctx.person.fullName,
    role: ctx.person.role,
    management: ctx.management?.role ?? null,
    ip: await requestIp(),
    via: ctx.via,
  };
}

/** Действие экрана: ошибка правила уходит человеку текстом, остальные ошибки в лог сервера */
export async function runAction<T>(what: string, fn: (a: Actor) => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn(await currentActor()) };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof TaskRuleError) return { ok: false, error: error.message };
    console.error(`${what}: не прошло`, error);
    return { ok: false, error: "Не получилось сохранить. Обновите страницу и попробуйте ещё раз" };
  }
}
