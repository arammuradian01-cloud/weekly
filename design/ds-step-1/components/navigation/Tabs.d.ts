import * as React from 'react';

/**
 * Текстовые вкладки с голубым подчёркиванием, как на ОСАГО. items: [{ value, label, count, disabled }].
 * @startingPoint section="Компоненты Сравни" subtitle="Текстовые вкладки с голубым подчёркиванием, как на ОСАГО. items: [{ value, label" viewport="700x400"
 */
export interface TabsProps {
  /** plain */
  plain?: boolean;
  /** size */
  size?: number | string | any;
  /** className */
  className?: string;
  /** style */
  style?: React.CSSProperties;
  /** items */
  items?: any[];
  /** value */
  value?: number | string | any;
  /** onChange */
  onChange?: (...args: any[]) => void;
}
export function Tabs(props: TabsProps): React.ReactElement | null;

