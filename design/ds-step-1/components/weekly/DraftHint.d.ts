import * as React from 'react';

/**
 * Подсказка из черновика фактов сбоку от записей: что ресурс заметил за неделю (закрытая задача, смена статуса, реакция), с кнопкой «Добавить». hint: { source, text, added }.
 * @startingPoint section="Компоненты Сравни" subtitle="Подсказка из черновика фактов сбоку от записей: что ресурс заметил за неделю (за" viewport="700x400"
 */
export interface DraftHintProps {
  /** hint */
  hint?: string;
  /** style */
  style?: React.CSSProperties;
  /** onAdd */
  onAdd?: (...args: any[]) => void;
  /** onSkip */
  onSkip?: (...args: any[]) => void;
}
export function DraftHint(props: DraftHintProps): React.ReactElement | null;

