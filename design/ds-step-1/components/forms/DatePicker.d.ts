import * as React from 'react';

/**
 * Выбор даты с быстрыми вариантами: завтра, пятница, через неделю. value: Date или null. open: открыт для макета. marked: даты с отметкой (срок weekly, встреча).
 * @startingPoint section="Компоненты Сравни" subtitle="Выбор даты с быстрыми вариантами: завтра, пятница, через неделю. value: Date или" viewport="700x400"
 */
export interface DatePickerProps {
  /** today */
  today?: any;
  /** open */
  open?: boolean;
  /** value */
  value?: number | string | any;
  /** size */
  size?: number | string | any;
  /** onChange */
  onChange?: (...args: any[]) => void;
  /** marked */
  marked?: any[];
  /** style */
  style?: React.CSSProperties;
  /** error */
  error?: boolean;
  /** disabled */
  disabled?: boolean;
  /** placeholder */
  placeholder?: string;
  /** required */
  required?: boolean;
  /** staticMenu */
  staticMenu?: boolean;
}
export function DatePicker(props: DatePickerProps): React.ReactElement | null;

