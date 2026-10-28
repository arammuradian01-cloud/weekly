// Подсказка по задаче на карте сроков (этап 84). На карте название обрезано по ширине колонки, а описание не видно
// совсем: при наведении на полосу или на строку задачи, без открытия карточки, показывается полный текст.
// Здесь только сборка текста: что в заголовке, что описанием и какие строки под ним.

import type { Task } from "@/domain/types";
import { formatShort, plural, type IsoDate } from "@/domain/dates";
import { ownerName } from "@/domain/people";
import { statusOf, stateLabel } from "@/domain/dictionaries";
import { isOverdue, overdueDays } from "./rules";
import { IMPORTANCE_LABEL, importanceOf, proposedLate } from "./roadmap";

export type TaskTipRow = { label: string; text: string };

export type TaskTip = {
  /** «412. Полное название задачи» */
  title: string;
  /** Описание задачи: ожидаемый результат. Нет текста: null */
  description: string | null;
  /** Строки под описанием: срок, состояние, ответственный, где сейчас */
  rows: TaskTipRow[];
  /** Тот же текст одной строкой: его читает диктор */
  speech: string;
};

/** Текст без лишних пробелов и переводов строк: в подсказке он идёт одним куском */
const clean = (s: string | undefined | null) => (s ?? "").replace(/\s+/g, " ").trim();

/** Срок словами: «с 12 окт. до 25 окт.», у просроченной с числом дней */
function dueText(task: Task, today: IsoDate): string {
  const head = task.start ? `с ${formatShort(task.start)} до ${formatShort(task.due)}` : `до ${formatShort(task.due)}`;
  if (!isOverdue(task, today)) return head;
  const days = overdueDays(task, today);
  return `${head}, просрочена на ${days} ${plural(days, "день", "дня", "дней")}`;
}

/** Состояние словами: статус, а к нему риск или блокировка и отметка «предложена» */
function stateText(task: Task): string {
  const parts = [statusOf(task.status).label];
  if (task.state === "at-risk" || task.state === "blocked") parts.push(stateLabel(task.state).toLowerCase());
  const mark = importanceOf(task.priority);
  if (mark) parts.push(IMPORTANCE_LABEL[mark].toLowerCase());
  return parts.join(", ");
}

/** Текст подсказки по задаче: заголовок, описание и строки под ним */
export function taskTip(task: Task, today: IsoDate): TaskTip {
  const title = `${task.number}. ${clean(task.title)}`;
  const description = clean(task.outcome) || null;
  const rows: TaskTipRow[] = [{ label: "Срок", text: dueText(task, today) }, { label: "Состояние", text: stateText(task) }];
  if (task.status === "proposed" && proposedLate(task, today)) rows.push({ label: "Предложена", text: "срок уже прошёл" });
  if (task.state === "blocked" && clean(task.blockedBy)) rows.push({ label: "Чем заблокирована", text: clean(task.blockedBy) });
  if (task.state === "at-risk" && clean(task.riskNote)) rows.push({ label: "Что вернёт в график", text: clean(task.riskNote) });
  rows.push({ label: "Ответственный", text: ownerName(task.owner) });
  if (clean(task.where)) rows.push({ label: "Где сейчас", text: clean(task.where) });
  const speech = [title, description, ...rows.map((r) => `${r.label}: ${r.text}`)].filter(Boolean).join(". ");
  return { title, description, rows, speech };
}
