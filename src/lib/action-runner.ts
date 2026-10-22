import "server-only";
import { unstable_rethrow } from "next/navigation";
import { requestIp, requireContext, requireWriteContext, type AppContext } from "@/lib/auth";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function actorOf(ctx: AppContext, ip: string): Actor {
  return {
    personId: ctx.person.id,
    slug: ctx.person.slug,
    fullName: ctx.person.fullName,
    role: ctx.person.role,
    management: ctx.management?.role ?? null,
    ip,
    via: ctx.via,
  };
}

/**
 * Кто смотрит: выбранный профиль, режим управления и адрес. Для страниц и действий, которые только читают. В режиме
 * «Смотреть как» (этап 63) это выбранный человек без режима управления
 */
export async function currentActor(): Promise<Actor> {
  return actorOf(await requireContext(), await requestIp());
}

/** Кто меняет: то же, что currentActor, но в режиме «Смотреть как» отказ (этап 63). Изменения из экранов идут через него */
export async function writingActor(): Promise<Actor> {
  return actorOf(await requireWriteContext(), await requestIp());
}

async function attempt<T>(what: string, actor: () => Promise<Actor>, fn: (a: Actor) => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn(await actor()) };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof TaskRuleError) return { ok: false, error: error.message };
    console.error(`${what}: не прошло`, error);
    return { ok: false, error: "Не получилось сохранить. Обновите страницу и попробуйте ещё раз" };
  }
}

/**
 * Действие экрана, которое что-то меняет: ошибка правила уходит человеку текстом, остальные ошибки в лог сервера.
 * В режиме «Смотреть как» отказывает до любого обращения к данным
 */
export async function runAction<T>(what: string, fn: (a: Actor) => Promise<T>): Promise<Result<T>> {
  return attempt(what, writingActor, fn);
}

/**
 * Действие экрана, которое только читает (карточка задачи, поиск, списки для выбора): работает и в режиме
 * «Смотреть как». Ничего не пишет, иначе это runAction. Список таких действий проверяет tests/db/view-as.test.ts
 */
export async function runRead<T>(what: string, fn: (a: Actor) => Promise<T>): Promise<Result<T>> {
  return attempt(what, currentActor, fn);
}
