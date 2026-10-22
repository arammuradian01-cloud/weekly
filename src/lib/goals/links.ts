// Задачи к целям перетаскиванием (этап 65). Чистые правила экрана «Связать задачи с целями»: кто меняет цель задачи,
// какая цель подходит задаче, список «Мои задачи» с фильтрами и поиском, группы целей и тексты уведомлений.
// Без обращений к базе: ими пользуются и сервер (права, данные экрана), и экран (что можно тянуть и куда).

import type { StatusCode } from "@/domain/dictionaries";
import type { IsoDate } from "@/domain/dates";
import { plural } from "@/domain/dates";
import type { GoalProgress } from "./progress";

/** Почему задача в списке «Мои задачи»: человек её ведёт, поставил или видел */
export type LinkReason = "owner" | "co" | "author" | "comment" | "mention" | "watch" | "team" | "below";

/** Порядок важности: в строке задачи показывается первая причина */
export const REASON_ORDER: LinkReason[] = ["owner", "co", "author", "comment", "mention", "watch", "team", "below"];

export const REASON_LABEL: Record<LinkReason, string> = {
  owner: "вы ответственный",
  co: "вы соисполнитель",
  author: "вы поставили",
  comment: "вы комментировали",
  mention: "вас упомянули",
  watch: "вы следите",
  team: "задача вашей команды",
  below: "задача команды ниже",
};

/** Кто меняет цель задачи: для подсказок у задач, которые человек привязать не может */
export const WHO_LINKS = "ответственный, соисполнители, тот, кто поставил задачу, руководитель её команды или команды выше и режим управления";

/** Какие цели подходят задаче: одной фразой для подсказок и отказов */
export const WHICH_GOALS = "цели своей команды, команды выше или личные цели её людей, текущего квартала или квартала срока";

/** Группа целей на экране: свои цели, цели своих команд, цели команд ниже (у руководителя), цели команд выше */
export type LinkGoalGroup = "mine" | "team" | "below" | "above";

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
 * Кто меняет цель задачи (этап 17, тем же правилом сервис задач): ответственный, соисполнитель (он тоже занимается
 * задачей, решение после проверки этапа 65), тот, кто поставил задачу, руководитель команды задачи или команды выше
 * и режим управления. Наблюдатель только смотрит. Общий логин без режима управления ничем не руководит (этап 14):
 * там цель меняют только у своих задач
 */
export function canChangeGoal(
  task: { ownerId: string | null; createdById: string | null; teamId: string; coExecutors?: { personId: string }[] },
  who: { personId: string; role: string; management?: string | null },
  scope: { leads: string[] },
): boolean {
  if (who.role === "OBSERVER") return false;
  if (who.management) return true;
  if (scope.leads.includes(task.teamId) || task.ownerId === who.personId || task.createdById === who.personId) return true;
  return !!task.coExecutors?.some((c) => c.personId === who.personId);
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

/** Сколько задач в фильтрах «Без цели» и «Все»: только те, что человек может привязать */
export function filterCounts(tasks: LinkTask[], goalOf: GoalOf = serverGoal): Record<LinkFilter, number> {
  const mine = tasks.filter((t) => t.mine && t.canLink);
  return { nogoal: mine.filter((t) => goalOf(t) === null).length, all: mine.length };
}

/**
 * Список «Мои задачи» по фильтру и поиску: задачи, которые человек может привязать, открытые сверху и закрытые за
 * квартал ниже, и отдельно те, что он только видит (блок «Только посмотреть», по сроку)
 */
export function listTasks(tasks: LinkTask[], filter: LinkFilter, query: string, goalOf: GoalOf = serverGoal): { open: LinkTask[]; closed: LinkTask[]; viewOnly: LinkTask[] } {
  const found = filterTasks(tasks, filter, query, goalOf);
  const { open, closed } = groupTasks(found.filter((t) => t.canLink));
  const viewOnly = found.filter((t) => !t.canLink).sort((a, b) => Number(a.closed) - Number(b.closed) || a.due.localeCompare(b.due) || a.number - b.number);
  return { open, closed, viewOnly };
}

/** Задачи под каждой целью: все задачи экрана, а не только «Мои задачи». Отменённые не считаются и не показываются */
export function tasksByGoal(tasks: LinkTask[], goalOf: GoalOf = serverGoal): Map<string, LinkTask[]> {
  const out = new Map<string, LinkTask[]>();
  for (const t of tasks) {
    const g = goalOf(t);
    if (g && t.status !== "cancelled") out.set(g, [...(out.get(g) ?? []), t]);
  }
  for (const list of out.values()) list.sort((a, b) => Number(a.closed) - Number(b.closed) || a.due.localeCompare(b.due) || a.number - b.number);
  return out;
}

/**
 * Входит ли задача в цифры цели. Одно правило на обеих вкладках страницы «Цели» (таблица, дерево, карточка цели при
 * связывании): отменённые и только предложенные не считаются, закрытыми считаются выполненные. Статус любым регистром:
 * сервер даёт CANCELLED, экран cancelled
 */
export const countsForGoal = (status: string) => !/^(cancelled|proposed)$/i.test(status);
export const doneForGoal = (status: string) => /^done$/i.test(status);

/** Подпись цифр цели одна на обеих вкладках: «закрыто 1 из 3» или «задач пока нет» */
export function goalTasksText(done: number, total: number): string {
  return total ? `закрыто ${done} из ${total}` : "задач пока нет";
}

/** Цифры карточки цели при связывании: из того же списка, что под кнопкой «Задачи», по общему правилу */
export function tallyText(tasks: Pick<LinkTask, "status">[]): string {
  const counted = tasks.filter((t) => countsForGoal(t.status));
  return goalTasksText(counted.filter((t) => doneForGoal(t.status)).length, counted.length);
}

export type GoalGroupView = { key: string; label: string; goals: LinkGoal[] };

/** Группы целей по порядку с сервера: «Мои цели», цели каждой своей команды, команд ниже, «Цели выше» по командам */
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
    else if (g.group === "below") at(`below:${g.team.id}`, `Команды ниже: «${g.team.name}»`).goals.push(g);
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
  if (plan.unfit.length) return `${numbersText(plan.unfit)} не ${plural(plan.unfit.length, "подходит", "подходят", "подходят")} цели «${goal ? goalName(goal) : ""}»: подходят ${WHICH_GOALS}`;
  if (plan.locked.length) return `Нет прав менять цель: её меняют ${WHO_LINKS}`;
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

/**
 * Тост после связи. Получилось у всех: обычный тост. Часть не прошла (ошибка сервера, не подходит цель, нет прав):
 * тост ошибки, где сказано, что получилось и что нет. Задачи, у которых цель уже была такой, считаются успехом
 */
export function linkToast(r: { done: number[]; failed: { number: number; error: string }[]; unfit: number[]; locked: number[] }, goal: { code: string | null; title: string } | null): { text: string; error: boolean } {
  const parts = [
    r.done.length ? linkedText(r.done, goal) : "",
    failedText(r.failed),
    r.unfit.length ? `${numbersText(r.unfit)} не ${plural(r.unfit.length, "подходит", "подходят", "подходят")} ${goal ? `цели «${goalName(goal)}»` : "цели"}` : "",
    r.locked.length ? `Нет прав менять цель: ${numbersText(r.locked).replace(/^З/, "з")}` : "",
  ].filter(Boolean);
  return { text: parts.join(". "), error: r.failed.length + r.unfit.length + r.locked.length > 0 };
}

/**
 * Куда перевести фокус, когда строки задач пропали из списка (привязали при фильтре «Без цели»): на строку после
 * первой пропавшей, иначе на ближайшую выше. null: строк не осталось, фокус на заголовок «Мои задачи»
 */
export function focusAfter(visible: number[], removed: number[]): number | null {
  const gone = new Set(removed);
  const first = visible.findIndex((n) => gone.has(n));
  if (first < 0) return null;
  const after = visible.slice(first + 1).find((n) => !gone.has(n));
  if (after !== undefined) return after;
  const before = visible.slice(0, first).reverse().find((n) => !gone.has(n));
  return before ?? null;
}

/**
 * Какие задачи тянутся: отмеченные и видимые на экране, если тянут одну из них, иначе одна эта задача. Отмеченные,
 * которые сейчас скрыты поиском или фильтром, незаметно не уезжают
 */
export function dragSet(number: number, fromList: boolean, selectedVisible: number[]): number[] {
  return fromList && selectedVisible.includes(number) && selectedVisible.length > 1 ? selectedVisible : [number];
}

/**
 * Автопрокрутка закреплённой колонки целей, пока задачу тянут: курсор у верхнего края колонки крутит её вверх, у
 * нижнего вниз, тем быстрее, чем ближе к краю. Возвращает сдвиг в точках за кадр (0: курсор не у края)
 */
export function edgeStep(y: number, top: number, bottom: number, zone = 56, max = 18): number {
  if (bottom - top < zone * 2) return 0;
  if (y >= top && y < top + zone) return -Math.ceil(max * (1 - (y - top) / zone));
  if (y <= bottom && y > bottom - zone) return Math.ceil(max * (1 - (bottom - y) / zone));
  return 0;
}

/**
 * Автопрокрутка у краёв закреплённой колонки целей за кадр (ноутбук). Края по видимой части колонки. Низ колонки за
 * краем окна (страницу ещё не прокрутили): у нижнего края сначала едет окно, и только пока колонка не покажется
 * целиком; дальше крутится сама колонка, если ей есть куда. Дальше окно не едет: закреплённой колонке это ничего не
 * даёт, а цели уезжали бы из-под курсора. page: сдвиг окна, column: сдвиг колонки, в точках
 */
export function edgeScroll(
  pointer: { x: number; y: number },
  rect: { top: number; bottom: number; left: number; right: number },
  viewport: number,
  scrollable: boolean,
): { page: number; column: number } {
  if (pointer.x < rect.left || pointer.x > rect.right) return { page: 0, column: 0 };
  const step = edgeStep(pointer.y, Math.max(rect.top, 0), Math.min(rect.bottom, viewport));
  // Доли точки не в счёт: у самого низа страницы окну их не докрутить, и колонка так и не крутилась бы
  const hidden = Math.floor(rect.bottom - viewport);
  if (step > 0 && hidden > 0) return { page: Math.min(step, hidden), column: 0 };
  return { page: 0, column: scrollable ? step : 0 };
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
