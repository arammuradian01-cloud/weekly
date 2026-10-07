import * as React from 'react';

/**
 * Панель массовых действий при выборе строк: залипает снизу. actions: [{ key, label, icon, danger }].
 * @startingPoint section="Компоненты Сравни" subtitle="Панель массовых действий при выборе строк: залипает снизу. actions: [{ key, labe" viewport="700x400"
 */
export interface BulkActionsBarProps {
  /** actions */
  actions?: React.ReactNode;
  /** count */
  count?: number;
  /** style */
  style?: React.CSSProperties;
  /** onAction */
  onAction?: (...args: any[]) => void;
  /** onClear */
  onClear?: (...args: any[]) => void;
}
export function BulkActionsBar(props: BulkActionsBarProps): React.ReactElement | null;

