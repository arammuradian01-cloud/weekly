import * as React from 'react';

/**
 * Пустое состояние: иконка на тонированном круге, заголовок, одна фраза и одно действие. compact: в строку для блоков. illustration: место под спокойную иллюстрацию (только пустые состояния и вход).
 * @startingPoint section="Компоненты Сравни" subtitle="Пустое состояние: иконка на тонированном круге, заголовок, одна фраза и одно дей" viewport="700x400"
 */
export interface EmptyStateProps {
  /** compact */
  compact?: boolean;
  /** style */
  style?: React.CSSProperties;
  /** illustration */
  illustration?: boolean;
  /** icon */
  icon?: string;
  /** tone */
  tone?: string;
  /** title */
  title?: string;
  /** children */
  children?: React.ReactNode;
  /** action */
  action?: React.ReactNode;
}
export function EmptyState(props: EmptyStateProps): React.ReactElement | null;

