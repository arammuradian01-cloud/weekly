import * as React from 'react';

/**
 * Приоритет: critical, high, medium, low, none. Метка и слово; compact прячет слово (тогда слово в title).
 * @startingPoint section="Компоненты Сравни" subtitle="Приоритет: critical, high, medium, low, none. Метка и слово; compact прячет слов" viewport="700x400"
 */
export interface PriorityMarkProps {
  /** level */
  level?: string;
  /** compact */
  compact?: boolean;
  /** children */
  children?: React.ReactNode;
}
export function PriorityMark(props: PriorityMarkProps): React.ReactElement | null;

export const PRIORITY: any;
