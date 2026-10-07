import * as React from 'react';

/**
 * Блок «Жду от коллег»: мои просьбы с состоянием. items: [{ id, to, text, status, due }]. Пустое: «Просьб нет» и «Попросить коллегу».
 * @startingPoint section="Компоненты Сравни" subtitle="Блок «Жду от коллег»: мои просьбы с состоянием. items: [{ id, to, text, status, " viewport="700x400"
 */
export interface WaitingBlockProps {
  /** items */
  items?: any[];
  /** style */
  style?: React.CSSProperties;
  /** allHref */
  allHref?: string;
  /** onAsk */
  onAsk?: (...args: any[]) => void;
  /** onOpen */
  onOpen?: (...args: any[]) => void;
}
export function WaitingBlock(props: WaitingBlockProps): React.ReactElement | null;

