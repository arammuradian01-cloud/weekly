import * as React from 'react';

/**
 * Реакции «Принято», «Вопрос», «Обсудить на встрече», «Спасибо». Повторное нажатие снимает свою. compact: строка со счётчиками для ленты; полная панель с именами (full): value: { accepted: ['Влад', ...], ... }. value в compact: { accepted: 3, question: 1 } или массивы имён. mine: ключ своей реакции. discussCount: число комментариев для кнопки «Обсудить».
 * @startingPoint section="Компоненты Сравни" subtitle="Реакции «Принято», «Вопрос», «Обсудить на встрече», «Спасибо». Повторное нажатие" viewport="700x400"
 */
export interface ReactionsProps {
  /** value */
  value?: number | string | any;
  /** size */
  size?: number | string | any;
  /** full */
  full?: boolean;
  /** style */
  style?: React.CSSProperties;
  /** mine */
  mine?: string;
  /** onReact */
  onReact?: (...args: any[]) => void;
  /** disabled */
  disabled?: boolean;
  /** compact */
  compact?: boolean;
  /** showAll */
  showAll?: boolean;
  /** labels */
  labels?: boolean;
  /** onAdd */
  onAdd?: (...args: any[]) => void;
  /** discussCount */
  discussCount?: number;
  /** onDiscuss */
  onDiscuss?: (...args: any[]) => void;
  /** discussOpen */
  discussOpen?: any;
}
export function Reactions(props: ReactionsProps): React.ReactElement | null;

export const REACTIONS: any;
