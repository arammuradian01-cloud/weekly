import * as React from 'react';

/**
 * Многострочное поле. Счётчик знаков идёт через FormField (max, count): «Что произошло» до 150, «Подробнее» до 1000.
 * @startingPoint section="Компоненты Сравни" subtitle="Многострочное поле. Счётчик знаков идёт через FormField (max, count): «Что произ" viewport="700x400"
 */
export interface TextareaProps {
  /** error */
  error?: boolean;
  /** disabled */
  disabled?: boolean;
  /** focused */
  focused?: boolean;
  /** className */
  className?: string;
  /** style */
  style?: React.CSSProperties;
  /** id */
  id?: string;
  /** rows */
  rows?: number;
  /** value */
  value?: number | string | any;
  /** defaultValue */
  defaultValue?: any;
  /** placeholder */
  placeholder?: string;
  /** onChange */
  onChange?: (...args: any[]) => void;
  /** hardMax */
  hardMax?: boolean;
}
export function Textarea(props: TextareaProps): React.ReactElement | null;

