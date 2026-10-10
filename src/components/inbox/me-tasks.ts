// Правила очереди «Мне» (этап 44): мои задачи, просроченные и со сроком сегодня или завтра, и просьбы ко мне по группам
// срочности. Считаются на экране, событий не требуют. Одни функции для строки цифр и для очереди, чтобы числа и строки
// совпадали. Без React и серверных модулей, чтобы покрывались юнит-тестами

import { addDays } from "@/domain/dates";
import { isMine, isOverdue } from "@/domain/rules";
import { currentDue, type RequestView } from "@/domain/requests";
import type { Person, Task } from "@/domain/types";
import type { AppData } from "@/domain/store";

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
  const late = incoming.filter((r) => r.overdue);
  const soon = incoming.filter((r) => !r.overdue && r.status === "accepted" && currentDue(r) <= tomorrow);
  // Открытая просьба ждёт ответа и при близком сроке: действие одно, ответить
  const answer = incoming.filter((r) => !r.overdue && r.status === "open");
  const later = incoming.filter((r) => !r.overdue && r.status === "accepted" && currentDue(r) > tomorrow);
  return { late, soon, answer, later };
}
