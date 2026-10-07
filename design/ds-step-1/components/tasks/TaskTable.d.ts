import * as React from 'react';

/** Таблица задач. Колонки: №, задача и «где сейчас», ответственный, приоритет, статус, состояние, срок. rows: [{ id, title, now, owner, priority, status, state, outside, due, overdueDays, soon, selected, closed, group, blocked }]. groupBy: поле группировки (owner и др.), строки должны быть уже отсортированы. selectable: чекбоксы. onEdit(row, field): правка статуса и состояния в строке. loading: число скелетонных строк. dense: строка 44 (по умолчанию) или comfortable 52. */
export interface InlineEditProps {
  /** open */
  open?: boolean;
  /** onClick */
  onClick?: (...args: any[]) => void;
  /** label */
  label?: string;
  /** children */
  children?: React.ReactNode;
}
export function InlineEdit(props: InlineEditProps): React.ReactElement | null;

/**
 * Таблица задач. Колонки: №, задача и «где сейчас», ответственный, приоритет, статус, состояние, срок. rows: [{ id, title, now, owner, priority, status, state, outside, due, overdueDays, soon, selected, closed, group, blocked }]. groupBy: поле группировки (owner и др.), строки должны быть уже отсортированы. selectable: чекбоксы. onEdit(row, field): правка статуса и состояния в строке. loading: число скелетонных строк. dense: строка 44 (по умолчанию) или comfortable 52.
 * @startingPoint section="Компоненты Сравни" subtitle="Таблица задач. Колонки: №, задача и «где сейчас», ответственный, приоритет, стат" viewport="700x400"
 */
export interface TaskTableProps {
  /** rows */
  rows?: number;
  /** columns */
  columns?: any[];
  /** selected */
  selected?: boolean;
  /** onSelect */
  onSelect?: (...args: any[]) => void;
  /** loading */
  loading?: number | string | any;
  /** selectable */
  selectable?: boolean;
  /** groupBy */
  groupBy?: any;
  /** onOpen */
  onOpen?: (...args: any[]) => void;
  /** onEdit */
  onEdit?: (...args: any[]) => void;
  /** className */
  className?: string;
  /** style */
  style?: React.CSSProperties;
  /** dense */
  dense?: any;
  /** sort */
  sort?: string;
  /** onSort */
  onSort?: (...args: any[]) => void;
}
export function TaskTable(props: TaskTableProps): React.ReactElement | null;

