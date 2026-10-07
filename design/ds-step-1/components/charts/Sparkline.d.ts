import * as React from 'react';

/**
 * Мини-график в карточке лидера: линия по последним неделям, текущее значение и изменение. values: числа; trend: up | down | flat (цвет линии).
 * @startingPoint section="Компоненты Сравни" subtitle="Мини-график в карточке лидера: линия по последним неделям, текущее значение и из" viewport="700x400"
 */
export interface SparklineProps {
  /** values */
  values?: any[];
  /** width */
  width?: number;
  /** height */
  height?: number;
  /** trend */
  trend?: any;
  /** lowerIsBetter */
  lowerIsBetter?: boolean;
  /** style */
  style?: React.CSSProperties;
  /** label */
  label?: string;
  /** showValue */
  showValue?: boolean;
  /** unit */
  unit?: string;
  /** showDelta */
  showDelta?: boolean;
}
export function Sparkline(props: SparklineProps): React.ReactElement | null;

