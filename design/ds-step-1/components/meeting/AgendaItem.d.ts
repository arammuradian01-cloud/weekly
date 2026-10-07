import * as React from 'react';

/**
 * Пункт повестки в списке подготовки: источник (задача, запись, просьба), автор, вопрос одной фразой, примерное время, действия убрать и отложить. item: { n, title, source, sourceLabel, author, minutes, current, done, status }. AgendaItemBig: пункт на проекторе с контекстом.
 * @startingPoint section="Компоненты Сравни" subtitle="Пункт повестки в списке подготовки: источник (задача, запись, просьба), автор, в" viewport="700x400"
 */
export interface AgendaItemProps {
  /** item */
  item?: any;
  /** style */
  style?: React.CSSProperties;
  /** draggable */
  draggable?: boolean;
  /** onRemove */
  onRemove?: (...args: any[]) => void;
  /** onDefer */
  onDefer?: (...args: any[]) => void;
}
export function AgendaItem(props: AgendaItemProps): React.ReactElement | null;

/** Пункт повестки в списке подготовки: источник (задача, запись, просьба), автор, вопрос одной фразой, примерное время, действия убрать и отложить. item: { n, title, source, sourceLabel, author, minutes, current, done, status }. AgendaItemBig: пункт на проекторе с контекстом. */
export interface AgendaItemBigProps {
  /** item */
  item?: any;
  /** style */
  style?: React.CSSProperties;
  /** onDecision */
  onDecision?: (...args: any[]) => void;
  /** onTask */
  onTask?: (...args: any[]) => void;
  /** onStatus */
  onStatus?: (...args: any[]) => void;
  /** onDue */
  onDue?: (...args: any[]) => void;
  /** onDone */
  onDone?: (...args: any[]) => void;
}
export function AgendaItemBig(props: AgendaItemBigProps): React.ReactElement | null;

