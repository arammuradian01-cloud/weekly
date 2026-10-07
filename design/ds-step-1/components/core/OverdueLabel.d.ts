import * as React from 'react';

/**
 * Срок задачи. Просрочка: красная подпись «просрочена на N дн.». soon: срок сегодня или завтра.
 * @startingPoint section="Компоненты Сравни" subtitle="Срок задачи. Просрочка: красная подпись «просрочена на N дн.». soon: срок сегодн" viewport="700x400"
 */
export interface OverdueLabelProps {
  /** days */
  days?: number;
  /** soon */
  soon?: boolean;
  /** children */
  children?: React.ReactNode;
  /** date */
  date?: string;
}
export function OverdueLabel(props: OverdueLabelProps): React.ReactElement | null;

