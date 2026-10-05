// Справочники экранов. Значения и порядок те же, что в prisma/seed-data.ts и разделах 3-4 ТЗ.
// Модуль без обращений к базе: им пользуются и сервер, и браузер. Справочники из базы подключим на этапе 5.

import type { BadgeTone } from "@/components/ui/badge";

export type DirectionCode = "osago" | "kasko" | "red" | "deposits" | "partners" | "product" | "insurance" | "department";
export type BlockCode = "key-changes" | "numbers" | "traffic" | "partners" | "product" | "risks" | "team";
export type EntryTypeCode = "result" | "event" | "risk" | "plan";
export type StatusCode = "proposed" | "in-progress" | "clarify" | "done" | "failed" | "cancelled";
/** unset: задача пришла из таблицы, где приоритета нет. Выбрать «не задан» вручную нельзя */
export type PriorityCode = "critical" | "high" | "medium" | "low" | "unset";
/** unset: задача пришла из таблицы, где состояния нет. Выбрать «не задано» вручную нельзя */
export type StateCode = "on-track" | "at-risk" | "blocked" | "unset";
export type WeeklyStateCode = "not-started" | "draft" | "submitted" | "late";
export type SourceCode = "meeting" | "weekly" | "ceo" | "other";

type Item<C extends string> = { code: C; label: string };

export const DIRECTIONS: Item<DirectionCode>[] = [
  { code: "osago", label: "ОСАГО" },
  { code: "kasko", label: "КАСКО" },
  { code: "red", label: "RED" },
  { code: "deposits", label: "Депозиты и инвестиции" },
  { code: "partners", label: "Партнёрка" },
  { code: "product", label: "Продукт и CJM" },
  // Есть в Insurance&Invest Bord, в справочнике ТЗ не было: сверить с Арамом
  { code: "insurance", label: "Страхование в целом" },
  { code: "department", label: "Департамент" },
];

export const BLOCKS: Item<BlockCode>[] = [
  { code: "key-changes", label: "Ключевые изменения" },
  // «Цифры и прогноз» и «Трафик и маркетинг» команда уже использует во вкладке Weekly CEO
  { code: "numbers", label: "Цифры и прогноз" },
  { code: "traffic", label: "Трафик и маркетинг" },
  { code: "partners", label: "Партнёры и СК" },
  { code: "product", label: "Продукт и CJM" },
  { code: "risks", label: "Риски и решения" },
  { code: "team", label: "Команда и процессы" },
];

export const ENTRY_TYPES: Item<EntryTypeCode>[] = [
  { code: "result", label: "Результат" },
  { code: "event", label: "Событие" },
  { code: "risk", label: "Риск" },
  { code: "plan", label: "План" },
];

export const STATUSES: (Item<StatusCode> & { tone: BadgeTone })[] = [
  { code: "proposed", label: "Предложена", tone: "outline" },
  { code: "in-progress", label: "В работе", tone: "blue" },
  { code: "clarify", label: "Требует уточнений", tone: "yellow" },
  { code: "done", label: "Выполнена", tone: "green" },
  { code: "failed", label: "Не выполнена", tone: "red" },
  { code: "cancelled", label: "Отменена", tone: "gray" },
];

export const PRIORITIES: (Item<PriorityCode> & { rank: number })[] = [
  { code: "critical", label: "Критичный", rank: 0 },
  { code: "high", label: "Высокий", rank: 1 },
  { code: "medium", label: "Средний", rank: 2 },
  { code: "low", label: "Низкий", rank: 3 },
];
const PRIORITY_UNSET = { code: "unset" as const, label: "Не задан", rank: 2 };

export const STATES: Item<StateCode>[] = [
  { code: "on-track", label: "В графике" },
  { code: "at-risk", label: "Есть риск" },
  { code: "blocked", label: "Заблокирована" },
];
const STATE_UNSET = { code: "unset" as const, label: "Не задано" };

export const WEEKLY_STATES: (Item<WeeklyStateCode> & { tone: BadgeTone })[] = [
  { code: "submitted", label: "Сдан", tone: "green" },
  { code: "late", label: "Сдан с опозданием", tone: "yellow" },
  { code: "draft", label: "Черновик", tone: "blue" },
  { code: "not-started", label: "Не начат", tone: "gray" },
];

export const SOURCES: Item<SourceCode>[] = [
  { code: "meeting", label: "Встреча" },
  { code: "weekly", label: "Запись weekly" },
  { code: "ceo", label: "Поручение CEO" },
  { code: "other", label: "Другое" },
];

function labelOf<C extends string>(list: Item<C>[], code: C): string {
  return list.find((i) => i.code === code)?.label ?? code;
}

export const directionLabel = (c: DirectionCode) => labelOf(DIRECTIONS, c);
export const blockLabel = (c: BlockCode) => labelOf(BLOCKS, c);
export const entryTypeLabel = (c: EntryTypeCode) => labelOf(ENTRY_TYPES, c);
export const statusOf = (c: StatusCode) => STATUSES.find((s) => s.code === c)!;
export const priorityOf = (c: PriorityCode) => PRIORITIES.find((p) => p.code === c) ?? PRIORITY_UNSET;
export const stateLabel = (c: StateCode) => labelOf([...STATES, STATE_UNSET], c);
export const weeklyStateOf = (c: WeeklyStateCode) => WEEKLY_STATES.find((s) => s.code === c)!;
export const sourceLabel = (c: SourceCode) => labelOf(SOURCES, c);

/** Открытые статусы: по ним считается просрочка (раздел 4 ТЗ) */
export const OPEN_STATUSES: StatusCode[] = ["in-progress", "clarify"];
/** Закрытые статусы: задача больше не в работе */
export const CLOSED_STATUSES: StatusCode[] = ["done", "failed", "cancelled"];
