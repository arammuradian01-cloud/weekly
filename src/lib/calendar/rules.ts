// Календарь сроков (этап 29): какие события попадают в личный календарь. Чистые функции без базы.
//
// - сроки моих задач в работе: я ответственный или соисполнитель. Событие на весь день в день срока;
// - срок weekly: если от меня ждут weekly хотя бы в одной команде и на этой неделе я не в отпуске;
// - встреча команды: команды, где я руковожу или участвую, если в команде есть кто-то кроме меня;
// - встречи один на один: запланированные, где я один из двух.
// По умолчанию в календаре только номера, слова «срок», «встреча» и ссылки. Названия задач, имена и названия команд
// показываются, только если человек сам включил это: сервис календаря хранит всё у себя.

import { createHash } from "node:crypto";
import { toCalendar, type IsoDate } from "@/domain/dates";
import type { WeekKey } from "@/domain/types";
import { expectingTeams, leadersOf, personDeadline, teamMeeting, type RhythmNode } from "@/lib/org/rhythm";
import { moscowDateTime } from "@/lib/week";
import { weekNumberOf } from "@/lib/weekly/weeks";
import type { CalEvent } from "./ics";

/** Сколько недель назад и вперёд показывать сроки weekly и встречи команды */
export const WEEKS_BACK = 1;
export const WEEKS_AHEAD = 8;
/** Задач в календаре не больше этого: самые ранние сроки */
export const TASKS_MAX = 300;
/** Встречи один на один за прошлые дни, которые ещё показываются */
export const ONE_ON_ONE_DAYS_BACK = 14;
/** Длительность встречи команды в календаре, если у встречи есть время */
export const MEETING_MINUTES = 60;
/** Срок weekly: короткое событие в момент срока */
export const DEADLINE_MINUTES = 15;

export type FeedNode = RhythmNode & { name: string };

export type FeedWeek = {
  key: WeekKey;
  /** Срок департамента за неделю */
  deadline: Date;
  /** День встречи департамента */
  meetingDate: IsoDate;
  /** Я отмечен как отсутствующий на этой неделе */
  absent: boolean;
  /** Дата уже созданной встречи команды: важнее расчётной */
  meetings: Map<string, IsoDate>;
};

export type FeedInput = {
  personId: string;
  withTitles: boolean;
  base: string;
  tasks: { id: string; number: number; title: string; due: IsoDate }[];
  weeks: FeedWeek[];
  nodes: FeedNode[];
  oneOnOnes: { id: string; pairId: string; date: IsoDate; otherName: string }[];
};

/**
 * Ключ события. В нём отпечаток человека: срок weekly и встреча команды у разных людей разные, а календари Outlook и
 * iCloud склеивают события с одним ключом, если на них подписаны в одной учётной записи
 */
export function personTag(personId: string): string {
  return createHash("sha256").update(`weekly-calendar:${personId}`).digest("hex").slice(0, 10);
}

function at(date: IsoDate, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  return moscowDateTime(toCalendar(date), h, m);
}

/** Команды человека для встреч: руководит или участвует, в команде есть кто-то кроме него */
export function meetingTeams(personId: string, nodes: FeedNode[]): FeedNode[] {
  return nodes.filter((n) => {
    if (!n.active) return false;
    const people = new Set([...(n.leaderId ? [n.leaderId] : []), ...n.members]);
    return people.has(personId) && people.size > 1;
  });
}

export function feedEvents(input: FeedInput): CalEvent[] {
  const base = input.base.replace(/\/+$/, "");
  const tag = personTag(input.personId);
  const uid = (kind: string, id: string) => `${kind}-${id}-${tag}@weekly`;
  const events: (CalEvent & { sort: number })[] = [];
  const titles = input.withTitles;

  for (const t of input.tasks) {
    const url = `${base}/tasks/${t.number}`;
    events.push({
      uid: uid("task", t.id),
      summary: titles ? `№${t.number} ${t.title}` : `Срок задачи №${t.number}`,
      description: `Срок задачи №${t.number}. Подробности: ${url}`,
      url,
      date: t.due,
      sort: Date.parse(`${t.due}T00:00:00Z`),
    });
  }

  const leaders = leadersOf(input.nodes);
  const expected = expectingTeams(input.personId, input.nodes, leaders).length > 0;
  const teams = meetingTeams(input.personId, input.nodes);
  for (const w of input.weeks) {
    const number = weekNumberOf(w.key);
    if (expected && !w.absent) {
      const deadline = personDeadline(input.personId, w.key, input.nodes, w.deadline, leaders);
      const url = `${base}/weekly/submit`;
      events.push({
        uid: uid("weekly", w.key),
        summary: `Срок weekly, неделя ${number}`,
        description: `Срок сдачи weekly за неделю ${number}: ${url}`,
        url,
        start: deadline,
        minutes: DEADLINE_MINUTES,
        sort: deadline.getTime(),
      });
    }
    for (const n of teams) {
      const slot = teamMeeting(w.key, n, w.meetingDate);
      const date = w.meetings.get(n.id) ?? slot.date;
      const url = `${base}/weekly/meeting?week=${w.key}`;
      // Без названий даже топ-команда просто «команда»: по календарю не видно, кто в неё входит
      const summary = titles ? `Встреча команды «${n.name}»` : "Встреча команды";
      const common = { uid: uid(`meeting-${n.id}`, w.key), summary: `${summary}, неделя ${number}`, description: `Повестка и решения встречи за неделю ${number}: ${url}`, url };
      if (slot.time) {
        const start = at(date, slot.time);
        events.push({ ...common, start, minutes: MEETING_MINUTES, sort: start.getTime() });
      } else {
        events.push({ ...common, date, sort: Date.parse(`${date}T00:00:00Z`) });
      }
    }
  }

  for (const m of input.oneOnOnes) {
    const url = `${base}/one-on-one?pair=${encodeURIComponent(m.pairId)}`;
    events.push({
      uid: uid("one-on-one", m.id),
      summary: titles ? `Один на один: ${m.otherName}` : "Встреча один на один",
      description: `Повестка и заметки встречи: ${url}`,
      url,
      date: m.date,
      sort: Date.parse(`${m.date}T00:00:00Z`),
    });
  }

  return events.sort((a, b) => a.sort - b.sort || a.uid.localeCompare(b.uid)).map(({ sort: _sort, ...e }) => e);
}
