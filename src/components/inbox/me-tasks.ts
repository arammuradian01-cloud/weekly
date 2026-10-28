// Правила очереди «Ждёт вас» (этап 44 как раздел «Мне», с этапа 76 блок на «Моей неделе»): мои задачи, просроченные
// и со сроком сегодня или завтра, и просьбы ко мне по группам срочности. Считаются на экране, событий не требуют. Одни
// функции для счётчиков и для очереди, чтобы числа и строки совпадали. Без React и серверных модулей, чтобы покрывались
// юнит-тестами

import { addDays, plural } from "@/domain/dates";
import { isMine, isOverdue } from "@/domain/rules";
import { currentDue, type RequestView } from "@/domain/requests";
import type { Person, Task } from "@/domain/types";
import type { AppData } from "@/domain/store";
import type { InboxKind } from "@/generated/prisma/enums";

export type HotTasks = { late: Task[]; soon: Task[] };

export function hotTasks(data: Pick<AppData, "tasks" | "today">, me: Pick<Person, "slug" | "role">): HotTasks {
  const tomorrow = addDays(data.today, 1);
  const open = data.tasks.filter((t) => !t.archived && isMine(t, me.slug, me.role) && ["in-progress", "clarify", "proposed"].includes(t.status));
  const byDue = (a: Task, b: Task) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.number - b.number);
  // Срок прошёл и у предложенной задачи: «срок завтра» про неё было бы неправдой
  const late = open.filter((t) => isOverdue(t, data.today) || t.due < data.today).sort(byDue);
  const soon = open.filter((t) => !isOverdue(t, data.today) && t.due >= data.today && t.due <= tomorrow).sort(byDue);
  return { late, soon };
}

/** Просьбы ко мне по срочности: срок прошёл, принятые на сегодня или завтра, без ответа, принятые на потом */
export function splitRequests(incoming: RequestView[], today: string) {
  const tomorrow = addDays(today, 1);
  // Срок прошёл по оценке сервера или по дате на экране: страница могла быть открыта до полуночи
  const isLate = (r: RequestView) => r.overdue || currentDue(r) < today;
  const late = incoming.filter(isLate);
  const soon = incoming.filter((r) => !isLate(r) && r.status === "accepted" && currentDue(r) <= tomorrow);
  // Открытая просьба ждёт ответа и при близком сроке: действие одно, ответить
  const answer = incoming.filter((r) => !isLate(r) && r.status === "open");
  const later = incoming.filter((r) => !isLate(r) && r.status === "accepted" && currentDue(r) > tomorrow);
  return { late, soon, answer, later };
}

/**
 * Тихие события (этап 60): дайджест новостей виден в очереди строкой, но не ждёт ответа. Его нет ни в счётчике меню,
 * ни в числе над очередью. Живёт здесь, а не в серверном модуле очереди: число считают и браузер, и сервер
 */
export const QUIET_KINDS: InboxKind[] = ["NEWS"];

/**
 * События без тех, что дублируют строку очереди выше: просьбу, уже показанную своей строкой, и задачу из групп
 * «Срок прошёл» и «Сегодня и завтра» (правка по ревью этапа 76: иначе одна задача считалась дважды)
 */
export function withoutShownEvents<T extends { requestNumber: number | null; taskNumber: number | null }>(
  items: T[],
  incoming: Pick<RequestView, "number">[],
  tasks: HotTasks,
): T[] {
  const requests = new Set(incoming.map((r) => r.number));
  const shownTasks = new Set([...tasks.late, ...tasks.soon].map((t) => t.number));
  return items.filter((i) => !(i.requestNumber !== null && requests.has(i.requestNumber)) && !(i.taskNumber !== null && shownTasks.has(i.taskNumber)));
}

/**
 * События, спрятанные из группы «Прочитать» как повтор строки задачи, по её номеру. Текст у них остаётся важным
 * («Просят обновить задачу: где сейчас, состояние и срок»), поэтому строка задачи показывает его подписью:
 * строка одна и считается один раз, а сказанное не пропадает
 */
export function notesByTask<T extends { requestNumber: number | null; taskNumber: number | null; text: string }>(
  items: T[],
  tasks: HotTasks,
): Map<number, { text: string; more: number }> {
  const shownTasks = new Set([...tasks.late, ...tasks.soon].map((t) => t.number));
  const notes = new Map<number, { text: string; more: number }>();
  for (const i of items) {
    if (i.requestNumber !== null || i.taskNumber === null || !shownTasks.has(i.taskNumber)) continue;
    const note = notes.get(i.taskNumber);
    if (note) note.more += 1;
    else notes.set(i.taskNumber, { text: i.text, more: 0 });
  }
  return notes;
}

/** Сколько событий ждут ответа: без тихих и без тех, что уже стоят строкой выше */
export function eventCount<T extends { requestNumber: number | null; taskNumber: number | null; kind: InboxKind }>(
  items: T[],
  incoming: Pick<RequestView, "number">[],
  tasks: HotTasks,
): number {
  return withoutShownEvents(items, incoming, tasks).filter((i) => !QUIET_KINDS.includes(i.kind)).length;
}

/** Строк в группе очереди до кнопки «Показать все»: очередь живёт на главной и не должна вытеснять остальное (этап 76) */
export const QUEUE_GROUP_LIMIT = 5;

/** Якоря групп очереди. Те же, что были у раздела «Мне»: старые ссылки /me#me-late ведут к той же группе */
export const QUEUE_GROUPS = { late: "me-late", soon: "me-soon", answer: "me-answer", read: "me-read", later: "me-later" } as const;

export type QueueCounts = { late: number; soon: number; answer: number; events: number };

/** Числа групп: задачи и просьбы вместе, как строки в группах. events: события без тихих (дайджест новостей) */
export function queueCounts(tasks: HotTasks, req: ReturnType<typeof splitRequests>, events: number): QueueCounts {
  return { late: tasks.late.length + req.late.length, soon: tasks.soon.length + req.soon.length, answer: req.answer.length, events };
}

export type QueueFigure = { key: keyof QueueCounts; n: number; label: string; href: string; tone: "danger" | "warning" | "info" | "neutral" };

/**
 * Счётчики над очередью «Ждёт вас» на «Моей неделе» (этап 68, с этапа 76 на той же странице): каждый ведёт якорем
 * к своей группе ниже. Нули не показываются
 */
/**
 * Число в заголовке блока «Ждёт вас» и в счётчике меню (правка по ревью этапа 76: раньше это были разные величины).
 * Несданные weekly за прошлые недели считаются здесь же: иначе красная строка сверху не попадала вообще ни в один счёт
 */
export function attentionTotal(n: QueueCounts, missed = 0): number {
  return n.late + n.soon + n.answer + n.events + missed;
}

export function queueFigures(n: QueueCounts): QueueFigure[] {
  const all: QueueFigure[] = [
    { key: "late", n: n.late, label: "срок прошёл", href: `#${QUEUE_GROUPS.late}`, tone: "danger" },
    { key: "soon", n: n.soon, label: "сегодня и завтра", href: `#${QUEUE_GROUPS.soon}`, tone: "warning" },
    { key: "answer", n: n.answer, label: plural(n.answer, "просьба без ответа", "просьбы без ответа", "просьб без ответа"), href: `#${QUEUE_GROUPS.answer}`, tone: "info" },
    { key: "events", n: n.events, label: plural(n.events, "новое событие", "новых события", "новых событий"), href: `#${QUEUE_GROUPS.read}`, tone: "neutral" },
  ];
  return all.filter((f) => f.n > 0);
}
