import * as React from 'react';

/**
 * Подсказка клавиши: «⌘K», «Enter», «T». Отдельные клавиши через пробел: "⌘ K".
 * @startingPoint section="Компоненты Сравни" subtitle="Подсказка клавиши: «⌘K», «Enter», «T». Отдельные клавиши через пробел: ⌘ K." viewport="700x400"
 */
export interface KbdProps {
  /** className */
  className?: string;
  /** children */
  children?: React.ReactNode;
}
export function Kbd(props: KbdProps): React.ReactElement | null;

