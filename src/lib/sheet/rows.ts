// Строки вкладок ресурса в Google-таблице, собранные из базы (раздел 5 ТЗ).
// Каждая строка несёт служебный ID в последней, скрытой колонке: по нему выгрузка находит строку, а не по номеру строки.
// Даты пишутся числами (как их хранит таблица), подписи человеческие, без кодов.

import { prisma } from "@/lib/db";
import { listTasks } from "@/lib/tasks/service";
import { isoFromDbDate } from "@/lib/tasks/dates";
import { priorityOf, stateLabel, statusOf } from "@/domain/dictionaries";
import type { Cell } from "./client";

export type Column = { header: string; width: number; kind?: "date" | "datetime" | "number" };
export type TabSpec = { key: "tasks" | "comments" | "weekly"; title: string; columns: Column[] };

export const ID_HEADER = "ID ресурса";

export const TASKS_TAB: TabSpec = {
  key: "tasks",
  title: "Задачи",
  columns: [
    { header: "№", width: 50, kind: "number" },
    { header: "Ссылка", width: 90 },
    { header: "Задача", width: 320 },
    { header: "Что нужно сделать", width: 320 },
    { header: "Ответственный", width: 160 },
    { header: "Соисполнители", width: 180 },
    { header: "Направление", width: 140 },
    { header: "Приоритет", width: 100 },
    { header: "Статус", width: 140 },
    { header: "Состояние", width: 130 },
    { header: "Чем заблокирована", width: 200 },
    { header: "Где сейчас", width: 320 },
    { header: "Где сейчас обновлено", width: 110, kind: "date" },
    { header: "Срок", width: 100, kind: "date" },
    { header: "Исходный срок", width: 100, kind: "date" },
    { header: "Переносов", width: 80, kind: "number" },
    { header: "Источник", width: 140 },
    { header: "Ссылки", width: 240 },
    { header: "Последний комментарий", width: 320 },
    { header: "Поставлена", width: 100, kind: "date" },
    { header: "Обновлено", width: 200 },
    { header: ID_HEADER, width: 80 },
  ],
};

export const COMMENTS_TAB: TabSpec = {
  key: "comments",
  title: "Комментарии к задачам",
  columns: [
    { header: "№ задачи", width: 80, kind: "number" },
    { header: "Задача", width: 300 },
    { header: "Автор", width: 160 },
    { header: "Когда", width: 130, kind: "datetime" },
    { header: "Комментарий", width: 480 },
    { header: ID_HEADER, width: 80 },
  ],
};

export const WEEKLY_TAB: TabSpec = {
  key: "weekly",
  title: "Weekly",
  columns: [
    { header: "Неделя", width: 70, kind: "number" },
    { header: "Понедельник", width: 100, kind: "date" },
    { header: "Автор", width: 160 },
    { header: "Направление", width: 140 },
    { header: "Блок", width: 160 },
    { header: "Тип", width: 100 },
    { header: "Что произошло", width: 340 },
    { header: "Подробнее", width: 340 },
    { header: "Влияние на бизнес", width: 220 },
    { header: "Цифра или факт", width: 200 },
    { header: "Что делаем дальше", width: 260 },
    { header: "Нужна помощь", width: 200 },
    { header: "Ссылки", width: 240 },
    { header: "Задача", width: 70, kind: "number" },
    { header: ID_HEADER, width: 80 },
  ],
};

export const LOG_TAB = { title: "Журнал выгрузки", columns: ["Когда", "Что", "Строк", "Результат", "Подробности"] };
export const SUMMARY_TAB = { title: "Сводка" };
export const RESOURCE_TABS: TabSpec[] = [TASKS_TAB, COMMENTS_TAB, WEEKLY_TAB];

const DAY_MS = 86_400_000;
const MSK_MS = 3 * 3_600_000;
/** Дата ГГГГ-ММ-ДД как число таблицы: дни с 30.12.1899 */
export const serialDate = (iso: string | null | undefined): Cell => (iso ? Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS) + 25569 : "");
/** Момент как число таблицы в московском времени, до минуты: секунды отбрасываются, как на экранах ресурса */
export const serialMoment = (at: Date | null | undefined): Cell => (at ? Math.floor((at.getTime() + MSK_MS) / 60_000) / 1440 + 25569 : "");

function stamp(at: Date): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    .format(at)
    .replace(",", "");
}

const appUrl = () => (process.env.APP_URL ?? "").replace(/\/+$/, "");
const linksText = (list: { title?: string; url?: string }[]) => list.map((l) => (l.title ? `${l.title}: ${l.url}` : (l.url ?? ""))).join("\n");

/** Строки вкладки «Задачи». numbers: только эти задачи; null: все. Задачи в архиве в таблицу не попадают */
export async function taskRows(numbers: number[] | null): Promise<Map<string, Cell[]>> {
  const [all, people, dicts] = await Promise.all([
    listTasks({ archived: true }),
    prisma.person.findMany({ select: { slug: true, fullName: true } }),
    prisma.dictionaryItem.findMany({ where: { kind: { in: ["DIRECTION", "TASK_SOURCE"] } } }),
  ]);
  const wanted = numbers ? new Set(numbers) : null;
  const tasks = all.filter((t) => !t.archived && (!wanted || wanted.has(t.number)));
  const name = (slug: string) => (slug === "all" ? "Все лидеры" : (people.find((p) => p.slug === slug)?.fullName ?? slug));
  const label = (kind: string, code: string) => dicts.find((d) => d.kind === kind && d.code === code)?.label ?? code;
  // Кем и когда обновлено: последняя запись журнала по задаче
  const last = tasks.length
    ? await prisma.$queryRaw<{ entityId: string; actorName: string | null; at: Date }[]>`
        SELECT DISTINCT ON ("entityId") "entityId", "actorName", "at" FROM "audit_log"
        WHERE "entity" = 'task' AND "entityId" = ANY(${tasks.map((t) => String(t.number))})
        ORDER BY "entityId", "at" DESC, "id" DESC`
    : [];
  const lastOf = new Map(last.map((r) => [r.entityId, r]));
  const rows = new Map<string, Cell[]>();
  for (const t of tasks) {
    const comment = t.comments.at(-1);
    const upd = lastOf.get(String(t.number));
    rows.set(String(t.number), [
      t.number,
      appUrl() ? `${appUrl()}/tasks/${t.number}` : "",
      t.title,
      t.outcome,
      name(t.owner),
      t.coExecutors.map(name).join(", "),
      label("DIRECTION", t.direction),
      priorityOf(t.priority).label,
      statusOf(t.status).label,
      stateLabel(t.state),
      t.state === "blocked" ? (t.blockedBy ?? "") : "",
      t.where,
      serialDate(t.whereUpdatedAt),
      serialDate(t.due),
      serialDate(t.originalDue),
      t.transfers.length,
      label("TASK_SOURCE", t.source.kind),
      linksText(t.links),
      comment ? `${name(comment.author)}: ${comment.text}` : "",
      serialDate(t.createdAt),
      upd ? `${upd.actorName ?? "Система"}, ${stamp(upd.at)}` : "",
      String(t.number),
    ]);
  }
  return rows;
}

/** Строки вкладки «Комментарии к задачам». Комментарии задач в архиве не выгружаются */
export async function commentRows(ids: string[] | null): Promise<Map<string, Cell[]>> {
  const list = await prisma.taskComment.findMany({
    where: { ...(ids ? { id: { in: ids } } : {}), task: { archivedAt: null } },
    include: { task: { select: { number: true, title: true } }, author: { select: { fullName: true } } },
    orderBy: [{ at: "asc" }, { id: "asc" }],
  });
  return new Map(list.map((c) => [c.id, [c.task.number, c.task.title, c.author.fullName, serialMoment(c.at), c.text, c.id]]));
}

/** Строки вкладки «Weekly»: одна строка на запись */
export async function weeklyRows(ids: string[] | null): Promise<Map<string, Cell[]>> {
  const list = await prisma.weeklyEntry.findMany({
    where: ids ? { id: { in: ids } } : {},
    include: { week: true, author: true, direction: true, block: true, type: true, tasks: { select: { number: true }, orderBy: { number: "asc" }, take: 1 } },
    orderBy: [{ week: { start: "asc" } }, { sortOrder: "asc" }, { id: "asc" }],
  });
  return new Map(
    list.map((e) => [
      e.id,
      [
        e.week.isoNumber,
        serialDate(isoFromDbDate(e.week.start)),
        e.author?.fullName ?? "Общее, без автора",
        e.direction.label,
        e.block.label,
        e.type.label,
        e.what,
        e.details ?? "",
        e.impact ?? "",
        e.fact ?? "",
        e.next ?? "",
        e.help ?? "",
        linksText(Array.isArray(e.links) ? (e.links as { title?: string; url?: string }[]) : []),
        e.tasks[0]?.number ?? "",
        e.id,
      ],
    ]),
  );
}

export const RENDER: Record<TabSpec["key"], (keys: string[] | null) => Promise<Map<string, Cell[]>>> = {
  tasks: (keys) => taskRows(keys ? keys.map(Number).filter(Number.isFinite) : null),
  comments: commentRows,
  weekly: weeklyRows,
};

/** Значение ячейки для сравнения: таблица может вернуть число как дробь с хвостом, пустые ячейки не возвращает */
export function sameCell(a: Cell | undefined, b: Cell | undefined): boolean {
  const norm = (v: Cell | undefined) => (v === undefined || v === null ? "" : typeof v === "number" ? Number(v.toFixed(6)) : v);
  const x = norm(a);
  const y = norm(b);
  if (typeof x === "number" || typeof y === "number") return Number(x) === Number(y) && String(x).trim() !== "" && String(y).trim() !== "";
  return x === y;
}
