// Правила задач из разделов 2 и 4 ТЗ. Чистые функции: ими пользуются сервер (проверка прав и правил) и экраны (что показать).

import { addDays, diffDays, weekOf, fromCalendar, type IsoDate } from "@/domain/dates";
import { OPEN_STATUSES, priorityOf, type StatusCode } from "@/domain/dictionaries";
import type { PersonSlug, Role, Task } from "@/domain/types";

/** Просрочена: срок прошёл, а статус «В работе» или «Требует уточнений» */
export function isOverdue(task: Task, today: IsoDate): boolean {
  return OPEN_STATUSES.includes(task.status) && diffDays(task.due, today) > 0;
}

export function overdueDays(task: Task, today: IsoDate): number {
  return Math.max(0, diffDays(task.due, today));
}

/**
 * История изменений задачи (журнал в карточке): участникам задачи и режиму управления.
 * Матрица раздела 2: лидер видит историю своих задач, весь журнал только у владельца и администраторов
 */
export function canSeeTaskHistory(task: Pick<Task, "owner" | "coExecutors" | "createdBy" | "team">, v: Viewer): boolean {
  if (v.observer) return false;
  if (v.management || leadsTeam(v, task.team)) return true;
  return task.owner === v.slug || task.owner === "all" || task.coExecutors.includes(v.slug) || task.createdBy === v.slug;
}

let staleDaysSetting = 14;

/** Порог «давно не обновлялась» из настроек: экран получает его вместе со справочниками */
export function setStaleDays(days: number) {
  if (Number.isInteger(days) && days > 0) staleDaysSetting = days;
}

export function staleDays(): number {
  return staleDaysSetting;
}

/** «Давно не обновлялась»: открытая задача без обновления «Где сейчас» дольше порога */
export function isStale(task: Task, today: IsoDate, staleDays = staleDaysSetting): boolean {
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

export type ManagementRole = "OWNER" | "ADMIN";

/** Кто смотрит на задачу: профиль, включён ли режим управления и наблюдатель ли он */
export type Viewer = {
  slug: PersonSlug;
  /** Включённый режим управления: владелец или администратор */
  management?: ManagementRole | null;
  /** Наблюдатель только читает */
  observer?: boolean;
  /** Команды, которыми человек руководит, вместе с командами ниже (этап 14). Топ-команды здесь нет */
  leads?: string[];
  /** Сотрудник вне топ-команды: задачи «Все лидеры» к нему не относятся */
  employee?: boolean;
};

/** Руководитель команды задачи или команды выше неё: ведёт задачу как режим управления, кроме архива */
export function leadsTeam(v: Viewer, team: string | undefined): boolean {
  return !!team && !!v.leads?.includes(team);
}

export type TaskPermissions = {
  status: boolean;
  state: boolean;
  where: boolean;
  due: boolean;
  priority: boolean;
  /** Название, результат, направление, источник: тот, кто поставил, или режим управления */
  edit: boolean;
  /** Ответственный: только режим управления */
  owner: boolean;
  /** Соисполнители: режим управления или ответственный */
  coExecutors: boolean;
  links: boolean;
  comment: boolean;
  /** В архив: только владелец в режиме управления */
  archive: boolean;
  /** Предложенную задачу подтверждает или отклоняет режим управления */
  confirm: boolean;
};

/**
 * Матрица прав из раздела 2 ТЗ. Второй аргумент по-старому может быть слагом,
 * а третий признаком режима управления: так им пользовались экраны прототипа.
 */
export function permissions(task: Task, viewer: Viewer | PersonSlug, manageFlag?: boolean): TaskPermissions {
  const v: Viewer = typeof viewer === "string" ? { slug: viewer, management: manageFlag ? "ADMIN" : null } : viewer;
  if (v.observer) {
    return { status: false, state: false, where: false, due: false, priority: false, edit: false, owner: false, coExecutors: false, links: false, comment: false, archive: false, confirm: false };
  }
  // Режим управления или руководитель команды задачи (этап 14)
  const manage = !!v.management || leadsTeam(v, task.team);
  const me = v.slug;
  // «Все лидеры»: общую задачу ведёт любой лидер топ-команды, сотрудника это не касается
  const owner = task.owner === me || (task.owner === "all" && !v.employee);
  const directOwner = task.owner === me;
  const co = task.coExecutors.includes(me);
  const creator = task.createdBy === me;
  // Предложенная задача становится задачей только после подтверждения владельцем или администратором
  const proposed = task.status === "proposed";
  return {
    status: manage || (owner && !proposed),
    state: manage || (owner && !proposed),
    where: manage || owner || co,
    due: manage || (owner && !proposed),
    priority: manage || creator,
    edit: manage || creator,
    owner: manage,
    coExecutors: manage || directOwner,
    links: manage || owner || co || creator,
    comment: true,
    archive: v.management === "OWNER",
    confirm: manage,
  };
}

/**
 * Кому можно поставить задачу: себе может каждый, другому режим управления и руководитель команды задачи,
 * остальные лишь предлагают
 */
export function newTaskStatus(owner: Task["owner"], viewer: Viewer, team?: string): "in-progress" | "proposed" {
  if (viewer.management || leadsTeam(viewer, team)) return "in-progress";
  return owner === viewer.slug ? "in-progress" : "proposed";
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
