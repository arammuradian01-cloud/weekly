import * as React from 'react';

/**
 * Сегментный переключатель, как на главной сайта: «По людям / По блокам», «Таблица / По статусам / По людям», «Задача / Просьба». items: [{ value, label, icon, count, disabled }].
 * @startingPoint section="Компоненты Сравни" subtitle="Сегментный переключатель, как на главной сайта: «По людям / По блокам», «Таблица" viewport="700x400"
 */
export interface SegmentedProps {
  /** block */
  block?: boolean;
  /** size */
  size?: number | string | any;
  /** className */
  className?: string;
  /** label */
  label?: string;
  /** style */
  style?: React.CSSProperties;
  /** items */
  items?: any[];
  /** value */
  value?: number | string | any;
  /** onChange */
  onChange?: (...args: any[]) => void;
}
export function Segmented(props: SegmentedProps): React.ReactElement | null;

