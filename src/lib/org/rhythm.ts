// Ритм weekly команд (этап 15): срок сдачи и встреча команды, кто сдаёт weekly в команде.
// Чистые функции без базы: их считают и сервер, и тесты.
//
// Правила:
// - у команды свой срок сдачи и своя встреча; пусто: как у департамента. Срок команды не позже срока департамента,
//   чтобы руководитель успел собрать weekly команды и сдать свой в команду выше;
// - weekly в команде сдают участники, которые сами руководят командой. Специалисты сдают, если руководитель
//   команды это включил (решение 7). Руководитель команды сдаёт свой weekly в команду выше, не в свою;
// - в топ-команде сдают все, как до команд: и владелец, и участники;
// - срок человека: самый ранний из сроков команд, где от него ждут weekly. Нигде не ждут: срок департамента.

import { addDays, toCalendar, type IsoDate } from "@/domain/dates";
import { TOP_TEAM } from "@/domain/teams";
import type { WeekKey } from "@/domain/types";
import { moscowDateTime } from "@/lib/week";

/** Момент в неделе: 0 отчётная неделя, 1 следующая за ней; день ISO (1 понедельник) и время по Москве */
export type Slot = { week: 0 | 1; weekday: number; time: string };

export type TeamRhythm = { deadline: Slot | null; meeting: Slot | null; specialists: boolean };

export const DEFAULT_RHYTHM: TeamRhythm = { deadline: null, meeting: null, specialists: false };

/** Команда для расчётов ритма: только то, что нужно */
export type RhythmNode = { id: string; leaderId: string | null; members: string[]; active: boolean; rhythm: TeamRhythm };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const WEEKDAY_NAMES = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
const WEEKDAY_ACC = ["понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье"];

/** Слот из колонок команды. Неполный слот (нет дня или времени) считается пустым */
export function slotOf(week: number | null | undefined, weekday: number | null | undefined, time: string | null | undefined): Slot | null {
  if (weekday == null || !time || (week !== 0 && week !== 1)) return null;
  return { week, weekday, time };
}

export function isSlot(value: unknown): value is Slot {
  const s = value as Slot;
  return !!s && (s.week === 0 || s.week === 1) && Number.isInteger(s.weekday) && s.weekday >= 1 && s.weekday <= 7 && typeof s.time === "string" && TIME.test(s.time);
}

/** День слота для недели */
export function slotDay(key: WeekKey, slot: Slot): IsoDate {
  return addDays(key, slot.week * 7 + slot.weekday - 1);
}

/** Момент слота для недели */
export function slotMoment(key: WeekKey, slot: Slot): Date {
  const [h, m] = slot.time.split(":").map(Number);
  return moscowDateTime(toCalendar(slotDay(key, slot)), h, m);
}

/** «пятница 16:00» или «понедельник следующей недели 18:00»: для подписей */
export function slotText(slot: Slot, accusative = false): string {
  const day = (accusative ? WEEKDAY_ACC : WEEKDAY_NAMES)[slot.weekday - 1];
  return `${day}${slot.week === 1 ? " следующей недели" : ""}, ${slot.time}`;
}

/** Срок сдачи weekly в команде за неделю. department: срок департамента для этой недели */
export function teamDeadline(key: WeekKey, node: Pick<RhythmNode, "id" | "rhythm">, department: Date): Date {
  if (node.id === TOP_TEAM || !node.rhythm.deadline) return department;
  const own = slotMoment(key, node.rhythm.deadline);
  return own.getTime() < department.getTime() ? own : department;
}

/** Встреча команды: день и, если задано, время. department: день встречи департамента */
export function teamMeeting(key: WeekKey, node: Pick<RhythmNode, "id" | "rhythm">, department: IsoDate): { date: IsoDate; time: string | null } {
  if (node.id === TOP_TEAM || !node.rhythm.meeting) return { date: department, time: null };
  return { date: slotDay(key, node.rhythm.meeting), time: node.rhythm.meeting.time };
}

/** Кто руководит хотя бы одной включённой командой */
export function leadersOf(nodes: RhythmNode[]): Set<string> {
  return new Set(nodes.filter((n) => n.active && n.leaderId).map((n) => n.leaderId!));
}

/** От кого команда ждёт weekly. Без фильтра по выключенным людям и наблюдателям: его делает тот, кто читает людей */
export function expectedOf(node: RhythmNode, leaders: Set<string>): string[] {
  if (node.id === TOP_TEAM) return [...new Set([...(node.leaderId ? [node.leaderId] : []), ...node.members])];
  return node.members.filter((m) => m !== node.leaderId && (node.rhythm.specialists || leaders.has(m)));
}

/** Команды, которые ждут weekly человека */
export function expectingTeams<T extends RhythmNode>(personId: string, nodes: T[], leaders = leadersOf(nodes)): T[] {
  return nodes.filter((n) => n.active && expectedOf(n, leaders).includes(personId));
}

/** Срок человека за неделю: самый ранний из сроков команд, которые ждут его weekly */
export function personDeadline(personId: string, key: WeekKey, nodes: RhythmNode[], department: Date, leaders = leadersOf(nodes)): Date {
  let best = department;
  for (const n of expectingTeams(personId, nodes, leaders)) {
    const d = teamDeadline(key, n, department);
    if (d.getTime() < best.getTime()) best = d;
  }
  return best;
}

/**
 * Закрыта ли неделя для weekly человека. Неделю департамента закрывает администратор, неделю команды её руководитель.
 * Человек больше не правит weekly, когда закрыли все команды, которые ждут его weekly (топ-команда закрывается
 * вместе с неделей департамента). Если weekly от него нигде не ждут, считаются команды, где он участник
 */
export function closedFor(personId: string, nodes: RhythmNode[], weekClosed: boolean, closedTeams: Set<string>, leaders = leadersOf(nodes)): boolean {
  if (weekClosed) return true;
  let teams = expectingTeams(personId, nodes, leaders);
  if (!teams.length) teams = nodes.filter((n) => n.active && n.members.includes(personId));
  return teams.length > 0 && teams.every((n) => n.id !== TOP_TEAM && closedTeams.has(n.id));
}

/** Люди, чьи записи руководитель может поднять наверх: участники команд, которыми он руководит напрямую (кроме топ-команды) */
export function promotableFrom(personId: string, nodes: RhythmNode[]): Set<string> {
  const out = new Set<string>();
  for (const n of nodes) if (n.active && n.id !== TOP_TEAM && n.leaderId === personId) for (const m of n.members) if (m !== personId) out.add(m);
  return out;
}
