// Справочники экранов. Направления, блоки, типы записей и источники задач приходят из базы (этап 5):
// layout передаёт их снимок, экран подменяет им стартовые значения ниже. Стартовые значения те же, что в prisma/seed-data.ts.
// Статусы, приоритеты и состояния остаются в коде: на них завязаны правила просрочки и цвета.

import type { BadgeTone } from "@/components/ui/badge";

/** Код значения из справочника в базе. Новые значения добавляют владелец и администраторы */
export type DirectionCode = string;
export type BlockCode = string;
export type EntryTypeCode = "result" | "event" | "risk" | "plan";
export type StatusCode = "proposed" | "in-progress" | "clarify" | "done" | "partial" | "failed" | "cancelled";
/** unset: задача пришла из таблицы, где приоритета нет. Выбрать «не задан» вручную нельзя */
export type PriorityCode = "critical" | "high" | "medium" | "low" | "unset";
/** unset: задача пришла из таблицы, где состояния нет. Выбрать «не задано» вручную нельзя */
export type StateCode = "on-track" | "at-risk" | "blocked" | "unset";
export type WeeklyStateCode = "not-started" | "draft" | "submitted" | "late";
export type SourceCode = string;

type Item<C extends string> = { code: C; label: string };
/** Значение справочника из базы. Скрытое пропадает из выбора, но остаётся подписью в старых записях */
export type DictEntry = { code: string; label: string; active: boolean };
export type EditableDictKind = "DIRECTION" | "WEEKLY_BLOCK" | "ENTRY_TYPE" | "TASK_SOURCE";

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
  { code: "partial", label: "Выполнена частично", tone: "orange" },
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

/** Коды типов записей, на которых держатся разделы отчёта CEO */
export const ENTRY_TYPE_CODES: EntryTypeCode[] = ["result", "event", "risk", "plan"];

// Полные списки со скрытыми значениями: по ним подписываются старые записи
const ALL: Record<EditableDictKind, DictEntry[]> = {
  DIRECTION: DIRECTIONS.map((d) => ({ ...d, active: true })),
  WEEKLY_BLOCK: BLOCKS.map((d) => ({ ...d, active: true })),
  ENTRY_TYPE: ENTRY_TYPES.map((d) => ({ ...d, active: true })),
  TASK_SOURCE: SOURCES.map((d) => ({ ...d, active: true })),
};
const ACTIVE: Record<EditableDictKind, Item<string>[]> = { DIRECTION: DIRECTIONS, WEEKLY_BLOCK: BLOCKS, ENTRY_TYPE: ENTRY_TYPES, TASK_SOURCE: SOURCES };

/**
 * Подменить стартовые значения справочниками из базы. Массивы меняются на месте:
 * DIRECTIONS, BLOCKS и остальные остаются теми же объектами, которые импортировали экраны
 */
export function applyDictionaries(dicts: Record<EditableDictKind, DictEntry[]>) {
  for (const kind of Object.keys(ACTIVE) as EditableDictKind[]) {
    const list = dicts[kind];
    if (!list?.length) continue;
    ALL[kind].splice(0, ALL[kind].length, ...list);
    // Тип записи без кода из правил отчёта CEO не показываем: новых типов нет, только переименование и скрытие
    const active = list.filter((d) => d.active && (kind !== "ENTRY_TYPE" || ENTRY_TYPE_CODES.includes(d.code as EntryTypeCode)));
    ACTIVE[kind].splice(0, ACTIVE[kind].length, ...active.map((d) => ({ code: d.code, label: d.label })) as never[]);
  }
}

/** Значения для выпадающего списка: видимые плюс текущее, даже если его скрыли */
export function dictOptions(kind: EditableDictKind, current?: string): { value: string; label: string }[] {
  const options = ACTIVE[kind].map((d) => ({ value: d.code, label: d.label }));
  if (current && !options.some((o) => o.value === current)) options.push({ value: current, label: `${labelIn(kind, current)} (скрыто)` });
  return options;
}

function labelIn(kind: EditableDictKind, code: string): string {
  return ALL[kind].find((i) => i.code === code)?.label ?? code;
}

function labelOf<C extends string>(list: Item<C>[], code: C): string {
  return list.find((i) => i.code === code)?.label ?? code;
}

export const directionLabel = (c: DirectionCode) => labelIn("DIRECTION", c);
export const blockLabel = (c: BlockCode) => labelIn("WEEKLY_BLOCK", c);
export const entryTypeLabel = (c: EntryTypeCode) => labelIn("ENTRY_TYPE", c);
export const statusOf = (c: StatusCode) => STATUSES.find((s) => s.code === c)!;
export const priorityOf = (c: PriorityCode) => PRIORITIES.find((p) => p.code === c) ?? PRIORITY_UNSET;
export const stateLabel = (c: StateCode) => labelOf([...STATES, STATE_UNSET], c);
export const weeklyStateOf = (c: WeeklyStateCode) => WEEKLY_STATES.find((s) => s.code === c)!;
export const sourceLabel = (c: SourceCode) => labelIn("TASK_SOURCE", c);

/** Открытые статусы: по ним считается просрочка (раздел 4 ТЗ) */
export const OPEN_STATUSES: StatusCode[] = ["in-progress", "clarify"];
/** Закрытые статусы: задача больше не в работе */
export const CLOSED_STATUSES: StatusCode[] = ["done", "partial", "failed", "cancelled"];
