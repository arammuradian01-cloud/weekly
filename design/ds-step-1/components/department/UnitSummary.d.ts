import * as React from 'react';

/**
 * Сводка подразделения в панели: люди, задачи, просрочка, цели. cells: [{ label, value, tone }].
 * @startingPoint section="Компоненты Сравни" subtitle="Сводка подразделения в панели: люди, задачи, просрочка, цели. cells: [{ label, v" viewport="700x400"
 */
export interface UnitSummaryProps {
  /** style */
  style?: React.CSSProperties;
  /** cells */
  cells?: any[];
}
export function UnitSummary(props: UnitSummaryProps): React.ReactElement | null;

