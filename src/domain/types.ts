// Модель данных экранов. Повторяет раздел 8 ТЗ; задачи и weekly приходят в этом виде из базы (этапы 3 и 4).

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

/** Короткое имя человека из базы: «reva», «golovkin». Новых людей добавляет владелец в настройках */
export type PersonSlug = string;

export type Role = "OWNER" | "ADMIN" | "LEADER" | "OBSERVER" | "EMPLOYEE";

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

/** from = null: срок переносили в таблице до запуска ресурса, прежний срок не записан */
export type Transfer = { from: IsoDate | null; to: IsoDate; by: PersonSlug | null; reason: string; at: IsoDate | null };

/** Реакции: набор фиксированный (этап 20) */
export type ReactionCode = "accepted" | "question" | "discuss" | "thanks";

/** Реакция. У «Обсудить на встрече» вопрос и отметка «обсуждено» */
export type ReactionView = { id: string; kind: ReactionCode; by: PersonSlug; question?: string; discussed?: boolean };

/**
 * Комментарий к задаче или к записи weekly. moment: момент в ISO, по нему экран знает, можно ли ещё править (15 минут).
 * edited: автор поправил текст (этап 20). Упоминания экран находит в тексте сам, по списку людей
 */
export type Comment = {
  id: string;
  author: PersonSlug;
  text: string;
  at: IsoDate;
  time: string;
  moment?: string;
  edited?: boolean;
  reactions?: ReactionView[];
};

export type HistoryItem = {
  id: string;
  at: IsoDate;
  time: string;
  by: PersonSlug | "system";
  field: string;
  before?: string;
  after?: string;
  /** Как вошёл автор (этап 9): личный вход или общий логин. Пусто у системы и старых событий */
  via?: "personal" | "team";
};

export type Link = { id?: string; title: string; url: string };

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
  /** Чем заблокирована и кто может помочь: пояснение при «Заблокирована» */
  blockedBy?: string;
  /** Что вернёт задачу в график: при «Есть риск» (этап 21) */
  riskNote?: string;
  /** Какие задачи эта ждёт (этап 21): номер, срок, закрыта ли */
  waitsFor?: { number: number; due: IsoDate; closed: boolean }[];
  where: string;
  whereUpdatedAt: IsoDate;
  due: IsoDate;
  originalDue: IsoDate;
  transfers: Transfer[];
  source: { kind: SourceCode; note: string };
  links: Link[];
  comments: Comment[];
  history: HistoryItem[];
  /** null: задача поставлена на встрече, автор в таблице не записан */
  createdBy: PersonSlug | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  /** Версия строки: момент последней правки. По ней свежая правка на экране не уступает запоздавшему ответу сервера */
  rev?: string;
  closedAt?: IsoDate;
  /** Итог для «Выполнена» или причина для «Не выполнена» и «Отменена» */
  resolution?: string;
  archived?: boolean;
  /** Команда задачи (этап 14): id из базы, у топ-команды «top» */
  team: string;
  /** Цель, на которую работает задача (этап 17) */
  goal?: { id: string; title: string };
  /**
   * Задача пришла в списке без текста комментариев (этап 14, большие команды): карточка дозагружает её целиком.
   * commentCount: сколько комментариев на самом деле
   */
  partial?: boolean;
  commentCount?: number;
};

/** Неделя определяется своим понедельником: «2026-09-28». Номер ISO для подписи считается из даты */
export type WeekKey = IsoDate;

export type WeekInfo = {
  key: WeekKey;
  /** Номер недели по ISO: 21-27.09.2026 это неделя 39 */
  number: number;
  year: number;
  start: IsoDate;
  end: IsoDate;
  /** Срок сдачи, момент в ISO */
  deadline: string;
  meetingDate: IsoDate;
  closed: boolean;
  /** Отчётная неделя: за неё сейчас пишут weekly */
  reporting: boolean;
};

export type WeeklyEntry = {
  id: string;
  week: WeekKey;
  /** null: общая запись без автора («Все лидеры» в таблице), ждёт распределения */
  author: PersonSlug | null;
  direction: DirectionCode;
  block: BlockCode;
  type: EntryTypeCode;
  what: string;
  details?: string;
  impact?: string;
  /** «Цифра или факт» из вкладки Weekly CEO */
  fact?: string;
  next?: string;
  help?: string;
  links: Link[];
  ceo: boolean;
  /** Номер задачи, созданной кнопкой «Сделать задачей» */
  taskNumber?: number;
  /** Кто поднял запись наверх, в свой weekly в команде выше, и его фраза (этап 15) */
  promoted?: { by: PersonSlug; note?: string }[];
  /** Обсуждение под записью и реакции на неё (этап 20) */
  comments?: Comment[];
  reactions?: ReactionView[];
};

export type PersonWeekly = {
  week: WeekKey;
  author: PersonSlug;
  headline: string;
  state: WeeklyStateCode;
  /** Когда сдан, момент в ISO */
  submittedAt?: string;
  /** Нет на этой неделе (этап 9): weekly не ждём, в счёт «сдали N из M» человек не входит */
  absent?: { substitute: PersonSlug | null };
  /** Свой срок, если он раньше срока недели: команда сдаёт раньше департамента (этап 15). Момент в ISO */
  deadline?: string;
  /** Weekly от человека в показанной команде не ждут (специалист): сдаёт по желанию, в счёт «сдали N из M» не входит */
  optional?: true;
};

/** Всё про одну неделю для ленты, режима встречи и отчёта CEO */
export type WeekView = {
  week: WeekInfo;
  /** Соседние недели для переключателя. next = null: дальше отчётной недели не листаем */
  prev: WeekKey;
  next: WeekKey | null;
  reportingKey: WeekKey;
  reportingNumber: number;
  /** Отчётная неделя пустая, поэтому открыта последняя неделя с записями */
  fallback: boolean;
  reports: PersonWeekly[];
  entries: WeeklyEntry[];
  /** Чьи записи свои для этой ленты (этап 15). Остальные записи пришли наверх и показываются у того, кто их поднял.
   *  Нет поля: все записи свои */
  authors?: PersonSlug[];
  /** Неделя закрыта для всего департамента (а не только для показанной команды) */
  departmentClosed?: boolean;
};

export type JournalEvent = {
  id: string;
  /** Адрес, с которого пришла правка: только у событий ресурса */
  ip?: string;
  at: IsoDate;
  time: string;
  by: PersonSlug | "system";
  source: "app" | "sheet" | "system";
  kind: "task" | "weekly" | "comment" | "login" | "settings" | "sync" | "system";
  object: string;
  field?: string;
  before?: string;
  after?: string;
  /** Как вошёл автор (этап 9): личный вход или общий логин. Пусто у системы и старых событий */
  via?: "personal" | "team";
};
