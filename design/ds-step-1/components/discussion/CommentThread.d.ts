import * as React from 'react';

/** Ветка комментариев с @упоминаниями, пометкой «изменено» и меню «Изменить», «Удалить» (свой комментарий правится 15 минут). comments: [{ id, author, time, text | parts: [string | { mention }], edited, mine, canEdit, deleted, reactions }]. Поле ответа с подсказкой про @. */
export interface CommentProps {
  /** comment */
  comment?: any;
  /** onMenu */
  onMenu?: (...args: any[]) => void;
  /** onReact */
  onReact?: (...args: any[]) => void;
}
export function Comment(props: CommentProps): React.ReactElement | null;

/**
 * Ветка комментариев с @упоминаниями, пометкой «изменено» и меню «Изменить», «Удалить» (свой комментарий правится 15 минут). comments: [{ id, author, time, text | parts: [string | { mention }], edited, mine, canEdit, deleted, reactions }]. Поле ответа с подсказкой про @.
 * @startingPoint section="Компоненты Сравни" subtitle="Ветка комментариев с @упоминаниями, пометкой «изменено» и меню «Изменить», «Удал" viewport="700x400"
 */
export interface CommentThreadProps {
  /** style */
  style?: React.CSSProperties;
  /** comments */
  comments?: number;
  /** onMenu */
  onMenu?: (...args: any[]) => void;
  /** onReact */
  onReact?: (...args: any[]) => void;
  /** readonly */
  readonly?: boolean;
  /** me */
  me?: string;
  /** placeholder */
  placeholder?: string;
  /** draft */
  draft?: string;
  /** onDraft */
  onDraft?: (...args: any[]) => void;
  /** children */
  children?: React.ReactNode;
  /** onSend */
  onSend?: (...args: any[]) => void;
}
export function CommentThread(props: CommentThreadProps): React.ReactElement | null;

