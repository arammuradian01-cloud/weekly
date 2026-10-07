import * as React from 'react';

/**
 * Чекбокс: рамка D40 (1,5 px), отмеченный с заливкой акцента и тёмной галочкой. indeterminate для «выбраны не все».
 * @startingPoint section="Компоненты Сравни" subtitle="Чекбокс: рамка D40 (1,5 px), отмеченный с заливкой акцента и тёмной галочкой. in" viewport="700x400"
 */
export interface CheckboxProps {
  /** indeterminate */
  indeterminate?: boolean;
  /** disabled */
  disabled?: boolean;
  /** error */
  error?: boolean;
  /** className */
  className?: string;
  /** style */
  style?: React.CSSProperties;
  /** checked */
  checked?: boolean;
  /** defaultChecked */
  defaultChecked?: boolean;
  /** onChange */
  onChange?: (...args: any[]) => void;
  /** ariaLabel */
  ariaLabel?: string;
  /** name */
  name?: string;
  /** children */
  children?: React.ReactNode;
  /** sub */
  sub?: any;
}
export function Checkbox(props: CheckboxProps): React.ReactElement | null;

/** Чекбокс: рамка D40 (1,5 px), отмеченный с заливкой акцента и тёмной галочкой. indeterminate для «выбраны не все». */
export interface RadioProps {
  /** disabled */
  disabled?: boolean;
  /** className */
  className?: string;
  /** name */
  name?: string;
  /** value */
  value?: number | string | any;
  /** checked */
  checked?: boolean;
  /** defaultChecked */
  defaultChecked?: boolean;
  /** onChange */
  onChange?: (...args: any[]) => void;
  /** children */
  children?: React.ReactNode;
  /** sub */
  sub?: any;
}
export function Radio(props: RadioProps): React.ReactElement | null;

