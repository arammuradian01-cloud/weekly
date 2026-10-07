import * as React from 'react';

/**
 * Плашка-предупреждение в потоке страницы. tone: info, warning, danger, success, neutral. Текст говорит, что случилось и что делать.
 * @startingPoint section="Компоненты Сравни" subtitle="Плашка-предупреждение в потоке страницы. tone: info, warning, danger, success, n" viewport="700x400"
 */
export interface AlertProps {
  /** tone */
  tone?: string;
  /** icon */
  icon?: string;
  /** style */
  style?: React.CSSProperties;
  /** title */
  title?: string;
  /** children */
  children?: React.ReactNode;
  /** actions */
  actions?: React.ReactNode;
}
export function Alert(props: AlertProps): React.ReactElement | null;

