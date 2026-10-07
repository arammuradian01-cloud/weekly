import * as React from 'react';

/**
 * Кнопка. variant: primary (главная зелёная, одна на экране), dark, secondary, outline, text, danger. size: sm 36, md 44, lg 52. icon: имя Lucide. hotkey: подсказка горячей клавиши.
 * @startingPoint section="Компоненты Сравни" subtitle="Кнопка. variant: primary (главная зелёная, одна на экране), dark, secondary, out" viewport="700x400"
 */
export interface ButtonProps {
  /** variant */
  variant?: string;
  /** size */
  size?: number | string | any;
  /** block */
  block?: boolean;
  /** loading */
  loading?: number | string | any;
  /** pressed */
  pressed?: boolean;
  /** className */
  className?: string;
  /** href */
  href?: string;
  /** type */
  type?: string;
  /** disabled */
  disabled?: boolean;
  /** onClick */
  onClick?: (...args: any[]) => void;
  /** title */
  title?: string;
  /** style */
  style?: React.CSSProperties;
  /** icon */
  icon?: string;
  /** children */
  children?: React.ReactNode;
  /** iconRight */
  iconRight?: any;
  /** hotkey */
  hotkey?: any;
}
export function Button(props: ButtonProps): React.ReactElement | null;

