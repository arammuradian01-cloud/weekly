import * as React from 'react';

/**
 * Нижнее меню на телефоне, пять пунктов: Моя неделя, Мне, Weekly, Задачи, Ещё. У руководителя «Мои команды» вместо «Weekly» (manager).
 * @startingPoint section="Компоненты Сравни" subtitle="Нижнее меню на телефоне, пять пунктов: Моя неделя, Мне, Weekly, Задачи, Ещё. У р" viewport="700x400"
 */
export interface BottomNavProps {
  /** items */
  items?: any[];
  /** manager */
  manager?: boolean;
  /** counts */
  counts?: any[];
  /** style */
  style?: React.CSSProperties;
  /** active */
  active?: string;
  /** onSelect */
  onSelect?: (...args: any[]) => void;
}
export function BottomNav(props: BottomNavProps): React.ReactElement | null;

