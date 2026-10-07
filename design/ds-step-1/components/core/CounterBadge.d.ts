import * as React from 'react';

/**
 * Счётчик-бейдж: в меню, на фильтрах, у вкладок. tone: accent (по умолчанию), neutral, danger, inverse (на тёмном меню). dot: только точка без числа. max: верхний предел, дальше «99+».
 * @startingPoint section="Компоненты Сравни" subtitle="Счётчик-бейдж: в меню, на фильтрах, у вкладок. tone: accent (по умолчанию), neut" viewport="700x400"
 */
export interface CounterBadgeProps {
  /** max */
  max?: number;
  /** value */
  value?: number | string | any;
  /** dot */
  dot?: boolean;
  /** tone */
  tone?: string;
  /** label */
  label?: string;
}
export function CounterBadge(props: CounterBadgeProps): React.ReactElement | null;

