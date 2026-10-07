import * as React from 'react';

/**
 * Кнопка-иконка. Обязателен label (читается вслух и показывается как подсказка). size: md 44, sm 36, xs 28.
 * @startingPoint section="Компоненты Сравни" subtitle="Кнопка-иконка. Обязателен label (читается вслух и показывается как подсказка). s" viewport="700x400"
 */
export interface IconButtonProps {
  /** size */
  size?: number | string | any;
  /** variant */
  variant?: string;
  /** selected */
  selected?: boolean;
  /** className */
  className?: string;
  /** label */
  label?: string;
  /** disabled */
  disabled?: boolean;
  /** onClick */
  onClick?: (...args: any[]) => void;
  /** style */
  style?: React.CSSProperties;
  /** icon */
  icon?: string;
}
export function IconButton(props: IconButtonProps): React.ReactElement | null;

