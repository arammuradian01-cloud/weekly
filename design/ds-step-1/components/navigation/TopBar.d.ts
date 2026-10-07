import * as React from 'react';

/**
 * Верхняя панель: переключатель команд (слева от недели), переключатель недели, поиск (Cmd+K), кнопка «Новая задача». mac: подсказка ⌘K вместо Ctrl K.
 * @startingPoint section="Компоненты Сравни" subtitle="Верхняя панель: переключатель команд (слева от недели), переключатель недели, по" viewport="700x400"
 */
export interface TopBarProps {
  /** surface */
  surface?: boolean;
  /** style */
  style?: React.CSSProperties;
  /** leading */
  leading?: React.ReactNode;
  /** team */
  team?: any;
  /** week */
  week?: any;
  /** onSearch */
  onSearch?: (...args: any[]) => void;
  /** mac */
  mac?: boolean;
  /** onNewTask */
  onNewTask?: (...args: any[]) => void;
  /** trailing */
  trailing?: React.ReactNode;
}
export function TopBar(props: TopBarProps): React.ReactElement | null;

