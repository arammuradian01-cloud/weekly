import * as React from 'react';

/**
 * «Показать ещё»: кнопка с остатком. shown, total.
 * @startingPoint section="Компоненты Сравни" subtitle="«Показать ещё»: кнопка с остатком. shown, total." viewport="700x400"
 */
export interface ShowMoreProps {
  /** total */
  total?: number;
  /** shown */
  shown?: number;
  /** style */
  style?: React.CSSProperties;
  /** onMore */
  onMore?: (...args: any[]) => void;
  /** loading */
  loading?: number | string | any;
  /** step */
  step?: number;
}
export function ShowMore(props: ShowMoreProps): React.ReactElement | null;

