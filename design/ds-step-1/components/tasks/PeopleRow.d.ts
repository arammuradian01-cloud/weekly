import * as React from 'react';

/**
 * Строка вида «По людям»: сотрудник и его задачи плашками по сроку, чтобы видеть перегруз и простой. tasks: [{ id, title, kind: 'overdue' | 'soon' | 'done' | 'normal' }].
 * @startingPoint section="Компоненты Сравни" subtitle="Строка вида «По людям»: сотрудник и его задачи плашками по сроку, чтобы видеть п" viewport="700x400"
 */
export interface PeopleRowProps {
  /** tasks */
  tasks?: any[];
  /** style */
  style?: React.CSSProperties;
  /** name */
  name?: string;
  /** weekly */
  weekly?: string;
  /** sub */
  sub?: any;
  /** onOpen */
  onOpen?: (...args: any[]) => void;
}
export function PeopleRow(props: PeopleRowProps): React.ReactElement | null;

