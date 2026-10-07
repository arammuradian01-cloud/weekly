import * as React from 'react';

/**
 * Состояние задачи: ok «В графике», risk «Есть риск», blocked «Заблокирована», none «Не задано». outside: «зелёное снаружи», пунктирная обводка и подсказка почему.
 * @startingPoint section="Компоненты Сравни" subtitle="Состояние задачи: ok «В графике», risk «Есть риск», blocked «Заблокирована», non" viewport="700x400"
 */
export interface StateDotProps {
  /** state */
  state?: string;
  /** outside */
  outside?: string;
  /** compact */
  compact?: boolean;
  /** children */
  children?: React.ReactNode;
}
export function StateDot(props: StateDotProps): React.ReactElement | null;

export const STATE: any;
