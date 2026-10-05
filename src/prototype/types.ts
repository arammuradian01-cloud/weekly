// Модель данных прототипа. Повторяет раздел 8 ТЗ, чтобы на этапах 3-4 экраны переехали на базу без переделки.

import type { IsoDate } from "./dates";
import type {
  BlockCode,
  DirectionCode,
  EntryTypeCode,
  PriorityCode,
  SourceCode,
  StateCode,
  StatusCode,
  WeeklyStateCode,
} from "./dictionaries";

export type PersonSlug =
  | "muradyan"
  | "golovkin"
  | "reva"
  | "loginova"
  | "fatyanov"
  | "sakhibullina"
  | "afanasyev"
  | "cheychenets";

export type Role = "OWNER" | "ADMIN" | "LEADER" | "OBSERVER";

export type Person = {
  slug: PersonSlug;
  fullName: string;
  shortName: string;
  role: Role;
  zone: string;
  direction: DirectionCode;
};

/** «Все лидеры» допустимы только для общих задач (раздел 4 ТЗ) */
export type Owner = PersonSlug | "all";

export type Transfer = { from: IsoDate; to: IsoDate; by: PersonSlug; reason: string; at: IsoDate };

export type Comment = { id: string; author: PersonSlug; text: string; at: IsoDate; time: string };

export type HistoryItem = {
  id: string;
  at: IsoDate;
  time: string;
  by: PersonSlug | "system";
  field: string;
  before?: string;
  after?: string;
};

export type Link = { title: string; url: string };

export type Task = {
  number: number;
  title: string;
  outcome: string;
  owner: Owner;
  coExecutors: PersonSlug[];
  direction: DirectionCode;
  priority: PriorityCode;
  status: StatusCode;
  state: StateCode;
  /** Чем заблокирована и кто может помочь: обязательно при «Заблокирована» */
  blockedBy?: string;
  where: string;
  whereUpdatedAt: IsoDate;
  due: IsoDate;
  originalDue: IsoDate;
  transfers: Transfer[];
  source: { kind: SourceCode; note: string };
  links: Link[];
  comments: Comment[];
  history: HistoryItem[];
  createdBy: PersonSlug;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  closedAt?: IsoDate;
  /** Итог для «Выполнена» или причина для «Не выполнена» и «Отменена» */
  resolution?: string;
  archived?: boolean;
};

export type WeeklyEntry = {
  id: string;
  week: number;
  author: PersonSlug;
  direction: DirectionCode;
  block: BlockCode;
  type: EntryTypeCode;
  what: string;
  details?: string;
  impact?: string;
  next?: string;
  help?: string;
  links: Link[];
  ceo: boolean;
  /** Номер задачи, созданной кнопкой «Сделать задачей» */
  taskNumber?: number;
};

export type PersonWeekly = {
  week: number;
  author: PersonSlug;
  headline: string;
  state: WeeklyStateCode;
  submittedAt?: string;
};

export type JournalEvent = {
  id: string;
  at: IsoDate;
  time: string;
  by: PersonSlug | "system";
  source: "app" | "sheet" | "system";
  kind: "task" | "weekly" | "comment" | "login" | "settings" | "sync";
  object: string;
  field?: string;
  before?: string;
  after?: string;
};
