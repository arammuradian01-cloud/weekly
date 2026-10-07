import * as React from 'react';

/**
 * Карточка просьбы: кто, кому, что, к какому сроку, связанная задача, ответ. request: { from, to, text, due, status: waiting | accepted | done | declined | overdue, task, answer: { by, text, due } }. role: recipient (адресат: «Принять и назвать срок», «Отклонить с причиной», «Выполнено», «Сделать задачей») или author («Отозвать», «Напомнить»).
 * @startingPoint section="Компоненты Сравни" subtitle="Карточка просьбы: кто, кому, что, к какому сроку, связанная задача, ответ. reque" viewport="700x400"
 */
export interface RequestCardProps {
  /** request */
  request?: string;
  /** role */
  role?: string;
  /** style */
  style?: React.CSSProperties;
  /** onAccept */
  onAccept?: (...args: any[]) => void;
  /** onDecline */
  onDecline?: (...args: any[]) => void;
  /** onDone */
  onDone?: (...args: any[]) => void;
  /** onToTask */
  onToTask?: (...args: any[]) => void;
  /** onRemind */
  onRemind?: (...args: any[]) => void;
  /** onWithdraw */
  onWithdraw?: (...args: any[]) => void;
}
export function RequestCard(props: RequestCardProps): React.ReactElement | null;

