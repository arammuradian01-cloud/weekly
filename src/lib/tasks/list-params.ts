// Параметры списка задач в адресе страницы (этап 25, модуль М10): фильтры, группировка, сортировка.
// Ссылка с фильтрами открывает у коллеги тот же вид, сохранённый вид хранит ту же строку

import type { IsoDate } from "@/domain/dates";
import { priorityOf, statusOf } from "@/domain/dictionaries";
import { isClosed, isDueThisWeek, isMine, isOverdue, isStale, defaultOrder } from "@/domain/rules";
import { ownerName } from "@/domain/people";
import type { Role, Task } from "@/domain/types";

export type QuickFilter = "mine" | "overdue" | "critical" | "week" | "blocked" | "stale" | "unassigned";
export type GroupBy = "none" | "owner" | "direction" | "priority" | "goal";
export type SortKey = "number" | "title" | "owner" | "priority" | "status" | "due" | "updated";
export type SortDir = "asc" | "desc";

export const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: "mine", label: "Мои" },
  { key: "overdue", label: "Просроченные" },
  { key: "critical", label: "Критичные" },
  { key: "week", label: "Срок на этой неделе" },
  { key: "blocked", label: "Заблокированные" },
  { key: "stale", label: "Давно не обновлялись" },
];

export type ListParams = {
  q: string;
  filters: QuickFilter[];
  /** Ответственный: слаг или «all» для общих задач */
  owner: string | null;
  direction: string | null;
  group: GroupBy;
  closed: boolean;
  archive: boolean;
  sort: SortKey | null;
  dir: SortDir;
};

export const DEFAULT_PARAMS: ListParams = { q: "", filters: [], owner: null, direction: null, group: "owner", closed: false, archive: false, sort: null, dir: "asc" };

const QUICK_KEYS = new Set<string>(QUICK_FILTERS.map((f) => f.key));
const GROUPS = new Set<string>(["none", "owner", "direction", "priority", "goal"]);
const SORTS = new Set<string>(["number", "title", "owner", "priority", "status", "due", "updated"]);

/** Разобрать адрес. Чужие и битые значения отбрасываются */
export function parseListParams(params: URLSearchParams): ListParams {
  const filters = (params.get("f") ?? "").split(",").map((s) => s.trim()).filter((s): s is QuickFilter => QUICK_KEYS.has(s));
  const group = params.get("group") ?? "";
  const sort = params.get("sort") ?? "";
  return {
    q: (params.get("q") ?? "").slice(0, 200),
    filters: [...new Set(filters)],
    owner: params.get("owner")?.slice(0, 64) || null,
    direction: params.get("direction")?.slice(0, 64) || null,
    group: GROUPS.has(group) ? (group as GroupBy) : "owner",
    closed: params.get("closed") === "1",
    archive: params.get("archive") === "1",
    sort: SORTS.has(sort) ? (sort as SortKey) : null,
    dir: params.get("dir") === "desc" ? "desc" : "asc",
  };
}

/** Собрать адрес: только то, что отличается от умолчания. Пустая строка значит адрес без параметров */
export function listParamsToQuery(p: ListParams): string {
  const out = new URLSearchParams();
  if (p.q.trim()) out.set("q", p.q.trim());
  if (p.filters.length) out.set("f", p.filters.join(","));
  if (p.owner) out.set("owner", p.owner);
  if (p.direction) out.set("direction", p.direction);
  if (p.group !== "owner") out.set("group", p.group);
  if (p.closed) out.set("closed", "1");
  if (p.archive) out.set("archive", "1");
  if (p.sort) {
    out.set("sort", p.sort);
    if (p.dir !== "asc") out.set("dir", p.dir);
  }
  return out.toString();
}

/** Есть ли что сохранять как вид: любые фильтры или сортировка, кроме архива */
export function hasFilters(p: ListParams): boolean {
  return !!(p.q.trim() || p.filters.length || p.owner || p.direction || p.group !== "owner" || p.closed || p.sort);
}

export function matchesText(task: Task, q: string): boolean {
  if (!q) return true;
  const query = q.toLowerCase().trim();
  if (/^\d+$/.test(query)) return String(task.number) === query || task.title.toLowerCase().includes(query);
  return [task.title, task.outcome, task.where, ownerName(task.owner)].some((s) => s.toLowerCase().includes(query));
}

export function quickPredicate(key: QuickFilter, me: { slug: string; role: Role }, today: IsoDate): (t: Task) => boolean {
  switch (key) {
    case "mine":
      return (t) => isMine(t, me.slug, me.role);
    case "overdue":
      return (t) => isOverdue(t, today);
    case "critical":
      return (t) => t.priority === "critical" && !isClosed(t);
    case "week":
      return (t) => isDueThisWeek(t, today);
    case "blocked":
      return (t) => t.state === "blocked" && !isClosed(t);
    case "stale":
      return (t) => isStale(t, today);
    case "unassigned":
      return (t) => t.owner === "all";
  }
}

/** Отобрать задачи по параметрам. Архив и закрытые решаются здесь же */
export function applyListParams(tasks: Task[], p: ListParams, me: { slug: string; role: Role }, today: IsoDate): Task[] {
  const preds = p.filters.map((f) => quickPredicate(f, me, today));
  return tasks.filter(
    (t) =>
      (p.archive ? t.archived : !t.archived) &&
      (p.archive || p.closed || !isClosed(t)) &&
      (!p.owner || t.owner === p.owner) &&
      (!p.direction || t.direction === p.direction) &&
      matchesText(t, p.q) &&
      preds.every((f) => f(t)),
  );
}

const STATUS_ORDER = ["proposed", "in-progress", "clarify", "partial", "done", "failed", "cancelled"];

/** Сортировка по колонке. Без колонки прежний порядок: просроченные и критичные вперёд, потом по сроку */
export function sortTasks(tasks: Task[], sort: SortKey | null, dir: SortDir, today: IsoDate): Task[] {
  if (!sort) return defaultOrder(tasks, today);
  const sign = dir === "desc" ? -1 : 1;
  const cmp = (a: Task, b: Task): number => {
    switch (sort) {
      case "number":
        return a.number - b.number;
      case "title":
        return a.title.localeCompare(b.title, "ru");
      case "owner":
        return ownerName(a.owner).localeCompare(ownerName(b.owner), "ru");
      case "priority":
        return priorityOf(a.priority).rank - priorityOf(b.priority).rank;
      case "status":
        return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || statusOf(a.status).label.localeCompare(statusOf(b.status).label, "ru");
      case "due":
        return a.due.localeCompare(b.due);
      case "updated":
        return a.updatedAt.localeCompare(b.updatedAt);
    }
  };
  return [...tasks].sort((a, b) => sign * cmp(a, b) || a.number - b.number);
}
