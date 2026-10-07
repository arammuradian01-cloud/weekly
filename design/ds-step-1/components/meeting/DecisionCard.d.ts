import * as React from 'react';

/**
 * Карточка решения: формулировка, владелец, дата встречи, связанные задачи, статус «в силе» или «отменено». decision: { text, owner, date, tasks: [{ id, title }], cancelled, cancelledBy, cancelledAt, protocol }.
 * @startingPoint section="Компоненты Сравни" subtitle="Карточка решения: формулировка, владелец, дата встречи, связанные задачи, статус" viewport="700x400"
 */
export interface DecisionCardProps {
  /** decision */
  decision?: any;
  /** style */
  style?: React.CSSProperties;
  /** onOpen */
  onOpen?: (...args: any[]) => void;
}
export function DecisionCard(props: DecisionCardProps): React.ReactElement | null;

