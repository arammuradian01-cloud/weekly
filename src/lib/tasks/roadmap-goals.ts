// Roadmap по целям (этап 77). Просьба Арама 23.10: делить roadmap по целям, по задачам и по целям и задачам вместе.
//
// Группировка «По задачам» как раньше: строки направлений. «По целям»: строки это цели квартала выбранной команды
// (и цели выше или другого квартала, если на них работают задачи на roadmap). Полоса цели на карте сроков идёт от
// начала первой её открытой задачи до самого позднего срока; у цели без задач от начала до конца квартала, пунктиром.
// На доске цель стоит в месяце самого позднего срока. «Цели и задачи»: под каждой целью её открытые задачи, последней
// группой «Задачи без цели».
//
// Здесь только расчёт: группы, полосы целей и столбец цели на доске. Задачи те же, что на roadmap: открытые, с теми же
// фильтрами «Чьи задачи» и «Только важные».

import type { IsoDate } from "@/domain/dates";
import type { PersonSlug, Task } from "@/domain/types";
import type { GoalResult } from "@/lib/goals/parse";
import type { GoalProgress } from "@/lib/goals/progress";
import { importanceOf, periodOf, roadmapTasks, type Period, type PeriodKey, type RoadmapFilter } from "./roadmap";
import { barOf, byStart, placeOf, startOf, timelineRange, type Bar, type Place, type TimelineRange } from "./timeline";

export type RoadmapGroupBy = "tasks" | "goals" | "both";

/**
 * Группировка из адреса (?group=tasks|both). Этап 84: по умолчанию «По целям»: карта сроков начинается со строк
 * целей, задачи под целью раскрываются нажатием. «Цели и задачи» это то же самое, только сразу раскрытое
 */
export const groupByOf = (value: string | null | undefined): RoadmapGroupBy => (value === "tasks" || value === "both" ? value : "goals");

/** Цель в строке roadmap: код, название, статус и прогресс как на экране «Цели», без истории фактов и описания */
export type RoadmapGoal = {
  id: string;
  code: string | null;
  title: string;
  quarter: string;
  team: { id: string; name: string } | null;
  owner: { slug: PersonSlug; fullName: string } | null;
  result: GoalResult;
  risk: string | null;
  progress: { done: number; total: number; overdue: number };
  numeric: GoalProgress | null;
  fact: string | null;
  base: string | null;
  target: string | null;
  metric: string | null;
  /** Цель выбранной команды на текущий квартал: видна и без задач. Иначе цель выше, на которую работают задачи команды */
  own: boolean;
  /** false: цели нет среди целей с сервера (другой квартал или чужая команда), строка собрана из метки задачи без статуса */
  known: boolean;
};

const QUARTER = /^(\d{4})-Q([1-4])$/;

/** Первый и последний день квартала «2026-Q4» */
export function quarterSpan(quarter: string): { start: IsoDate; end: IsoDate } | null {
  const m = QUARTER.exec(quarter);
  if (!m) return null;
  const year = Number(m[1]);
  const first = (Number(m[2]) - 1) * 3 + 1;
  const last = first + 2;
  const days = new Date(Date.UTC(year, last, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { start: `${year}-${pad(first)}-01`, end: `${year}-${pad(last)}-${pad(days)}` };
}

/**
 * Цель уже сдвинулась с места: закрыта хотя бы одна её задача или по числам пройден кусок пути. Этап 84: у такой
 * цели без задач на roadmap не пишем «задач нет», это неправда (задачи могут висеть на целях ниже)
 */
export function goalMoved(goal: Pick<RoadmapGoal, "known" | "progress" | "numeric" | "fact" | "result">): boolean {
  if (!goal.known) return false;
  if (goal.result !== "IN_PROGRESS") return true;
  if (goal.progress.done > 0) return true;
  return !!goal.numeric && goal.numeric.share > 0;
}

/**
 * Цель снята или итог уже подведён не в пользу цели: впереди у неё срока нет. Этап 84: полосу пунктиром до конца
 * квартала такой цели не рисуем
 */
export function goalClosed(goal: Pick<RoadmapGoal, "known" | "result">): boolean {
  return goal.known && (goal.result === "DROPPED" || goal.result === "MISSED" || goal.result === "PARTIAL");
}

export type GoalGroup = {
  goal: RoadmapGoal;
  /** Открытые задачи цели после фильтров: по началу, потом по сроку и номеру */
  tasks: Task[];
  /** Полоса цели: от начала первой задачи до самого позднего срока. Без задач: квартал цели */
  span: { start: IsoDate; end: IsoDate };
  /** Задач нет: полоса до конца квартала, рисуется пунктиром */
  empty: boolean;
  /**
   * Этап 84: у цели нет ни задач на roadmap, ни продвижения. Задачи цели могут висеть на целях ниже, и тогда
   * «задач нет» вводит в заблуждение: писать так только при нулевом прогрессе
   */
  blank: boolean;
  /** Этап 84: цель снята или не достигнута, срока впереди у неё нет: полосу до конца квартала не рисуем */
  closed: boolean;
  important: number;
  overdue: number;
};

export type GoalGroups = {
  goals: GoalGroup[];
  /** Открытые задачи без цели после фильтров */
  noGoal: Task[];
  total: number;
  important: number;
  overdue: number;
};

/** Название без кода в начале: метка задачи хранит «РТ-1. Название» */
const bareTitle = (title: string, code?: string | null) => (code && title.startsWith(`${code}. `) ? title.slice(code.length + 2) : title);

/** Цель из метки задачи, если её нет среди целей с сервера: без статуса и прогресса */
function fromTask(goal: NonNullable<Task["goal"]>, fallbackQuarter: string): RoadmapGoal {
  return {
    id: goal.id,
    code: goal.code ?? null,
    title: bareTitle(goal.title, goal.code),
    quarter: goal.quarter ?? fallbackQuarter,
    team: null,
    owner: null,
    result: "IN_PROGRESS",
    risk: null,
    progress: { done: 0, total: 0, overdue: 0 },
    numeric: null,
    fact: null,
    base: null,
    target: null,
    metric: null,
    own: false,
    known: false,
  };
}

const byStartDue = (a: Task, b: Task) => startOf(a).date.localeCompare(startOf(b).date) || a.due.localeCompare(b.due) || a.number - b.number;

/**
 * Группы целей. Цели своей команды идут в порядке с сервера (как на экране «Цели»), за ними цели выше и других
 * кварталов, на которые работают задачи. Своя цель видна и без задач; когда включён фильтр «Чьи задачи» или «Только
 * важные», остаются цели с подходящими задачами и цели выбранного человека. Чужая цель видна, только если на неё
 * работают задачи на roadmap: иначе её место на экране «Цели»
 */
export function buildGoalGroups(tasks: Task[], goals: RoadmapGoal[], today: IsoDate, filter: RoadmapFilter): GoalGroups {
  const picked = roadmapTasks(tasks, filter);
  const filtered = !!filter.person || filter.onlyImportant;
  const byGoal = new Map<string, Task[]>();
  const noGoal: Task[] = [];
  for (const t of picked) {
    if (!t.goal) {
      noGoal.push(t);
      continue;
    }
    const list = byGoal.get(t.goal.id);
    if (list) list.push(t);
    else byGoal.set(t.goal.id, [t]);
  }
  const known = new Map(goals.map((g) => [g.id, g]));
  const fallbackQuarter = goals.find((g) => g.own)?.quarter ?? "";
  // Цели, которых нет среди целей с сервера, собираются из меток задач: по коду, потом по названию
  const unknown = [...byGoal.entries()]
    .filter(([id]) => !known.has(id))
    .map(([, list]) => fromTask(list[0]!.goal!, fallbackQuarter))
    .sort((a, b) => (a.code ?? "￿").localeCompare(b.code ?? "￿", "ru", { numeric: true }) || a.title.localeCompare(b.title, "ru"));
  const ordered = [...goals.filter((g) => g.own), ...goals.filter((g) => !g.own), ...unknown];

  const groups: GoalGroup[] = [];
  for (const goal of ordered) {
    const list = (byGoal.get(goal.id) ?? []).slice().sort(byStartDue);
    const visible = list.length > 0 || (goal.own && (!filtered || (!!filter.person && goal.owner?.slug === filter.person)));
    if (!visible) continue;
    let span: { start: IsoDate; end: IsoDate };
    if (list.length) {
      const start = list.map((t) => startOf(t).date).reduce((a, b) => (b < a ? b : a));
      const end = list.map((t) => t.due).reduce((a, b) => (b > a ? b : a));
      span = { start, end };
    } else {
      span = quarterSpan(goal.quarter) ?? { start: today, end: today };
    }
    groups.push({
      goal,
      tasks: list,
      span,
      empty: list.length === 0,
      blank: list.length === 0 && !goalMoved(goal),
      closed: goalClosed(goal),
      important: list.filter((t) => importanceOf(t.priority) > 0).length,
      overdue: list.filter((t) => periodOf(t, today) === "overdue").length,
    });
  }

  return {
    goals: groups,
    noGoal: noGoal.sort(byStartDue),
    total: picked.length,
    important: picked.filter((t) => importanceOf(t.priority) > 0).length,
    overdue: picked.filter((t) => periodOf(t, today) === "overdue").length,
  };
}

/**
 * Столбец цели на доске: месяц самого позднего срока её задач. Просрочено, если самый поздний срок прошёл и задача
 * с этим сроком не предложенная. Цель без задач в месяце конца квартала
 */
export function goalPeriodOf(group: Pick<GoalGroup, "tasks" | "span" | "empty">, today: IsoDate, periods: Period[]): PeriodKey {
  if (group.empty) return periodOf({ due: group.span.end, status: "in-progress" }, today, periods);
  const last = group.tasks.filter((t) => t.due === group.span.end);
  const status = last.length && last.every((t) => t.status === "proposed") ? "proposed" : "in-progress";
  return periodOf({ due: group.span.end, status }, today, periods);
}

/**
 * Полоса цели на карте сроков: положение отрезка, даты и признаки. empty: задач на roadmap нет, полоса до конца
 * квартала пунктиром. blank: к тому же нет и продвижения, только тогда подпись «задач нет». hidden: цель снята или
 * не достигнута и задач нет, полосы не рисуем совсем (этап 84)
 */
export type GoalLine = Place & { start: IsoDate; end: IsoDate; empty: boolean; blank: boolean; hidden: boolean; late: boolean };

export function goalLineOf(group: Pick<GoalGroup, "tasks" | "span" | "empty" | "blank" | "closed">, range: TimelineRange, today: IsoDate): GoalLine {
  const late = !group.empty && group.span.end < today && group.tasks.some((t) => t.due === group.span.end && t.status !== "proposed");
  return { ...placeOf(range, group.span.start, group.span.end), start: group.span.start, end: group.span.end, empty: group.empty, blank: group.blank, hidden: group.empty && group.closed, late };
}

export type GoalTimelineRow = { group: GoalGroup; line: GoalLine; bars: Bar[] };

/** Карта сроков по целям: строка цели с её полосой и полосы её задач; задачи без цели отдельно */
export function buildGoalTimeline(groups: GoalGroups, today: IsoDate, range: TimelineRange = timelineRange(today)): { range: TimelineRange; goals: GoalTimelineRow[]; noGoal: Bar[] } {
  return {
    range,
    goals: groups.goals.map((group) => ({ group, line: goalLineOf(group, range, today), bars: group.tasks.map((t) => barOf(t, range, today)).sort(byStart) })),
    noGoal: groups.noGoal.map((t) => barOf(t, range, today)).sort(byStart),
  };
}
