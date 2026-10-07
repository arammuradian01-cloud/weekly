import * as React from 'react';

/**
 * Столбики и линия по неделям. data: [{ label, bar, line, current }]. insight: одна фраза с выводом. barLabel, lineLabel: легенда. max: верх шкалы.
 * @startingPoint section="Компоненты Сравни" subtitle="Столбики и линия по неделям. data: [{ label, bar, line, current }]. insight: одн" viewport="700x400"
 */
export interface BarLineChartProps {
  /** data */
  data?: any[];
  /** max */
  max?: number;
  /** style */
  style?: React.CSSProperties;
  /** title */
  title?: string;
  /** unit */
  unit?: string;
  /** showValues */
  showValues?: boolean;
  /** barLabel */
  barLabel?: string;
  /** lineLabel */
  lineLabel?: string;
  /** insight */
  insight?: string;
}
export function BarLineChart(props: BarLineChartProps): React.ReactElement | null;

