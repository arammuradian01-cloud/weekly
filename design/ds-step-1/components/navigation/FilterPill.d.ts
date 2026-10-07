import * as React from 'react';

/**
 * Фильтр-пилюля со счётчиком, радиус 32. FilterPills: ряд пилюль, одна или несколько активных.
 * @startingPoint section="Компоненты Сравни" subtitle="Фильтр-пилюля со счётчиком, радиус 32. FilterPills: ряд пилюль, одна или несколь" viewport="700x400"
 */
export interface FilterPillProps {
  /** active */
  active?: string;
  /** disabled */
  disabled?: boolean;
  /** tone */
  tone?: string;
  /** size */
  size?: number | string | any;
  /** className */
  className?: string;
  /** onClick */
  onClick?: (...args: any[]) => void;
  /** icon */
  icon?: string;
  /** children */
  children?: React.ReactNode;
  /** count */
  count?: number;
}
export function FilterPill(props: FilterPillProps): React.ReactElement | null;

/** Фильтр-пилюля со счётчиком, радиус 32. FilterPills: ряд пилюль, одна или несколько активных. */
export interface FilterPillsProps {
  /** value */
  value?: number | string | any;
  /** scroll */
  scroll?: boolean;
  /** label */
  label?: string;
  /** style */
  style?: React.CSSProperties;
  /** items */
  items?: any[];
  /** size */
  size?: number | string | any;
  /** onChange */
  onChange?: (...args: any[]) => void;
  /** multi */
  multi?: boolean;
}
export function FilterPills(props: FilterPillsProps): React.ReactElement | null;

