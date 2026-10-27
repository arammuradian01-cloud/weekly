// Roadmap (этап 56). Решение Арама 21.10: отдельный раздел, где на доске расставлены все задачи, которые предстоит
// сделать человеку или его команде, по каждому направлению, важные отмечены звёздочками.
//
// Доска: строки по направлениям (ОСАГО, КАСКО, ипотека и так далее, в порядке справочника), столбцы по срокам:
// «Просрочено», текущий месяц, два следующих, «Позже». На доске открытые задачи: в работе, на уточнении и
// предложенные. Закрытые уходят: roadmap про то, что предстоит. Важность берётся из приоритета задачи: критичный
// две звёздочки, высокий одна. Остальные без отметки, чтобы важное было видно сразу.

import type { DirectionCode, PriorityCode } from "@/domain/dictionaries";
import type { IsoDate } from "@/domain/dates";
import type { PersonSlug, Task } from "@/domain/types";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

export type PeriodKey = "overdue" | "later" | `${number}-${string}`;
export type Period = { key: PeriodKey; label: string };

/** Месяцев на доске после текущего: дальше «Позже» */
export const MONTHS_AHEAD = 2;

const monthKey = (iso: IsoDate) => iso.slice(0, 7) as PeriodKey;

/** Столбцы доски от сегодняшнего дня: просрочено, текущий месяц и два следующих, позже */
export function roadmapPeriods(today: IsoDate): Period[] {
  const out: Period[] = [{ key: "overdue", label: "Просрочено" }];
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  for (let i = 0; i <= MONTHS_AHEAD; i++) {
    const key = `${year}-${String(month).padStart(2, "0")}` as PeriodKey;
    // Январь следующего года подписан годом: иначе «Январь» рядом с «Декабрём» читается как прошлый
    out.push({ key, label: month === 1 && i > 0 ? `${MONTHS[0]} ${year}` : MONTHS[month - 1]! });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  out.push({ key: "later", label: "Позже" });
  return out;
}

/** Столбец задачи: просроченная открытая задача в «Просрочено», дальше по месяцу срока */
export function periodOf(task: Pick<Task, "due" | "status">, today: IsoDate, periods: Period[] = roadmapPeriods(today)): PeriodKey {
  if (task.due < today && task.status !== "proposed") return "overdue";
  const key = monthKey(task.due < today ? today : task.due);
  return periods.some((p) => p.key === key) ? key : "later";
}

/** Важность для доски: 2 критичный, 1 высокий, 0 без отметки */
export function importanceOf(priority: PriorityCode): 0 | 1 | 2 {
  return priority === "critical" ? 2 : priority === "high" ? 1 : 0;
}

export const IMPORTANCE_LABEL: Record<0 | 1 | 2, string> = { 0: "Обычная", 1: "Важная", 2: "Критичная" };

/** Предложенная задача, срок которой уже прошёл: стоит в текущем месяце с пометкой */
export const proposedLate = (t: Pick<Task, "due" | "status">, today: IsoDate) => t.status === "proposed" && t.due < today;

/** На доске: открытые задачи и предложенные, без архива */
export const onRoadmap = (t: Pick<Task, "status" | "archived">) => !t.archived && (t.status === "in-progress" || t.status === "clarify" || t.status === "proposed");

export type RoadmapFilter = {
  /** Человек: ответственный или соисполнитель. null: вся команда */
  person: PersonSlug | null;
  /** Человек лидер: задачи «Все лидеры» тоже его, как в «Моих задачах» */
  personLeads?: boolean;
  onlyImportant: boolean;
};

export type RoadmapRow = { direction: DirectionCode; label: string; total: number; important: number; cells: Record<string, Task[]> };
export type Roadmap = { periods: Period[]; rows: RoadmapRow[]; total: number; important: number; overdue: number };

/**
 * Доска: строки направлений в порядке справочника (направление, которого нет в справочнике, в конце), в ячейке
 * сначала важные, потом по сроку и номеру
 */
/** Задачи roadmap после фильтров: открытые, выбранного человека, только важные. Общие для всех группировок (этап 77) */
export function roadmapTasks(tasks: Task[], filter: RoadmapFilter): Task[] {
  const mine = (t: Task) => !filter.person || t.owner === filter.person || t.coExecutors.includes(filter.person) || (t.owner === "all" && !!filter.personLeads);
  return tasks.filter((t) => onRoadmap(t) && mine(t) && (!filter.onlyImportant || importanceOf(t.priority) > 0));
}

/** Ячейки строки доски по срокам: в ячейке сначала важные, потом по сроку и номеру */
export function roadmapCells(list: Task[], today: IsoDate, periods: Period[]): Record<string, Task[]> {
  const cells: Record<string, Task[]> = Object.fromEntries(periods.map((p) => [p.key, [] as Task[]]));
  for (const t of list) cells[periodOf(t, today, periods)]!.push(t);
  for (const key of Object.keys(cells)) cells[key]!.sort((a, b) => importanceOf(b.priority) - importanceOf(a.priority) || a.due.localeCompare(b.due) || a.number - b.number);
  return cells;
}

export function buildRoadmap(tasks: Task[], today: IsoDate, filter: RoadmapFilter, directions: { code: string; label: string }[]): Roadmap {
  const periods = roadmapPeriods(today);
  const picked = roadmapTasks(tasks, filter);
  const order = new Map(directions.map((d, i) => [d.code, i]));
  const byDirection = new Map<string, Task[]>();
  for (const t of picked) {
    const list = byDirection.get(t.direction);
    if (list) list.push(t);
    else byDirection.set(t.direction, [t]);
  }
  const rows = [...byDirection.entries()]
    .sort(([a], [b]) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b))
    .map(([direction, list]) => {
      const cells = roadmapCells(list, today, periods);
      return {
        direction: direction as DirectionCode,
        label: directions.find((d) => d.code === direction)?.label ?? direction,
        total: list.length,
        important: list.filter((t) => importanceOf(t.priority) > 0).length,
        cells,
      };
    });
  return {
    periods,
    rows,
    total: picked.length,
    important: picked.filter((t) => importanceOf(t.priority) > 0).length,
    overdue: picked.filter((t) => periodOf(t, today, periods) === "overdue").length,
  };
}
