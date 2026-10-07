import * as React from 'react';

/**
 * Строка обещания с итогом: четыре кнопки итога (сделано, частично, не сделано, снято), поле на одну фразу и «Перенести на эту неделю». promise: { id, text, from, outcome, note }. readonly: итог без кнопок (лента, профиль).
 * @startingPoint section="Компоненты Сравни" subtitle="Строка обещания с итогом: четыре кнопки итога (сделано, частично, не сделано, сн" viewport="700x400"
 */
export interface PromiseRowProps {
  /** promise */
  promise?: any;
  /** readonly */
  readonly?: boolean;
  /** style */
  style?: React.CSSProperties;
  /** onOutcome */
  onOutcome?: (...args: any[]) => void;
  /** onNote */
  onNote?: (...args: any[]) => void;
  /** onCarry */
  onCarry?: (...args: any[]) => void;
}
export function PromiseRow(props: PromiseRowProps): React.ReactElement | null;

export const OUTCOMES: any;
