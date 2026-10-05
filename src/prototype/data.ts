// Данные прототипа weekly из Insurance&Invest Bord (выгрузка 05.10.2026, вкладка Weekly CEO).
// Решение Арама 05.10.2026: прототип показывает настоящие weekly команды как есть.
// Задачи с этапа 3 живут в базе (src/lib/tasks), здесь их нет.

import bord from "./bord.json";
import { addDays, plural, weekOf, type IsoDate } from "./dates";
import type { BlockCode, DirectionCode, EntryTypeCode } from "./dictionaries";
import type { JournalEvent, PersonSlug, PersonWeekly, Task, WeeklyEntry } from "./types";
import { PEOPLE } from "./people";

export type PrototypeData = {
  today: IsoDate;
  reportingWeek: number;
  tasks: Task[];
  weeklies: PersonWeekly[];
  entries: WeeklyEntry[];
  journal: JournalEvent[];
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

const SOURCE_NOTE = "Insurance&Invest Bord, вкладка Weekly CEO";

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

/** События weekly из таблицы для журнала: разбор недели на встрече. События задач журнал берёт из базы */
function buildJournal(entries: WeeklyEntry[]): JournalEvent[] {
  const events: JournalEvent[] = [];
  const weeks = [...new Set(entries.map((e) => e.week))];
  for (const w of weeks) {
    const list = entries.filter((e) => e.week === w);
    const meeting = meetingDateOf(w);
    if (!meeting) continue;
    events.push({ id: `j-wk-${w}`, at: meeting, time: "", by: "system", source: "sheet", kind: "weekly", object: `Weekly за неделю ${w}`, field: "Разобрано на встрече", after: `${list.length} ${plural(list.length, "запись", "записи", "записей")}, в отчёт CEO ${list.filter((e) => e.ceo).length}` });
  }
  return events.sort((a, b) => (a.at + a.time < b.at + b.time ? 1 : -1));
}

/** Weekly прототипа. Задачи с этапа 3 приходят из базы и подставляются в store */
export function buildPrototypeData(today: IsoDate, reportingWeek: number): Omit<PrototypeData, "tasks"> {
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
  return { today, reportingWeek, weeklies, entries, journal: buildJournal(entries) };
}

/** Последняя неделя, по которой есть записи: её показываем, пока за отчётную никто не сдал */
export function latestWeekWithEntries(data: Pick<PrototypeData, "entries" | "reportingWeek">): number {
  const weeks = data.entries.map((e) => e.week);
  return weeks.length ? Math.max(...weeks) : data.reportingWeek;
}

/**
 * Неделя, которую лента, режим встречи и отчёт CEO открывают по умолчанию:
 * отчётная, если по ней уже есть записи, иначе последняя разобранная
 */
export function feedWeek(data: Pick<PrototypeData, "entries" | "reportingWeek">): number {
  return data.entries.some((e) => e.week === data.reportingWeek) ? data.reportingWeek : latestWeekWithEntries(data);
}

/** Дата встречи, на которой разбирали неделю: вторник после неё */
export function meetingDateOf(week: number): IsoDate | undefined {
  return (bord.entries as BordEntry[]).find((e) => weekOfMeeting(e.meeting) === week)?.meeting;
}

export const DATA_SOURCE = SOURCE_NOTE;
