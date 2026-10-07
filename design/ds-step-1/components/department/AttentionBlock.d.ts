import * as React from 'react';

/**
 * Блок «Требует внимания»: 5-7 задач команды, которые просрочены, давно не обновлялись или заблокированы, с ответственным и кнопкой «Попросить обновить». items: [{ id, title, owner, why: 'overdue' | 'stale' | 'blocked', whyText, asked }].
 * @startingPoint section="Компоненты Сравни" subtitle="Блок «Требует внимания»: 5-7 задач команды, которые просрочены, давно не обновля" viewport="700x400"
 */
export interface AttentionBlockProps {
  /** items */
  items?: any[];
  /** style */
  style?: React.CSSProperties;
  /** onAsk */
  onAsk?: (...args: any[]) => void;
}
export function AttentionBlock(props: AttentionBlockProps): React.ReactElement | null;

