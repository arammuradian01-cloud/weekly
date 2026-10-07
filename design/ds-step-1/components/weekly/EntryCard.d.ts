import * as React from 'react';

/**
 * Карточка записи weekly. entry: { type: result | event | risk | plan, block, direction, what, details, impact, fact, next, links: [{ label, href }], help: { to, due }, thanks: { to, for }, ceo, up, author, questionOpen }. collapsed: только тип и первая фраза. Под записью компактная строка реакций и «Обсудить». canUp: кнопка «Наверх» для руководителя. manager: видит флажок CEO.
 * @startingPoint section="Компоненты Сравни" subtitle="Карточка записи weekly. entry: { type: result | event | risk | plan, block, dire" viewport="700x400"
 */
export interface EntryCardProps {
  /** entry */
  entry?: any;
  /** collapsed */
  collapsed?: boolean;
  /** onExpand */
  onExpand?: (...args: any[]) => void;
  /** manager */
  manager?: boolean;
  /** style */
  style?: React.CSSProperties;
  /** canUp */
  canUp?: boolean;
  /** onUp */
  onUp?: (...args: any[]) => void;
  /** onMenu */
  onMenu?: (...args: any[]) => void;
  /** reactions */
  reactions?: any[];
  /** myReaction */
  myReaction?: string;
  /** comments */
  comments?: number;
  /** onReact */
  onReact?: (...args: any[]) => void;
  /** onDiscuss */
  onDiscuss?: (...args: any[]) => void;
  /** children */
  children?: React.ReactNode;
}
export function EntryCard(props: EntryCardProps): React.ReactElement | null;

