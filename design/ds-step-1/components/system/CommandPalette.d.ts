import * as React from 'react';

/**
 * Командная строка Cmd+K: поиск по задачам, записям, решениям и людям; быстрые действия с подсказкой клавиш. Результаты сгруппированы по типу. groups: [{ name, items: [{ key, label, sub, icon, person, hotkey }] }]. query, activeKey.
 * @startingPoint section="Компоненты Сравни" subtitle="Командная строка Cmd+K: поиск по задачам, записям, решениям и людям; быстрые дей" viewport="700x400"
 */
export interface CommandPaletteProps {
  /** query */
  query?: string;
  /** groups */
  groups?: any[];
  /** style */
  style?: React.CSSProperties;
  /** onQuery */
  onQuery?: (...args: any[]) => void;
  /** activeKey */
  activeKey?: string;
  /** onPick */
  onPick?: (...args: any[]) => void;
}
export function CommandPalette(props: CommandPaletteProps): React.ReactElement | null;

export const CMDK_ACTIONS: any;
