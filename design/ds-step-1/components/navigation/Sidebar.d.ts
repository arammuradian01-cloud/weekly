import * as React from 'react';

/**
 * Боковое меню 248. items: [{ key, label, icon, count, group }], группа «Управление» видна владельцу и администраторам. variant: dark (тёмно-синее) или light (как шапка сайта). Внизу профиль: имя, роль, тема, выход. Место под официальный знак: logo (ReactNode) или пунктирная заглушка.
 * @startingPoint section="Компоненты Сравни" subtitle="Боковое меню 248. items: [{ key, label, icon, count, group }], группа «Управлени" viewport="700x400"
 */
export interface SidebarProps {
  /** items */
  items?: any[];
  /** counts */
  counts?: any[];
  /** isManager */
  isManager?: boolean;
  /** isAdmin */
  isAdmin?: boolean;
  /** variant */
  variant?: string;
  /** style */
  style?: React.CSSProperties;
  /** logo */
  logo?: React.ReactNode;
  /** active */
  active?: string;
  /** hrefFor */
  hrefFor?: any;
  /** onSelect */
  onSelect?: (...args: any[]) => void;
  /** userName */
  userName?: string;
  /** userRole */
  userRole?: string;
  /** dark */
  dark?: boolean;
  /** onToggleTheme */
  onToggleTheme?: (...args: any[]) => void;
  /** onLogout */
  onLogout?: (...args: any[]) => void;
}
export function Sidebar(props: SidebarProps): React.ReactElement | null;

export const SIDEBAR_ITEMS: any;
