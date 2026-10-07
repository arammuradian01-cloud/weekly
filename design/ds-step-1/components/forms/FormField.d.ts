import * as React from 'react';

/**
 * Обёртка поля: подпись, подсказка или ошибка, счётчик знаков. Ошибка говорит, что случилось и что делать.
 * @startingPoint section="Компоненты Сравни" subtitle="Обёртка поля: подпись, подсказка или ошибка, счётчик знаков. Ошибка говорит, что" viewport="700x400"
 */
export interface FormFieldProps {
  /** max */
  max?: number;
  /** count */
  count?: number;
  /** error */
  error?: boolean;
  /** hint */
  hint?: string;
  /** disabled */
  disabled?: boolean;
  /** className */
  className?: string;
  /** style */
  style?: React.CSSProperties;
  /** label */
  label?: string;
  /** htmlFor */
  htmlFor?: any;
  /** optional */
  optional?: boolean;
  /** children */
  children?: React.ReactNode;
}
export function FormField(props: FormFieldProps): React.ReactElement | null;

