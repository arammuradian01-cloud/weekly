// Встреча 2.0 (этап 23, модуль М7): типы для экранов. Повестка, пункты, решения, протокол.

import type { IsoDate } from "./dates";
import type { PersonSlug, WeekKey } from "./types";

export type MeetingStatusCode = "planned" | "live" | "done";

export type AgendaKindCode = "follow-up" | "request" | "task-state" | "task-attention" | "question" | "proposal" | "person" | "manual";

export const AGENDA_KIND_LABELS: Record<AgendaKindCode, string> = {
  "follow-up": "Поручение прошлой встречи",
  request: "Просьба",
  "task-state": "Риск или блокер",
  "task-attention": "Задача на контроле",
  question: "Вопрос к записи",
  proposal: "Предложенная задача",
  person: "Weekly",
  manual: "Пункт ведущего",
};

/** Блоки повестки по порядку: прошлые поручения, риски и помощь, лидеры по очереди, решения */
export type AgendaBlock = "follow-up" | "attention" | "people" | "manual";

export const AGENDA_BLOCKS: { code: AgendaBlock; label: string }[] = [
  { code: "follow-up", label: "Поручения прошлой встречи" },
  { code: "attention", label: "Риски и помощь" },
  { code: "people", label: "Лидеры по очереди" },
  { code: "manual", label: "Добавлено ведущим" },
];

export function blockOf(kind: AgendaKindCode): AgendaBlock {
  if (kind === "follow-up") return "follow-up";
  if (kind === "person") return "people";
  if (kind === "manual") return "manual";
  return "attention";
}

export type AgendaItemView = {
  id: string;
  kind: AgendaKindCode;
  title: string;
  note?: string;
  sortOrder: number;
  auto: boolean;
  discussed: boolean;
  discussedBy?: PersonSlug;
  task?: { number: number; title: string; status: string; state: string; due: IsoDate; owner: PersonSlug | null };
  entry?: { id: string; what: string; author: PersonSlug | null };
  request?: { number: number; text: string; status: string; author: PersonSlug; addressee: PersonSlug };
  person?: PersonSlug;
  /** Решения, записанные в этом пункте */
  decisions: DecisionView[];
};

export type DecisionView = {
  id: string;
  text: string;
  owner: PersonSlug | null;
  date: IsoDate;
  status: "active" | "cancelled";
  cancelReason?: string;
  tasks: { number: number; title: string }[];
  meeting?: { week: WeekKey; number: number; team: string };
  createdBy: PersonSlug | null;
};

export type MeetingView = {
  id: string;
  week: WeekKey;
  weekNumber: number;
  team: string;
  teamName: string;
  date: IsoDate;
  time: string | null;
  status: MeetingStatusCode;
  leader: PersonSlug | null;
  currentItemId: string | null;
  startedAt?: string;
  closedAt?: string;
  agendaBuiltAt?: string;
  timerMinutes: number;
  protocol?: string;
  protocolSentAt?: string;
  notionUrl?: string;
  items: AgendaItemView[];
  decisions: DecisionView[];
  /** Участники встречи: от кого ждут weekly в команде */
  participants: PersonSlug[];
  /** Можно вести: начать, листать, отмечать, записывать решения, закрыть */
  canLead: boolean;
};

/** Таймер на человека: сколько секунд прошло с начала его пункта */
export function timerText(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
