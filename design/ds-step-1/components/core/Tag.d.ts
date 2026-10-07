import * as React from 'react';

/**
 * Тег. kind: default (направление, блок), result | event | risk | plan (тип записи), ceo («В отчёт CEO»), help («Нужна помощь»), question («Вопрос к встрече»), up («Наверх»). onRemove добавляет крестик.
 * @startingPoint section="Компоненты Сравни" subtitle="Тег. kind: default (направление, блок), result | event | risk | plan (тип записи" viewport="700x400"
 */
export interface TagProps {
  /** kind */
  kind?: string;
  /** children */
  children?: React.ReactNode;
  /** icon */
  icon?: string;
  /** onRemove */
  onRemove?: (...args: any[]) => void;
  /** className */
  className?: string;
}
export function Tag(props: TagProps): React.ReactElement | null;

export const ENTRY_TYPE: any;
