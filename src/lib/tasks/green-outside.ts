// «Зелёное снаружи» (этап 22б, модуль М6): задача отмечена «В графике», а по фактам нет. Ресурс подсвечивает её сам:
// красный статус безопасен, а зелёный без оснований прячет проблему до встречи.

import { diffDays, type IsoDate } from "@/domain/dates";
import type { Task } from "@/domain/types";

/** Столько дней без обновления «Где сейчас»: предупреждение */
export const QUIET_WARN_DAYS = 7;
/** Столько дней без обновления: «В графике» не считается, пока «Где сейчас» не обновят */
export const QUIET_DROP_DAYS = 14;

type GreenTask = Pick<Task, "state" | "status" | "due" | "transfers" | "whereUpdatedAt" | "archived">;

export type GreenOutside = {
  /** Почему подсветили: «просрочена на 3 дн.», «срок переносили 2 раза», «9 дн. без обновлений» */
  reasons: string[];
  /** Дней без обновления «Где сейчас» */
  quietDays: number;
  /** 14 дней и больше: «В графике» снято до подтверждения */
  unconfirmed: boolean;
};

function times(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "раза" : "раз";
}

/**
 * Открытая задача «В графике», которая просрочена, у которой срок переносили 2 раза и больше или «Где сейчас» не
 * обновляли 7 дней. null: всё в порядке или задача не «В графике»
 */
export function greenOutside(task: GreenTask, today: IsoDate): GreenOutside | null {
  if (task.archived || task.state !== "on-track" || (task.status !== "in-progress" && task.status !== "clarify")) return null;
  const reasons: string[] = [];
  const overdue = diffDays(task.due, today);
  if (overdue > 0) reasons.push(`просрочена на ${overdue} дн.`);
  if (task.transfers.length >= 2) reasons.push(`срок переносили ${task.transfers.length} ${times(task.transfers.length)}`);
  const quietDays = Math.max(0, diffDays(task.whereUpdatedAt, today));
  if (quietDays >= QUIET_WARN_DAYS) reasons.push(`${quietDays} дн. без обновлений`);
  if (!reasons.length) return null;
  return { reasons, quietDays, unconfirmed: quietDays >= QUIET_DROP_DAYS };
}

/** Строка для экрана: «В графике», но просрочена на 3 дн., 9 дн. без обновлений */
export function greenOutsideText(g: GreenOutside): string {
  return `«В графике», но ${g.reasons.join(", ")}`;
}
