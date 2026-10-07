import * as React from 'react';

/**
 * Подсказка: тёмная плашка, одна фраза, иногда с клавишей. Появляется при наведении и фокусе на обёрнутом элементе. staticTip: показать сразу (для макетов).
 * @startingPoint section="Компоненты Сравни" subtitle="Подсказка: тёмная плашка, одна фраза, иногда с клавишей. Появляется при наведени" viewport="700x400"
 */
export interface TooltipProps {
  /** arrow */
  arrow?: boolean;
  /** text */
  text?: string;
  /** hotkey */
  hotkey?: any;
  /** staticTip */
  staticTip?: boolean;
  /** children */
  children?: React.ReactNode;
}
export function Tooltip(props: TooltipProps): React.ReactElement | null;

