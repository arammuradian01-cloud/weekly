import * as React from 'react';

/**
 * Переключатель команд в верхней панели слева от недели. teams: [{ id, name, role: 'lead' | 'member', sub }], плюс «Все мои команды» у руководителей. Выбор запоминается. compact: вид для шапки раздела на телефоне.
 * @startingPoint section="Компоненты Сравни" subtitle="Переключатель команд в верхней панели слева от недели. teams: [{ id, name, role:" viewport="700x400"
 */
export interface TeamSwitcherProps {
  /** open */
  open?: boolean;
  /** teams */
  teams?: any[];
  /** value */
  value?: number | string | any;
  /** onChange */
  onChange?: (...args: any[]) => void;
  /** compact */
  compact?: boolean;
  /** style */
  style?: React.CSSProperties;
  /** staticMenu */
  staticMenu?: boolean;
  /** showAll */
  showAll?: boolean;
}
export function TeamSwitcher(props: TeamSwitcherProps): React.ReactElement | null;

