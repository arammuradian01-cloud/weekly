// Задачи к целям перетаскиванием (этап 65). Чистые правила экрана «Связать задачи с целями»: кто меняет цель задачи,
// какая цель подходит задаче, список «Мои задачи» с фильтрами и поиском, группы целей и тексты уведомлений.
// Без обращений к базе: ими пользуются и сервер (права, данные экрана), и экран (что можно тянуть и куда).

import type { StatusCode } from "@/domain/dictionaries";
import type { IsoDate } from "@/domain/dates";
import { plural } from "@/domain/dates";
import type { GoalProgress } from "./progress";

/** Почему задача в списке «Мои задачи»: человек её ведёт, поставил или видел */
export type LinkReason = "owner" | "co" | "author" | "comment" | "mention" | "watch" | "team";

/** Порядок важности: в строке задачи показывается первая причина */
export const REASON_ORDER: LinkReason[] = ["owner", "co", "author", "comment", "mention", "watch", "team"];

export const REASON_LABEL: Record<LinkReason, string> = {
  owner: "вы ответственный",
  co: "вы соисполнитель",
  author: "вы поставили",
  comment: "вы комментировали",
  mention: "вас упомянули",
  watch: "вы следите",
  team: "задача вашей команды",
};

/** Группа целей на экране: свои цели, цели своих команд, цели команд выше */
export type LinkGoalGroup = "mine" | "team" | "above";

export type LinkGoal = {
  id: string;
  code: string | null;
  title: string;
  quarter: string;
  team: { id: string; name: string };
  owner: string | null;
  group: LinkGoalGroup;
  /** Итог квартала, если цель уже не идёт: «Достигнута», «Частично» */
  result: string | null;
  /** Задачи самой цели: сколько закрыто из скольких (без отменённых и предложенных) */
  progress: { done: number; total: number };
  fact: string | null;
  target: string | null;
  numeric: GoalProgress | null;
  /** Цель из борда лидера: чья она (слаг владельца), иначе null */
  boardOwner: string | null;
  /** Личная цель человека, а не цель руководителя команды: подходит только задачам этого человека */
  personal: boolean;
};

export type LinkTask = {
  number: number;
  title: string;
  status: StatusCode;
  closed: boolean;
  due: IsoDate;
  closedAt: IsoDate | null;
  owner: string;
  team: { id: string; name: string };
  goal: { id: string; title: string; code: string | null; quarter: string } | null;
  /** В списке «Мои задачи»: человек ведёт её или видел. Остальные задачи показываются только под своей целью */
  mine: boolean;
  reasons: LinkReason[];
  /** Может ли человек менять цель этой задачи */
  canLink: boolean;
  /** Команда задачи и команды выше: их цели задаче подходят */
  chain: string[];
  /** Слаги ответственного и соисполнителей: их личные цели задаче подходят */
  people: string[];
  /** Кварталы, цели которых подходят: текущий и квартал срока */
  quarters: string[];
};

/**
 * Кто меняет цель задачи (этап 17, тем же правилом сервис задач): ответственный, тот, кто поставил задачу, руководитель
 * команды задачи или команды выше и режим управления. Наблюдатель только смотрит. Общий логин без режима управления
 * ничем не руководит (этап 14): там цель меняют только у своих задач
 */
export function canChangeGoal(
  task: { ownerId: string | null; createdById: string | null; teamId: string },
  who: { personId: string; role: string; management?: string | null },
  scope: { leads: string[] },
): boolean {
  if (who.role === "OBSERVER") return false;
  if (who.management) return true;
  return scope.leads.includes(task.teamId) || task.ownerId === who.personId || task.createdById === who.personId;
}

/**
 * Подходит ли цель задаче: то же правило, что проверяет сервер (goalFits и квартал). Личная цель из борда лидера
 * подходит, пока её владелец в задаче; цель команды задачи или команды выше подходит, если это не чужая личная цель
 */
export function goalFitsTask(goal: Pick<LinkGoal, "team" | "quarter" | "boardOwner" | "personal">, task: Pick<LinkTask, "chain" | "people" | "quarters">): boolean {
  if (!task.quarters.includes(goal.quarter)) return false;
  if (goal.boardOwner && task.people.includes(goal.boardOwner)) return true;
  return task.chain.includes(goal.team.id) && !goal.personal;
}

/** Даты квартала «2026-Q4»: первый день и первый день следующего квартала (не входит) */
export function quarterRange(quarter: string): { start: IsoDate; end: IsoDate } | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!m) return null;
  const y = Number(m[1]);
  const q = Number(m[2]);
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${y}-${pad((q - 1) * 3 + 1)}-01`;
  const end = q === 4 ? `${y + 1}-01-01` : `${y}-${pad(q * 3 + 1)}-01`;
  return { start, end };
}

/** Строка для поиска: регистр и ё не важны */
const key = (text: string) => text.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/** Подходит ли задача под поиск: номер целиком или каждое слово запроса в названии, ответственном, команде или цели */
export function matchTask(task: Pick<LinkTask, "number" | "title" | "owner" | "team" | "goal">, query: string): boolean {
  const q = key(query);
  if (!q) return true;
  if (/^\d+$/.test(q)) return String(task.number) === q || key(task.title).includes(q);
  const hay = key(`${task.number} ${task.title} ${task.owner} ${task.team.name} ${task.goal?.code ?? ""} ${task.goal?.title ?? ""}`);
  return q.split(" ").every((w) => hay.includes(w));
}

export type LinkFilter = "nogoal" | "all";

/** Цель задачи с учётом правок, которые ещё не пришли с сервера */
export type GoalOf = (task: LinkTask) => string | null;

export const serverGoal: GoalOf = (t) => t.goal?.id ?? null;

/** «Мои задачи» по фильтру и поиску: «Без цели» прячет задачи с целью */
export function filterTasks(tasks: LinkTask[], filter: LinkFilter, query: string, goalOf: GoalOf = serverGoal): LinkTask[] {
  return tasks.filter((t) => t.mine && (filter === "all" || goalOf(t) === null) && matchTask(t, query));
}

/** Открытые сверху по сроку, ниже закрытые за квартал, свежие первыми */
export function groupTasks(tasks: LinkTask[]): { open: LinkTask[]; closed: LinkTask[] } {
  const open = tasks.filter((t) => !t.closed).sort((a, b) => a.due.localeCompare(b.due) || a.number - b.number);
  const closed = tasks.filter((t) => t.closed).sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "") || b.number - a.number);
  return { open, closed };
}

/** Сколько задач в фильтрах: для счётчиков «Без цели» и «Все» */
export function filterCounts(tasks: LinkTask[], goalOf: GoalOf = serverGoal): Record<LinkFilter, number> {
  const mine = tasks.filter((t) => t.mine);
  return { nogoal: mine.filter((t) => goalOf(t) === null).length, all: mine.length };
}

/** Задачи под каждой целью: все задачи экрана, а не только «Мои задачи» */
export function tasksByGoal(tasks: LinkTask[], goalOf: GoalOf = serverGoal): Map<string, LinkTask[]> {
  const out = new Map<string, LinkTask[]>();
  for (const t of tasks) {
    const g = goalOf(t);
    if (g) out.set(g, [...(out.get(g) ?? []), t]);
  }
  for (const list of out.values()) list.sort((a, b) => Number(a.closed) - Number(b.closed) || a.due.localeCompare(b.due) || a.number - b.number);
  return out;
}

export type GoalGroupView = { key: string; label: string; goals: LinkGoal[] };

/** Группы целей по порядку с сервера: «Мои цели», цели каждой своей команды, «Цели выше» по командам */
export function groupGoals(goals: LinkGoal[]): GoalGroupView[] {
  const out: GoalGroupView[] = [];
  const at = (k: string, label: string) => {
    let g = out.find((x) => x.key === k);
    if (!g) {
      g = { key: k, label, goals: [] };
      out.push(g);
    }
    return g;
  };
  for (const g of goals) {
    if (g.group === "mine") at("mine", "Мои цели").goals.push(g);
    else if (g.group === "team") at(`team:${g.team.id}`, `Команда «${g.team.name}»`).goals.push(g);
    else at(`above:${g.team.id}`, `Цели выше: «${g.team.name}»`).goals.push(g);
  }
  return out;
}

/** Название цели с кодом: «D1. Маржа департамента» */
export const goalName = (g: { code: string | null; title: string }) => (g.code && !g.title.startsWith(`${g.code}. `) ? `${g.code}. ${g.title}` : g.title);

/**
 * Что сделает перетаскивание или выбор цели для отмеченных задач. move: эти задачи меняют цель. same: уже у этой цели.
 * locked: цель этой задачи человек не меняет. unfit: цель не подходит задаче (другая команда, другой квартал)
 */
export function planLink(tasks: LinkTask[], goal: LinkGoal | null, goalOf: GoalOf = serverGoal): { move: number[]; same: number[]; locked: number[]; unfit: number[] } {
  const out = { move: [] as number[], same: [] as number[], locked: [] as number[], unfit: [] as number[] };
  for (const t of tasks) {
    if (!t.canLink) out.locked.push(t.number);
    else if (goalOf(t) === (goal?.id ?? null)) out.same.push(t.number);
    else if (goal && !goalFitsTask(goal, t)) out.unfit.push(t.number);
    else out.move.push(t.number);
  }
  return out;
}

/** Почему ничего не изменилось: текст уведомления, когда двигать нечего */
export function nothingToMove(plan: ReturnType<typeof planLink>, goal: LinkGoal | null): string {
  if (plan.unfit.length) return `${numbersText(plan.unfit)} не ${plural(plan.unfit.length, "подходит", "подходят", "подходят")} цели «${goal ? goalName(goal) : ""}»: задачу привязывают к цели своей команды, команды выше или к личной цели её людей на квартал срока`;
  if (plan.locked.length) return "Цель задачи меняют её ответственный, тот, кто поставил задачу, руководитель команды и режим управления";
  return goal ? `Задача уже работает на цель «${goalName(goal)}»` : "У задачи и так нет цели";
}

/**
 * Перетаскивание с клавиатуры: стрелка вниз или вправо ведёт к следующей цели, вверх или влево к предыдущей, по порядку
 * на экране. at: где задача сейчас (-1: ещё ни над чем). Возвращает номер цели в списке, у краёв списка стоит на месте
 */
export function stepTarget(count: number, at: number, forward: boolean): number {
  if (count <= 0) return -1;
  if (at < 0 || at >= count) return forward ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, at + (forward ? 1 : -1)));
}

/** «Задача 12» или «Задачи 12, 15 и 17» */
export function numbersText(numbers: number[]): string {
  if (numbers.length === 1) return `Задача ${numbers[0]}`;
  const head = numbers.slice(0, -1).join(", ");
  return `Задачи ${head} и ${numbers[numbers.length - 1]}`;
}

/** Тост после связи: «Задача 12 привязана к цели «D1. Маржа»», «3 задачи отвязаны от цели» */
export function linkedText(numbers: number[], goal: { code: string | null; title: string } | null): string {
  const n = numbers.length;
  const subject = n === 1 ? `Задача ${numbers[0]}` : `${n} ${plural(n, "задача", "задачи", "задач")}`;
  if (!goal) return `${subject} ${n === 1 ? "отвязана" : plural(n, "отвязана", "отвязаны", "отвязаны")} от цели`;
  return `${subject} ${n === 1 ? "привязана" : plural(n, "привязана", "привязаны", "привязаны")} к цели «${goalName(goal)}»`;
}

/** Хвост тоста, если часть задач не прошла: «Не получилось: 15 (причина)» */
export function failedText(failed: { number: number; error: string }[]): string {
  if (!failed.length) return "";
  const first = failed[0]!;
  return `Не получилось с ${failed.length === 1 ? `задачей ${first.number}` : `задачами ${failed.map((f) => f.number).join(", ")}`}: ${first.error}`;
}
