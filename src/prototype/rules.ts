// Правила задач из раздела 4 ТЗ. Чистые функции: на этапе 3 они переедут в src/lib без изменений.

import { addDays, diffDays, weekOf, fromCalendar, type IsoDate } from "./dates";
import { OPEN_STATUSES, priorityOf, type StatusCode } from "./dictionaries";
import type { PersonSlug, Role, Task } from "./types";

/** Просрочена: срок прошёл, а статус «В работе» или «Требует уточнений» */
export function isOverdue(task: Task, today: IsoDate): boolean {
  return OPEN_STATUSES.includes(task.status) && diffDays(task.due, today) > 0;
}

export function overdueDays(task: Task, today: IsoDate): number {
  return Math.max(0, diffDays(task.due, today));
}

/** «Давно не обновлялась»: открытая задача без обновления «Где сейчас» дольше порога */
export function isStale(task: Task, today: IsoDate, staleDays = 14): boolean {
  return OPEN_STATUSES.includes(task.status) && diffDays(task.whereUpdatedAt, today) > staleDays;
}

export function isOpen(task: Task): boolean {
  return OPEN_STATUSES.includes(task.status) || task.status === "proposed";
}

export function isClosed(task: Task): boolean {
  return task.status === "done" || task.status === "failed" || task.status === "cancelled";
}

/** Срок на этой неделе, с понедельника по воскресенье */
export function isDueThisWeek(task: Task, today: IsoDate): boolean {
  const week = weekOf(today);
  const start = fromCalendar(week.start);
  const end = fromCalendar(week.end);
  return OPEN_STATUSES.includes(task.status) && diffDays(start, task.due) >= 0 && diffDays(task.due, end) >= 0;
}

/** Срок на следующей неделе */
export function isDueNextWeek(task: Task, today: IsoDate): boolean {
  const week = weekOf(addDays(today, 7));
  const start = fromCalendar(week.start);
  const end = fromCalendar(week.end);
  return OPEN_STATUSES.includes(task.status) && diffDays(start, task.due) >= 0 && diffDays(task.due, end) >= 0;
}

export function isClosedThisWeek(task: Task, today: IsoDate): boolean {
  if (!task.closedAt) return false;
  return diffDays(task.closedAt, today) <= 7;
}

/** Задача видна в «Моих задачах»: ответственный, соисполнитель или общая задача для лидера */
export function isMine(task: Task, me: PersonSlug, role: Role): boolean {
  if (task.owner === me || task.coExecutors.includes(me)) return true;
  return task.owner === "all" && role === "LEADER";
}

/**
 * Кто что может менять (матрица прав из раздела 2 ТЗ).
 * manage: включён режим управления владельца или администратора.
 */
export function permissions(task: Task, me: PersonSlug, manage: boolean) {
  const owner = task.owner === me || (task.owner === "all");
  const co = task.coExecutors.includes(me);
  return {
    status: manage || owner,
    state: manage || owner,
    where: manage || owner || co,
    due: manage || owner,
    priority: manage || task.createdBy === me,
    comment: true,
  };
}

/** Порядок «Моих задач»: просроченные, срок на этой неделе, остальные по сроку */
export function myTasksOrder(tasks: Task[], today: IsoDate): Task[] {
  const rank = (t: Task) => (isOverdue(t, today) ? 0 : isDueThisWeek(t, today) ? 1 : isClosed(t) ? 3 : 2);
  return [...tasks].sort((a, b) => rank(a) - rank(b) || diffDays(b.due, a.due) || a.number - b.number);
}

/** Сортировка для списка: сначала просроченные и критичные, потом по сроку */
export function defaultOrder(tasks: Task[], today: IsoDate): Task[] {
  return [...tasks].sort((a, b) => {
    const ca = isClosed(a) ? 1 : 0;
    const cb = isClosed(b) ? 1 : 0;
    if (ca !== cb) return ca - cb;
    const oa = isOverdue(a, today) ? 0 : 1;
    const ob = isOverdue(b, today) ? 0 : 1;
    if (oa !== ob) return oa - ob;
    const pa = priorityOf(a.priority).rank;
    const pb = priorityOf(b.priority).rank;
    if (pa !== pb) return pa - pb;
    return diffDays(b.due, a.due) || a.number - b.number;
  });
}

/** Для каких переходов нужен текст: причина или итог */
export function statusNeedsNote(next: StatusCode): "result" | "reason" | null {
  if (next === "done") return "result";
  if (next === "failed" || next === "cancelled") return "reason";
  return null;
}
