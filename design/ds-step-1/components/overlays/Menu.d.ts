import * as React from 'react';

/**
 * Меню действий. items: [{ key, label, icon, hotkey, danger, disabled, sep: true, group }]. staticMenu: без позиционирования.
 * @startingPoint section="Компоненты Сравни" subtitle="Меню действий. items: [{ key, label, icon, hotkey, danger, disabled, sep: true, " viewport="700x400"
 */
export interface MenuProps {
  /** staticMenu */
  staticMenu?: boolean;
  /** label */
  label?: string;
  /** style */
  style?: React.CSSProperties;
  /** items */
  items?: any[];
  /** onPick */
  onPick?: (...args: any[]) => void;
}
export function Menu(props: MenuProps): React.ReactElement | null;

