// Встречи один на один (этап 28): правила без базы. Кто с кем встречается, кто что видит.
//
// - Пара: руководитель команды и участник этой команды (не сам руководитель). У Арама это люди топ-команды,
//   у руководителя управления руководители его отделов и секторов, у руководителя сектора специалисты.
// - Видят встречу только двое участников и только при личном входе. Режим управления прав не добавляет: администратор
//   по общему логину и выбранному профилю не прочитает чужую встречу.
// - Повестку ставит человек, темы может добавить и руководитель. Незакрытая тема переходит на следующую встречу сама.
// - Общие заметки видят оба, личную заметку только её автор.

import { addDays, type IsoDate } from "@/domain/dates";
import type { LoginMethod } from "@/generated/prisma/enums";

export type PairNode = { id: string; leaderId: string | null; members: string[]; active: boolean };
export type PairLink = { managerId: string; reportId: string; teamId: string };

export const TOPIC_MAX = 500;
export const OUTCOME_MAX = 2000;
export const NOTES_MAX = 20000;
/** Через сколько дней по умолчанию следующая встреча */
export const NEXT_DAYS = 7;

/** Личный вход: общий логин team не годится, его знает вся топ-команда и профиль в нём выбирают сами */
export function personalLogin(via: LoginMethod | null | undefined): boolean {
  return !!via && via !== "TEAM";
}

/** Пары человека по структуре: где он руководитель команды и где он участник чужой команды */
export function pairLinks(nodes: PairNode[], personId: string): PairLink[] {
  const out = new Map<string, PairLink>();
  for (const n of nodes) {
    if (!n.active || !n.leaderId) continue;
    if (n.leaderId === personId) {
      for (const m of n.members) if (m !== personId && !out.has(`${personId}/${m}`)) out.set(`${personId}/${m}`, { managerId: personId, reportId: m, teamId: n.id });
    } else if (n.members.includes(personId) && !out.has(`${n.leaderId}/${personId}`)) {
      out.set(`${n.leaderId}/${personId}`, { managerId: n.leaderId, reportId: personId, teamId: n.id });
    }
  }
  return [...out.values()];
}

/** Связь двух людей по структуре: кто из них руководитель. Нет общей команды: null */
export function linkBetween(nodes: PairNode[], a: string, b: string): PairLink | null {
  if (a === b) return null;
  return pairLinks(nodes, a).find((l) => (l.managerId === a && l.reportId === b) || (l.managerId === b && l.reportId === a)) ?? null;
}

/** Дата следующей встречи по умолчанию: через неделю после этой, но не раньше завтра */
export function nextMeetingDate(lastDate: IsoDate, today: IsoDate): IsoDate {
  const week = addDays(lastDate, NEXT_DAYS);
  const tomorrow = addDays(today, 1);
  return week > tomorrow ? week : tomorrow;
}

/** Текст темы: одна-две фразы, длинное тире и стрелки заменяются на дефис */
export function cleanTopic(text: unknown, max = TOPIC_MAX): string {
  return String(text ?? "")
    .replace(/[—–→⟶⇒]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Многострочный текст (итог, заметки): переносы строк остаются */
export function cleanText(text: unknown, max: number): string {
  return String(text ?? "")
    .replace(/[—–→⟶⇒]/g, "-")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

/** Предмет события «Мне» по паре: события одной пары склеиваются в одну строку */
export function pairSubject(pairId: string): string {
  return `1on1:${pairId}`;
}

export function pairIdOfSubject(subject: string): string | null {
  return subject.startsWith("1on1:") ? subject.slice(5) || null : null;
}
