import * as React from 'react';

/**
 * Поле ввода с заливкой, как на сайте. size: sm 36, md 44, lg 52. icon слева, affix справа, action: кнопка внутри поля ({ label, onClick }).
 * @startingPoint section="Компоненты Сравни" subtitle="Поле ввода с заливкой, как на сайте. size: sm 36, md 44, lg 52. icon слева, affi" viewport="700x400"
 */
export interface InputProps {
  /** size */
  size?: number | string | any;
  /** error */
  error?: boolean;
  /** disabled */
  disabled?: boolean;
  /** readOnly */
  readOnly?: boolean;
  /** focused */
  focused?: boolean;
  /** loading */
  loading?: number | string | any;
  /** className */
  className?: string;
  /** style */
  style?: React.CSSProperties;
  /** icon */
  icon?: string;
  /** id */
  id?: string;
  /** type */
  type?: string;
  /** value */
  value?: number | string | any;
  /** defaultValue */
  defaultValue?: any;
  /** placeholder */
  placeholder?: string;
  /** onChange */
  onChange?: (...args: any[]) => void;
  /** onKeyDown */
  onKeyDown?: (...args: any[]) => void;
  /** describedBy */
  describedBy?: string;
  /** autoComplete */
  autoComplete?: string;
  /** inputMode */
  inputMode?: string;
  /** name */
  name?: string;
  /** affix */
  affix?: React.ReactNode;
  /** action */
  action?: React.ReactNode;
  /** iconRight */
  iconRight?: any;
}
export function Input(props: InputProps): React.ReactElement | null;

