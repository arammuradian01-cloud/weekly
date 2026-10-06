// Разовый импорт задач из вкладки «Задачи» Insurance&Invest Bord и сверка ресурса с таблицей (этап 3 ТЗ).
// На вход CSV вкладки (Файл, Скачать, CSV) или выгрузка всей таблицы, где вкладки идут блоками «## Sheet name: ...».

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { TaskStatus } from "@/generated/prisma/enums";
import { formatLong, type IsoDate } from "@/domain/dates";
import { moscowDateTime } from "@/lib/week";
import { isOverdue, overdueDays } from "./rules";
import { dbDate, isoFromDbDate, isoFromRuDate } from "./dates";
import { taskInclude, toTaskDto } from "./dto";

export const TABLE_HEADER = ["№", "Встреча", "Ответственный", "Задача", "Что нужно сделать (коротко)", "Срок", "Статус", "Комментарий / следующий шаг", "Статус просроченности"] as const;

export const ALL_LEADERS = "Все лидеры";
export const IMPORT_TRANSFER_REASON = "Перенесена в таблице до запуска ресурса";
export const IMPORT_RESOLUTION = "Закрыта в таблице до запуска ресурса";

export const STATUS_FROM_TABLE: Record<string, TaskStatus> = {
  "Предложена": "PROPOSED",
  "В работе": "IN_PROGRESS",
  "Требует уточнений": "CLARIFY",
  "Выполнена": "DONE",
  "Не выполнена": "FAILED",
  "Отменена": "CANCELLED",
  // Статус «Перенесена» заменён счётчиком переносов: «В работе» и один перенос (решение 04.10.2026)
  "Перенесена": "IN_PROGRESS",
};

export const STATUS_TO_TABLE: Record<TaskStatus, string> = {
  PROPOSED: "Предложена",
  IN_PROGRESS: "В работе",
  CLARIFY: "Требует уточнений",
  DONE: "Выполнена",
  FAILED: "Не выполнена",
  CANCELLED: "Отменена",
};

/** Текст ячейки так, как его хранит ресурс: без пробелов по краям, длинное тире заменено дефисом (раздел 3 ТЗ) */
export function normalizeCell(value: string | undefined): string {
  return (value ?? "").replace(/\r\n?/g, "\n").replace(/[—–]/g, "-").trim();
}

/** CSV по RFC 4180: кавычки, удвоенные кавычки и переводы строк внутри ячейки */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export type TableRow = {
  number: number;
  meeting: IsoDate;
  owner: string;
  title: string;
  outcome: string;
  due: IsoDate;
  status: string;
  comment: string;
  overdue: string;
};

/** Строки задач из CSV вкладки или из выгрузки всей таблицы */
export function readTasksTable(text: string): TableRow[] {
  let section = text;
  const marker = text.indexOf("## Sheet name: Задачи");
  if (marker >= 0) {
    const next = text.indexOf("## Sheet name:", marker + 10);
    section = text.slice(marker, next >= 0 ? next : undefined);
  }
  const rows = parseCsv(section);
  const headerAt = rows.findIndex((r) => normalizeCell(r[0]) === "№" && normalizeCell(r[1]) === "Встреча");
  if (headerAt < 0) throw new Error("В файле нет таблицы задач: не нашёл строку заголовков «№, Встреча, Ответственный…»");
  const header = rows[headerAt]!.map(normalizeCell);
  TABLE_HEADER.forEach((name, i) => {
    if (header[i] !== name) throw new Error(`Колонка ${i + 1} называется «${header[i] ?? ""}», ожидалась «${name}». Формат вкладки поменялся`);
  });
  const out: TableRow[] = [];
  for (const r of rows.slice(headerAt + 1)) {
    const num = normalizeCell(r[0]);
    if (!/^\d+$/.test(num)) {
      if (r.every((c) => !normalizeCell(c))) continue;
      break;
    }
    const meeting = isoFromRuDate(normalizeCell(r[1]));
    const due = isoFromRuDate(normalizeCell(r[5]));
    if (!meeting) throw new Error(`Задача ${num}: дата встречи «${r[1]}» не в формате ДД.ММ.ГГГГ`);
    if (!due) throw new Error(`Задача ${num}: срок «${r[5]}» не в формате ДД.ММ.ГГГГ`);
    out.push({
      number: Number(num),
      meeting,
      owner: normalizeCell(r[2]),
      title: normalizeCell(r[3]),
      outcome: normalizeCell(r[4]),
      due,
      status: normalizeCell(r[6]),
      comment: normalizeCell(r[7]),
      overdue: normalizeCell(r[8]),
    });
  }
  return out;
}

/**
 * Дата последнего обновления «где сейчас»: самая поздняя пометка «ДД.ММ:» в комментарии.
 * Год берём из даты встречи, а если пометка вышла раньше встречи, значит это уже следующий год.
 */
export function whereUpdatedFrom(comment: string, meeting: IsoDate): IsoDate {
  const year = Number(meeting.slice(0, 4));
  let latest = meeting;
  for (const m of comment.matchAll(/(?:^|[\s.;])(\d{2})\.(\d{2}):/g)) {
    let iso = `${year}-${m[2]}-${m[1]}`;
    if (iso < meeting) iso = `${year + 1}-${m[2]}-${m[1]}`;
    if (!isoFromRuDate(`${m[1]}.${m[2]}.${iso.slice(0, 4)}`)) continue;
    if (iso > latest) latest = iso;
  }
  return latest;
}

type PersonRef = { id: string; slug: string; fullName: string; defaultDirectionId: string | null };

export type ImportOptions = { batch: string; /** Направление для задач «Все лидеры» и людей без направления */ fallbackDirection?: string };

export type ImportReport = { created: number[]; skipped: number[]; nextNumber: number };

/** Что помешает импорту: неизвестные люди и статусы, слишком длинные названия, пустое «что сделать» */
function taskProblems(rows: TableRow[], byName: Map<string, unknown>): string[] {
  const problems: string[] = [];
  for (const r of rows) {
    if (r.owner !== ALL_LEADERS && !byName.has(r.owner)) problems.push(`задача ${r.number}: ответственного «${r.owner}» нет в списке людей`);
    if (!(r.status in STATUS_FROM_TABLE)) problems.push(`задача ${r.number}: статус «${r.status}» не из справочника`);
    if (r.title.length > 120) problems.push(`задача ${r.number}: название длиннее 120 знаков`);
    if (!r.outcome) problems.push(`задача ${r.number}: пустое «Что нужно сделать»`);
  }
  return problems;
}

/** Проверка выгрузки без записи в базу: сколько задач и что помешает импорту. Нужна перед перезаливкой базы */
export async function checkBordTasks(db: PrismaClient, text: string): Promise<{ rows: number; problems: string[] }> {
  const rows = readTasksTable(text);
  const people = await db.person.findMany({ select: { fullName: true } });
  return { rows: rows.length, problems: taskProblems(rows, new Map(people.map((p) => [p.fullName, p]))) };
}

/** Импорт: создаёт задачи, которых ещё нет по номеру. Существующие не трогает, поэтому запуск можно повторять */
export async function importBordTasks(db: PrismaClient, text: string, opts: ImportOptions): Promise<ImportReport> {
  const rows = readTasksTable(text);
  const people = (await db.person.findMany()) as PersonRef[];
  const byName = new Map(people.map((p) => [p.fullName, p]));
  const fallback = await db.dictionaryItem.findFirst({ where: { kind: "DIRECTION", code: opts.fallbackDirection ?? "department" } });
  if (!fallback) throw new Error("В справочнике нет направления «Департамент»: сначала запустите сид");

  const problems = taskProblems(rows, byName);
  if (problems.length) throw new Error(`Импорт остановлен, ничего не записано:\n- ${problems.join("\n- ")}`);

  const existing = new Set((await db.task.findMany({ select: { number: true } })).map((t) => t.number));
  const created: number[] = [];
  const skipped: number[] = [];

  await db.$transaction(async (tx) => {
    for (const r of rows) {
      if (existing.has(r.number)) {
        skipped.push(r.number);
        continue;
      }
      const person = r.owner === ALL_LEADERS ? null : byName.get(r.owner)!;
      const status = STATUS_FROM_TABLE[r.status]!;
      const moved = r.status === "Перенесена";
      const closed = status === "DONE" || status === "FAILED" || status === "CANCELLED";
      const at = (iso: IsoDate) => moscowDateTime({ year: +iso.slice(0, 4), month: +iso.slice(5, 7), day: +iso.slice(8, 10) });
      const whereUpdated = whereUpdatedFrom(r.comment, r.meeting);
      const data: Prisma.TaskUncheckedCreateInput = {
        number: r.number,
        title: r.title,
        outcome: r.outcome,
        ownerId: person?.id ?? null,
        ownerAll: !person,
        directionId: person?.defaultDirectionId ?? fallback.id,
        // Приоритета и состояния в таблице нет: «не задан», пока ответственный или владелец не выставит
        priority: null,
        state: null,
        status,
        whereNow: r.comment,
        whereUpdatedAt: dbDate(whereUpdated),
        due: dbDate(r.due),
        originalDue: moved ? null : dbDate(r.due),
        sourceCode: "meeting",
        sourceNote: formatLong(r.meeting),
        sourceDate: dbDate(r.meeting),
        createdById: null,
        createdAt: at(r.meeting),
        // «Обновлена» по таблице, а не по времени импорта
        updatedAt: at(whereUpdated),
        resolution: closed ? IMPORT_RESOLUTION : null,
        importBatch: opts.batch,
        transfers: moved ? { create: [{ fromDue: null, toDue: dbDate(r.due), reason: IMPORT_TRANSFER_REASON, byId: null, at: null }] } : undefined,
      };
      await tx.task.create({ data });
      await tx.auditLog.create({
        data: {
          action: "task.import",
          source: "SHEET",
          actorName: "Импорт из таблицы",
          entity: "task",
          entityId: String(r.number),
          field: "Задача перенесена из Insurance&Invest Bord",
          after: `${r.title}. Встреча ${formatLong(r.meeting)}, ответственный ${r.owner}, срок ${formatLong(r.due)}, статус «${r.status}»`,
        },
      });
      created.push(r.number);
    }
    // Новые задачи начинаются после самой старшей импортированной
    const max = await tx.task.aggregate({ _max: { number: true } });
    const setting = await tx.setting.findUnique({ where: { key: "tasks.nextNumber" } });
    const current = typeof setting?.value === "number" ? setting.value : 52;
    const next = Math.max(current, (max._max.number ?? 0) + 1);
    await tx.setting.upsert({ where: { key: "tasks.nextNumber" }, update: { value: next }, create: { key: "tasks.nextNumber", value: next } });
  });

  const setting = await db.setting.findUnique({ where: { key: "tasks.nextNumber" } });
  return { created, skipped, nextNumber: Number(setting?.value ?? 0) };
}

export type Diff = { number: number; field: string; table: string; resource: string };
export type ReconcileReport = { checked: number; diffs: Diff[]; notInTable: number[]; newInResource: number[] };

/** «Статус просроченности» так, как его считает таблица, но по правилам ресурса */
export function overdueText(task: Parameters<typeof isOverdue>[0], asOf: IsoDate): string {
  if (task.status === "done" || task.status === "failed" || task.status === "cancelled") return "Закрыта";
  if (isOverdue(task, asOf)) return `Просрочена на ${overdueDays(task, asOf)} дн.`;
  return "В сроке";
}

/**
 * Сверка ресурса с таблицей по каждому полю (критерий приёмки этапа 3).
 * asOf: на какую дату таблица считала «Статус просроченности».
 */
export async function reconcileBordTasks(db: PrismaClient, text: string, asOf: IsoDate): Promise<ReconcileReport> {
  const rows = readTasksTable(text);
  const tasks = await db.task.findMany({ include: taskInclude });
  const byNumber = new Map(tasks.map((t) => [t.number, t]));
  const names = new Map((await db.person.findMany({ select: { slug: true, fullName: true } })).map((p) => [p.slug, p.fullName]));
  const diffs: Diff[] = [];
  const add = (number: number, field: string, table: string, resource: string) => {
    if (table !== resource) diffs.push({ number, field, table, resource });
  };

  for (const r of rows) {
    const t = byNumber.get(r.number);
    if (!t) {
      diffs.push({ number: r.number, field: "Задача", table: r.title, resource: "нет в ресурсе" });
      continue;
    }
    const dto = toTaskDto(t);
    const movedOnImport = t.transfers.some((x) => x.fromDue === null);
    add(r.number, "Встреча", r.meeting, t.sourceDate ? isoFromDbDate(t.sourceDate) : "");
    add(r.number, "Ответственный", r.owner, t.ownerAll || !t.owner ? ALL_LEADERS : (names.get(t.owner.slug) ?? t.owner.slug));
    add(r.number, "Задача", r.title, t.title);
    add(r.number, "Что нужно сделать", r.outcome, t.outcome);
    add(r.number, "Срок", r.due, isoFromDbDate(t.due));
    add(r.number, "Статус", r.status, t.status === "IN_PROGRESS" && movedOnImport && t.transfers.length === 1 ? "Перенесена" : STATUS_TO_TABLE[t.status]);
    add(r.number, "Комментарий / следующий шаг", r.comment, t.whereNow);
    add(r.number, "Статус просроченности", r.overdue, overdueText(dto, asOf));
  }
  const inTable = new Set(rows.map((r) => r.number));
  return {
    checked: rows.length,
    diffs,
    notInTable: tasks.filter((t) => t.importBatch && !inTable.has(t.number)).map((t) => t.number),
    newInResource: tasks.filter((t) => !t.importBatch).map((t) => t.number),
  };
}
