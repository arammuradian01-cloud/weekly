// Аналитика руководителя (этап 27, модуль М12): чистые правила без базы. Их считают и сервер, и тесты.
//
// - Weekly по неделям: вовремя, с опозданием, не сдали, в отпуске. Отчётная неделя до срока: «ещё сдают», а не «не сдали».
// - Просрочка на конец прошлых недель восстанавливается по переносам срока: срок задачи в тот момент это прежний срок
//   первого переноса, сделанного позже.
// - Время ответа на просьбу считается в рабочих часах: будни с 9 до 20 по Москве. Просьба в пятницу вечером
//   не копит часы за выходные.
// - Карточки лидеров идут в порядке структуры, общего рейтинга нет.

import { addDays, diffDays, plural, type IsoDate } from "@/domain/dates";
import type { WeekKey } from "@/domain/types";
import { shiftWeek } from "@/lib/weekly/weeks";

/** Сколько недель показывает панель */
export const WEEKS = 8;
/** Рабочий день по Москве: с 9 до 20, как у уведомлений в браузере */
export const WORK_START = 9;
export const WORK_END = 20;
/** Москва живёт в UTC+3 без перехода на летнее время */
const MSK_MS = 3 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Последние недели по порядку, заканчивая указанной */
export function lastWeeks(last: WeekKey, count = WEEKS): WeekKey[] {
  return Array.from({ length: count }, (_, i) => shiftWeek(last, i - count + 1));
}

/** Рабочие часы между двумя моментами: будни с 9 до 20 по Москве, с точностью до десятой */
export function workingHoursBetween(from: Date, to: Date): number {
  const a = from.getTime() + MSK_MS;
  const b = to.getTime() + MSK_MS;
  if (!(b > a)) return 0;
  let total = 0;
  for (let day = Math.floor(a / DAY_MS) * DAY_MS; day < b; day += DAY_MS) {
    const weekday = new Date(day).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const start = Math.max(a, day + WORK_START * HOUR_MS);
    const end = Math.min(b, day + WORK_END * HOUR_MS);
    if (end > start) total += end - start;
  }
  return Math.round((total / HOUR_MS) * 10) / 10;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(m * 10) / 10;
}

/** Перенос срока для восстановления: когда и с какого срока */
export type TransferPoint = { at: Date | null; fromDue: IsoDate | null };

/**
 * Срок задачи в момент времени. Берём прежний срок первого переноса после этого момента; переносов позже нет: нынешний срок.
 * Переносы без времени были в таблице до запуска ресурса и на окно панели не влияют
 */
export function dueAt(currentDue: IsoDate, transfers: TransferPoint[], moment: Date): IsoDate {
  const later = transfers.filter((t) => t.at && t.at.getTime() > moment.getTime()).sort((x, y) => x.at!.getTime() - y.at!.getTime());
  for (const t of later) if (t.fromDue) return t.fromDue;
  return currentDue;
}

/** Задача для восстановления просрочки на конец недели */
export type TaskHistory = {
  status: string;
  due: IsoDate;
  createdAt: Date;
  closedAt: Date | null;
  archivedAt: Date | null;
  transfers: TransferPoint[];
};

const CLOSED = new Set(["DONE", "PARTIAL", "FAILED", "CANCELLED"]);

/** Была ли задача открыта и просрочена в момент moment (день по Москве: day) */
export function overdueAt(task: TaskHistory, moment: Date, day: IsoDate): boolean {
  // Предложенные, но не принятые задачи в просрочку не идут: их ещё никто не взял
  if (task.status === "PROPOSED") return false;
  if (task.createdAt.getTime() > moment.getTime()) return false;
  if (task.archivedAt && task.archivedAt.getTime() <= moment.getTime()) return false;
  if (CLOSED.has(task.status) && (!task.closedAt || task.closedAt.getTime() <= moment.getTime())) return false;
  return diffDays(dueAt(task.due, task.transfers, moment), day) > 0;
}

/** Состояние weekly человека за неделю */
export type WeeklyCell = "on-time" | "late" | "missing" | "pending" | "absent" | "none";

/**
 * expected: от человека ждут weekly в этой неделе; state: строка weekly или её нет; absent: отмечен отсутствующим;
 * passed: его срок сдачи прошёл
 */
export function weeklyCell(expected: boolean, state: string | null | undefined, absent: boolean, passed: boolean): WeeklyCell {
  if (state === "SUBMITTED") return expected ? "on-time" : "none";
  if (state === "LATE") return expected ? "late" : "none";
  if (!expected) return "none";
  if (absent) return "absent";
  return passed ? "missing" : "pending";
}

export type WeeklyCounts = { expected: number; onTime: number; late: number; missing: number; pending: number; absent: number };

export function countCells(cells: WeeklyCell[]): WeeklyCounts {
  const n = (c: WeeklyCell) => cells.filter((x) => x === c).length;
  const out = { onTime: n("on-time"), late: n("late"), missing: n("missing"), pending: n("pending"), absent: n("absent") };
  // Отсутствующих не ждём: доля считается от тех, кто должен был сдать
  return { expected: out.onTime + out.late + out.missing + out.pending, ...out };
}

/** Доля в процентах, без дробей. Нет базы: null */
export function share(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/** Конец недели для счёта «на конец недели»: воскресенье 23:59 по Москве или сейчас, если неделя идёт */
export function weekEndMoment(key: WeekKey, now: Date): { moment: Date; day: IsoDate; current: boolean } {
  const sunday = addDays(key, 6);
  const [y, m, d] = sunday.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d, 23 - 3, 59, 59, 999));
  if (end.getTime() <= now.getTime()) return { moment: end, day: sunday, current: false };
  const today = new Date(now.getTime() + MSK_MS).toISOString().slice(0, 10);
  return { moment: now, day: today, current: true };
}

/** Команда для карточек лидеров */
export type CardNode = { id: string; parentId: string | null; leaderId: string | null; active: boolean; sortOrder: number };

/**
 * Команды для карточек лидеров под выбранной: команды уровнем ниже. Если команду ниже ведёт тот же руководитель,
 * что и выбранную, спускаемся в неё: карточка о самом себе руководителю не нужна
 */
export function cardTeams<T extends CardNode>(nodes: T[], selectedId: string, visible: Set<string>): T[] {
  const byParent = new Map<string, T[]>();
  for (const n of nodes) {
    if (!n.active || !n.parentId || n.id === n.parentId || !visible.has(n.id)) continue;
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }
  const selected = nodes.find((n) => n.id === selectedId);
  const own = selected?.leaderId ?? null;
  const out: T[] = [];
  const seen = new Set<string>([selectedId]);
  const walk = (id: string) => {
    for (const c of [...(byParent.get(id) ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      if (own && c.leaderId === own) walk(c.id);
      else out.push(c);
    }
  };
  walk(selectedId);
  return out;
}

/** «3 рабочих часа», «меньше рабочего часа»: целые часы, дробные ничего не добавляют к разговору с лидером */
export function hoursText(hours: number | null): string {
  if (hours === null) return "ответов не было";
  if (hours < 1) return "меньше рабочего часа";
  const n = Math.round(hours);
  return `${n} ${plural(n, "рабочий час", "рабочих часа", "рабочих часов")}`;
}
