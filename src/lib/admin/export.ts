// Выгрузка всех данных в Excel для владельца (раздел 6 ТЗ): второй уровень защиты вместе с историей версий таблицы.
// Один файл, по листу на вид данных. Время московское, подписи человеческие, без кодов.

import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { listTasks } from "@/lib/tasks/service";
import { ROLE_LABELS } from "@/lib/roles";
import { AUDIT_ACTION_LABELS } from "@/lib/audit";
import { DICT_TITLES } from "./labels";
import { priorityOf, stateLabel, statusOf, type EditableDictKind } from "@/domain/dictionaries";
import { isoFromDbDate } from "@/lib/tasks/dates";
import { weekNumberOf } from "@/lib/weekly/weeks";

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const WEEKLY_STATE = { DRAFT: "Черновик", SUBMITTED: "Сдан", LATE: "Сдан с опозданием" } as const;
const SOURCE = { APP: "ресурс", SHEET: "таблица", SYSTEM: "система" } as const;
const REQUEST_STATE = { OPEN: "Ждёт ответа", ACCEPTED: "Принята", DONE: "Выполнена", DECLINED: "Отклонена", WITHDRAWN: "Отозвана" } as const;

/** Момент в московском времени: Excel не знает часовых поясов, поэтому сдвигаем на три часа */
const msk = (d: Date | null | undefined) => (d ? new Date(d.getTime() + MSK_OFFSET_MS) : null);
/** Дата ГГГГ-ММ-ДД как дата Excel без времени */
const day = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00Z`) : null);
const yes = (v: boolean) => (v ? "да" : "");
const text = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));

type Col = { header: string; width: number; date?: "day" | "time" };

/** Итоги обещаний (этап 22) */
const PROMISE_LABEL: Record<string, string> = { DONE: "Сделано", PARTIAL: "Частично", NOT_DONE: "Не сделано", DROPPED: "Снято" };

function sheet(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: unknown[][]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width, style: c.date ? { numFmt: c.date === "day" ? "dd.mm.yyyy" : "dd.mm.yyyy hh:mm" } : { alignment: { wrapText: false } } }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}

export type ExportSummary = { tasks: number; entries: number; audit: number };

export async function buildExport(): Promise<{ buffer: Buffer; summary: ExportSummary }> {
  const [tasks, people, dicts, weeks, reports, entries, ceo, audit, taskMeta, requests] = await Promise.all([
    listTasks({ archived: true }),
    prisma.person.findMany({ orderBy: [{ sortOrder: "asc" }], include: { defaultDirection: true } }),
    prisma.dictionaryItem.findMany({ orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] }),
    prisma.week.findMany({ orderBy: { start: "asc" }, include: { closedBy: { select: { fullName: true } } } }),
    prisma.weeklyReport.findMany({ include: { week: true, author: true }, orderBy: [{ week: { start: "asc" } }] }),
    prisma.weeklyEntry.findMany({
      include: { week: true, author: true, direction: true, block: true, type: true, tasks: { select: { number: true } }, promiseReview: true, carriedFrom: { select: { id: true } } },
      orderBy: [{ week: { start: "asc" } }, { sortOrder: "asc" }],
    }),
    prisma.ceoReport.findMany({ include: { week: true, updatedBy: { select: { fullName: true } } }, orderBy: { week: { start: "asc" } } }),
    prisma.auditLog.findMany({ orderBy: [{ at: "asc" }, { id: "asc" }] }),
    prisma.task.findMany({ select: { number: true, weeklyEntry: { select: { what: true } } } }),
    // Просьбы коллегам (этап 21)
    prisma.helpRequest.findMany({
      include: { author: { select: { fullName: true } }, addressee: { select: { fullName: true } }, task: { select: { number: true } }, resultTask: { select: { number: true } }, entry: { select: { what: true } } },
      orderBy: { number: "asc" },
    }),
  ]);
  const name = new Map(people.map((p) => [p.slug, p.fullName]));
  const nameById = new Map(people.map((p) => [p.id, p.fullName]));
  const who = (slug: string | null | undefined) => (slug ? (slug === "all" ? "Все лидеры" : (name.get(slug) ?? slug)) : "");
  const label = (kind: string, code: string) => dicts.find((d) => d.kind === kind && d.code === code)?.label ?? code;
  const fromEntry = new Map(taskMeta.map((t) => [t.number, t.weeklyEntry?.what ?? ""]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Weekly, Страхование и инвестиции";
  wb.created = new Date();

  sheet(
    wb,
    "Задачи",
    [
      { header: "№", width: 6 },
      { header: "Задача", width: 50 },
      { header: "Что нужно сделать", width: 50 },
      { header: "Ответственный", width: 22 },
      { header: "Соисполнители", width: 26 },
      { header: "Направление", width: 18 },
      { header: "Приоритет", width: 12 },
      { header: "Статус", width: 18 },
      { header: "Состояние", width: 14 },
      { header: "Чем заблокирована", width: 30 },
      { header: "Где сейчас", width: 50 },
      { header: "Где сейчас обновлено", width: 14, date: "day" },
      { header: "Срок", width: 12, date: "day" },
      { header: "Исходный срок", width: 12, date: "day" },
      { header: "Переносов", width: 10 },
      { header: "Источник", width: 16 },
      { header: "Подробнее об источнике", width: 30 },
      { header: "Поставил", width: 22 },
      { header: "Создана", width: 12, date: "day" },
      { header: "Закрыта", width: 12, date: "day" },
      { header: "Итог или причина", width: 40 },
      { header: "В архиве", width: 9 },
      { header: "Ссылки", width: 40 },
      { header: "Из записи weekly", width: 40 },
      { header: "Что вернёт в график", width: 40 },
      { header: "Ждёт задачи", width: 14 },
    ],
    tasks.map((t) => [
      t.number,
      t.title,
      t.outcome,
      who(t.owner),
      t.coExecutors.map(who).join(", "),
      label("DIRECTION", t.direction),
      priorityOf(t.priority).label,
      statusOf(t.status).label,
      stateLabel(t.state),
      t.blockedBy ?? "",
      t.where,
      day(t.whereUpdatedAt),
      day(t.due),
      day(t.originalDue),
      t.transfers.length,
      label("TASK_SOURCE", t.source.kind),
      t.source.note,
      t.createdBy ? who(t.createdBy) : "на встрече",
      day(t.createdAt),
      day(t.closedAt),
      t.resolution ?? "",
      yes(!!t.archived),
      t.links.map((l) => `${l.title}: ${l.url}`).join("\n"),
      fromEntry.get(t.number) ?? "",
      t.riskNote ?? "",
      (t.waitsFor ?? []).map((w) => w.number).join(", "),
    ]),
  );

  sheet(
    wb,
    "Переносы",
    [
      { header: "№ задачи", width: 9 },
      { header: "Был срок", width: 12, date: "day" },
      { header: "Новый срок", width: 12, date: "day" },
      { header: "Причина", width: 50 },
      { header: "Кто", width: 22 },
      { header: "Когда", width: 12, date: "day" },
    ],
    tasks.flatMap((t) => t.transfers.map((x) => [t.number, day(x.from), day(x.to), x.reason, who(x.by), day(x.at)])),
  );

  sheet(
    wb,
    "Комментарии",
    [
      { header: "№ задачи", width: 9 },
      { header: "Автор", width: 22 },
      { header: "Когда", width: 12, date: "day" },
      { header: "Время", width: 8 },
      { header: "Текст", width: 80 },
    ],
    tasks.flatMap((t) => t.comments.map((c) => [t.number, who(c.author), day(c.at), c.time, c.text])),
  );

  sheet(
    wb,
    "Weekly",
    [
      { header: "Неделя", width: 8 },
      { header: "Понедельник", width: 12, date: "day" },
      { header: "Автор", width: 22 },
      { header: "Направление", width: 18 },
      { header: "Блок", width: 20 },
      { header: "Тип", width: 12 },
      { header: "Что произошло", width: 60 },
      { header: "Подробнее", width: 60 },
      { header: "Влияние на бизнес", width: 30 },
      { header: "Цифра или факт", width: 30 },
      { header: "Что делаем дальше", width: 40 },
      { header: "Нужна помощь", width: 30 },
      { header: "Ссылки", width: 40 },
      { header: "В отчёт CEO", width: 10 },
      { header: "Задача", width: 8 },
      { header: "Итог обещания", width: 40 },
      { header: "Перенесено из прошлой недели", width: 12 },
    ],
    entries.map((e) => [
      e.week.isoNumber,
      day(isoFromDbDate(e.week.start)),
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
      (Array.isArray(e.links) ? (e.links as { title?: string; url?: string }[]) : []).map((l) => (l.title ? `${l.title}: ${l.url}` : l.url)).join("\n"),
      yes(e.ceo),
      e.tasks[0]?.number ?? "",
      e.promiseReview ? `${PROMISE_LABEL[e.promiseReview.result]}${e.promiseReview.note ? `. ${e.promiseReview.note}` : ""}` : "",
      yes(!!e.carriedFrom),
    ]),
  );

  sheet(
    wb,
    "Сдача weekly",
    [
      { header: "Неделя", width: 8 },
      { header: "Понедельник", width: 12, date: "day" },
      { header: "Человек", width: 22 },
      { header: "Главное одной фразой", width: 60 },
      { header: "Состояние", width: 18 },
      { header: "Сдан", width: 17, date: "time" },
    ],
    reports.map((r) => [r.week.isoNumber, day(isoFromDbDate(r.week.start)), r.author.fullName, r.headline ?? "", WEEKLY_STATE[r.state], msk(r.submittedAt)]),
  );

  sheet(
    wb,
    "Недели",
    [
      { header: "Неделя", width: 8 },
      { header: "Понедельник", width: 12, date: "day" },
      { header: "Срок сдачи", width: 17, date: "time" },
      { header: "Встреча", width: 12, date: "day" },
      { header: "Закрыта", width: 17, date: "time" },
      { header: "Кто закрыл", width: 22 },
    ],
    weeks.map((w) => [w.isoNumber, day(isoFromDbDate(w.start)), msk(w.deadline), day(isoFromDbDate(w.meetingDate)), msk(w.closedAt), w.closedBy?.fullName ?? ""]),
  );

  sheet(
    wb,
    "Отчёты CEO",
    [
      { header: "Неделя", width: 8 },
      { header: "Главное за неделю", width: 80 },
      { header: "Риски", width: 60 },
      { header: "Что дальше", width: 60 },
      { header: "Сохранил", width: 22 },
      { header: "Когда", width: 17, date: "time" },
    ],
    ceo.map((c) => [c.week.isoNumber, c.main, c.risks, c.next, c.updatedBy?.fullName ?? "", msk(c.updatedAt)]),
  );

  sheet(
    wb,
    "Просьбы",
    [
      { header: "№", width: 6 },
      { header: "Кто просит", width: 22 },
      { header: "Кого", width: 22 },
      { header: "Что нужно", width: 60 },
      { header: "Нужно к", width: 12, date: "day" },
      { header: "Состояние", width: 14 },
      { header: "Срок адресата", width: 12, date: "day" },
      { header: "Ответ", width: 40 },
      { header: "Задача", width: 8 },
      { header: "Запись weekly", width: 40 },
      { header: "Задача адресата", width: 10 },
      { header: "Создана", width: 17, date: "time" },
      { header: "Закрыта", width: 17, date: "time" },
    ],
    requests.map((r) => [
      r.number,
      r.author.fullName,
      r.addressee.fullName,
      r.text,
      day(isoFromDbDate(r.due)),
      REQUEST_STATE[r.status],
      r.acceptedDue ? day(isoFromDbDate(r.acceptedDue)) : null,
      r.answer ?? "",
      r.task?.number ?? "",
      r.entry?.what ?? "",
      r.resultTask?.number ?? "",
      msk(r.createdAt),
      msk(r.closedAt),
    ]),
  );

  sheet(
    wb,
    "Люди",
    [
      { header: "Фамилия и имя", width: 26 },
      { header: "Короткое имя", width: 14 },
      { header: "Роль", width: 16 },
      { header: "Зона", width: 40 },
      { header: "Направление", width: 18 },
      { header: "В команде", width: 10 },
    ],
    people.map((p) => [p.fullName, p.shortName, ROLE_LABELS[p.role], p.zone, p.defaultDirection?.label ?? "", p.active ? "да" : "выключен"]),
  );

  sheet(
    wb,
    "Справочники",
    [
      { header: "Справочник", width: 20 },
      { header: "Код", width: 20 },
      { header: "Название", width: 30 },
      { header: "В списке", width: 10 },
    ],
    dicts.map((d) => [DICT_TITLES[d.kind as EditableDictKind] ?? d.kind, d.code, d.label, d.active ? "да" : "скрыто"]),
  );

  sheet(
    wb,
    "Журнал",
    [
      { header: "Когда", width: 17, date: "time" },
      { header: "Кто", width: 22 },
      { header: "Событие", width: 30 },
      { header: "Объект", width: 24 },
      { header: "Поле", width: 26 },
      { header: "Было", width: 40 },
      { header: "Стало", width: 40 },
      { header: "Откуда", width: 10 },
      { header: "Адрес", width: 16 },
    ],
    audit.map((a) => [
      msk(a.at),
      (a.actorId && nameById.get(a.actorId)) || a.actorName || "Система",
      AUDIT_ACTION_LABELS[a.action] ?? a.action,
      objectLabel(a.entity, a.entityId),
      a.field ?? "",
      text(a.before),
      text(a.after),
      SOURCE[a.source],
      a.ip ?? "",
    ]),
  );

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, summary: { tasks: tasks.length, entries: entries.length, audit: audit.length } };
}

function objectLabel(entity: string | null, id: string | null): string {
  if (!entity || !id) return "";
  if (entity === "task") return `Задача ${id}`;
  if (entity === "request") return `Просьба ${id}`;
  if (entity === "week" || entity === "ceo-report") return `Неделя ${weekNumberOf(id)}`;
  if (entity === "weekly") {
    const [week, slug] = id.split("/");
    return `Weekly, неделя ${week ? weekNumberOf(week) : ""}${slug ? `, ${slug}` : ""}`;
  }
  return `${entity} ${id}`;
}
