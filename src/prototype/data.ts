// Данные прототипа: задачи и weekly из Insurance&Invest Bord (выгрузка 05.10.2026).
// Решение Арама 05.10.2026: прототип показывает настоящие задачи и weekly команды как есть.
// Поля, которых в таблице нет (приоритет, состояние, тип записи), заполнены по умолчанию и помечены в хэндоффе.

import bord from "./bord.json";
import { addDays, formatLong, plural, weekOf, type IsoDate } from "./dates";
import type { BlockCode, DirectionCode, EntryTypeCode, StatusCode } from "./dictionaries";
import type { HistoryItem, JournalEvent, Owner, PersonSlug, PersonWeekly, Task, WeeklyEntry } from "./types";
import { PEOPLE } from "./people";

export type PrototypeData = {
  today: IsoDate;
  reportingWeek: number;
  tasks: Task[];
  weeklies: PersonWeekly[];
  entries: WeeklyEntry[];
  journal: JournalEvent[];
};

type BordTask = {
  n: number;
  meeting: string;
  owner: string;
  dir: string;
  title: string;
  outcome: string;
  due: string;
  status: string;
  where: string;
  updated: string;
  movedInSheet: boolean;
  resolution?: string;
};

type BordEntry = {
  id: string;
  meeting: string;
  author: string | null;
  block: string;
  dir: string;
  type: string;
  what: string;
  details: string | null;
  impact: string | null;
  next: string | null;
  ceo: boolean;
};

const SOURCE_NOTE = "Insurance&Invest Bord, вкладка «Задачи»";

function buildTask(t: BordTask): Task {
  const status = t.status as StatusCode;
  const history: HistoryItem[] = [
    { id: `${t.n}-h0`, at: t.meeting, time: "", by: "system", field: "Задача поставлена на встрече", after: t.title },
  ];
  if (t.movedInSheet) {
    history.push({ id: `${t.n}-t0`, at: t.updated, time: "", by: "system", field: "Срок", after: `${formatLong(t.due)}. Перенесена в таблице, прежний срок не записан` });
  }
  if (t.updated !== t.meeting) {
    history.push({ id: `${t.n}-w`, at: t.updated, time: "", by: "system", field: "Где сейчас", after: t.where });
  }
  history.sort((a, b) => (a.at < b.at ? 1 : -1));
  const closed = status === "done" || status === "failed" || status === "cancelled";
  return {
    number: t.n,
    title: t.title,
    outcome: t.outcome,
    owner: t.owner as Owner,
    coExecutors: [],
    direction: t.dir as DirectionCode,
    // Приоритета и состояния в таблице нет: «не задан», пока ответственный или владелец не выставит
    priority: "unset",
    status,
    state: "unset",
    where: t.where,
    whereUpdatedAt: t.updated,
    due: t.due,
    originalDue: t.due,
    // Статус «Перенесена» заменён счётчиком переносов: «В работе» и один перенос (решение 04.10.2026)
    transfers: t.movedInSheet ? [{ from: null, to: t.due, by: null, reason: "Перенесена в таблице до запуска ресурса", at: null }] : [],
    source: { kind: "meeting", note: formatLong(t.meeting) },
    links: [],
    comments: [],
    history,
    createdBy: null,
    createdAt: t.meeting,
    updatedAt: t.updated,
    closedAt: closed ? t.due : undefined,
    resolution: t.resolution,
  };
}

/** Weekly разбирают на встрече во вторник: записи с датой встречи относятся к прошлой неделе */
function weekOfMeeting(meeting: IsoDate): number {
  return weekOf(addDays(meeting, -2)).week;
}

/** В таблице «Подробнее» начинается с той же фразы, что «Что произошло»: повтор убираем */
function detailsWithoutHeadline(what: string, details: string | null): string | undefined {
  if (!details) return undefined;
  const head = what.replace(/[.…]$/, "");
  if (!details.startsWith(head)) return details;
  const rest = details.slice(head.length).replace(/^[.…:;,]?\s*/, "");
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : undefined;
}

function buildEntry(e: BordEntry): WeeklyEntry {
  return {
    id: e.id,
    week: weekOfMeeting(e.meeting),
    author: (e.author as PersonSlug | null) ?? null,
    direction: e.dir as DirectionCode,
    block: e.block as BlockCode,
    type: e.type as EntryTypeCode,
    what: e.what,
    details: detailsWithoutHeadline(e.what, e.details),
    fact: e.impact ?? undefined,
    next: e.next ?? undefined,
    links: [],
    ceo: e.ceo,
  };
}

function buildJournal(tasks: Task[], entries: WeeklyEntry[]): JournalEvent[] {
  const events: JournalEvent[] = [];
  for (const t of tasks) {
    for (const h of t.history) {
      events.push({ id: `j-${h.id}`, at: h.at, time: h.time, by: h.by, source: "sheet", kind: "task", object: `Задача ${t.number}`, field: h.field, before: h.before, after: h.after });
    }
  }
  const weeks = [...new Set(entries.map((e) => e.week))];
  for (const w of weeks) {
    const list = entries.filter((e) => e.week === w);
    const meeting = meetingDateOf(w);
    if (!meeting) continue;
    events.push({ id: `j-wk-${w}`, at: meeting, time: "", by: "system", source: "sheet", kind: "weekly", object: `Weekly за неделю ${w}`, field: "Разобрано на встрече", after: `${list.length} ${plural(list.length, "запись", "записи", "записей")}, в отчёт CEO ${list.filter((e) => e.ceo).length}` });
  }
  return events.sort((a, b) => (a.at + a.time < b.at + b.time ? 1 : -1));
}

export function buildPrototypeData(today: IsoDate, reportingWeek: number): PrototypeData {
  const tasks = (bord.tasks as BordTask[]).map(buildTask);
  const entries = (bord.entries as BordEntry[]).map(buildEntry);
  // Отметки о сдаче: прошлые недели разобраны на встречах, кто писал записи, тот сдал. Текущая неделя ещё не начата
  const weeks = [...new Set([...entries.map((e) => e.week), reportingWeek])].sort();
  const weeklies: PersonWeekly[] = weeks.flatMap((week) =>
    PEOPLE.map((p) => ({
      week,
      author: p.slug,
      headline: "",
      state: week !== reportingWeek && entries.some((e) => e.week === week && e.author === p.slug) ? ("submitted" as const) : ("not-started" as const),
    })),
  );
  return { today, reportingWeek, tasks, weeklies, entries, journal: buildJournal(tasks, entries) };
}

/** Последняя неделя, по которой есть записи: её показываем, пока за отчётную никто не сдал */
export function latestWeekWithEntries(data: PrototypeData): number {
  const weeks = data.entries.map((e) => e.week);
  return weeks.length ? Math.max(...weeks) : data.reportingWeek;
}

/**
 * Неделя, которую лента, режим встречи и отчёт CEO открывают по умолчанию:
 * отчётная, если по ней уже есть записи, иначе последняя разобранная
 */
export function feedWeek(data: PrototypeData): number {
  return data.entries.some((e) => e.week === data.reportingWeek) ? data.reportingWeek : latestWeekWithEntries(data);
}

/** Дата встречи, на которой разбирали неделю: вторник после неё */
export function meetingDateOf(week: number): IsoDate | undefined {
  return (bord.entries as BordEntry[]).find((e) => weekOfMeeting(e.meeting) === week)?.meeting;
}

export const DATA_SOURCE = SOURCE_NOTE;
