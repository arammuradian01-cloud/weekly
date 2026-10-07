import * as React from 'react';

/**
 * Подсказка @упоминания под полем ввода: аватар, имя и должность, выбор стрелками и Enter. people: [{ id, name, role }], query: введённое после @, activeIndex: выделенный.
 * @startingPoint section="Компоненты Сравни" subtitle="Подсказка @упоминания под полем ввода: аватар, имя и должность, выбор стрелками " viewport="700x400"
 */
export interface MentionSuggestProps {
  /** query */
  query?: string;
  /** people */
  people?: any[];
  /** activeIndex */
  activeIndex?: number;
  /** staticMenu */
  staticMenu?: boolean;
  /** onPick */
  onPick?: (...args: any[]) => void;
  /** children */
  children?: React.ReactNode;
}
export function MentionSuggest(props: MentionSuggestProps): React.ReactElement | null;

/** Подсказка @упоминания под полем ввода: аватар, имя и должность, выбор стрелками и Enter. people: [{ id, name, role }], query: введённое после @, activeIndex: выделенный. */
export interface MentionProps {
  /** query */
  query?: string;
  /** people */
  people?: any[];
  /** activeIndex */
  activeIndex?: number;
  /** staticMenu */
  staticMenu?: boolean;
  /** onPick */
  onPick?: (...args: any[]) => void;
  /** children */
  children?: React.ReactNode;
}
export function Mention(props: MentionProps): React.ReactElement | null;

