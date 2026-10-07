import * as React from 'react';

/**
 * Выпадающий список. options: [{ value, label, sub, icon, disabled }]. searchable: поле поиска внутри (выбор с поиском). open: принудительно открыт (для макетов). Выбор стрелками и Enter.
 * @startingPoint section="Компоненты Сравни" subtitle="Выпадающий список. options: [{ value, label, sub, icon, disabled }]. searchable:" viewport="700x400"
 */
export interface SelectProps {
  /** open */
  open?: boolean;
  /** options */
  options?: any[];
  /** value */
  value?: number | string | any;
  /** size */
  size?: number | string | any;
  /** onChange */
  onChange?: (...args: any[]) => void;
  /** style */
  style?: React.CSSProperties;
  /** id */
  id?: string;
  /** error */
  error?: boolean;
  /** disabled */
  disabled?: boolean;
  /** icon */
  icon?: string;
  /** placeholder */
  placeholder?: string;
  /** staticMenu */
  staticMenu?: boolean;
  /** searchable */
  searchable?: boolean;
  /** searchPlaceholder */
  searchPlaceholder?: string;
  /** emptyText */
  emptyText?: string;
}
export function Select(props: SelectProps): React.ReactElement | null;

