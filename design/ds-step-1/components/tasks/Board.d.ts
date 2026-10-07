import * as React from 'react';

/** Колонка статуса и карточка задачи для доски и вида «По статусам». Полоска слева показывает состояние: ok, risk, blocked. BoardCard: { id, title, owner, due, overdueDays, state, blocked, priority, dragging, placeholder }. */
export interface BoardColumnProps {
  /** count */
  count?: number;
  /** children */
  children?: React.ReactNode;
  /** over */
  over?: boolean;
  /** title */
  title?: string;
  /** style */
  style?: React.CSSProperties;
  /** status */
  status?: string;
  /** emptyText */
  emptyText?: string;
}
export function BoardColumn(props: BoardColumnProps): React.ReactElement | null;

/** Колонка статуса и карточка задачи для доски и вида «По статусам». Полоска слева показывает состояние: ok, risk, blocked. BoardCard: { id, title, owner, due, overdueDays, state, blocked, priority, dragging, placeholder }. */
export interface BoardCardProps {
  /** task */
  task?: string;
  /** onOpen */
  onOpen?: (...args: any[]) => void;
  /** style */
  style?: React.CSSProperties;
  /** children */
  children?: React.ReactNode;
}
export function BoardCard(props: BoardCardProps): React.ReactElement | null;

/**
 * Колонка статуса и карточка задачи для доски и вида «По статусам». Полоска слева показывает состояние: ok, risk, blocked. BoardCard: { id, title, owner, due, overdueDays, state, blocked, priority, dragging, placeholder }.
 * @startingPoint section="Компоненты Сравни" subtitle="Колонка статуса и карточка задачи для доски и вида «По статусам». Полоска слева " viewport="700x400"
 */
export interface BoardProps {
  /** count */
  count?: number;
  /** children */
  children?: React.ReactNode;
  /** over */
  over?: boolean;
  /** title */
  title?: string;
  /** style */
  style?: React.CSSProperties;
  /** status */
  status?: string;
  /** emptyText */
  emptyText?: string;
}
export function Board(props: BoardProps): React.ReactElement | null;

