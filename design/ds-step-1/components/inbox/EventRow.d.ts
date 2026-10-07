import * as React from 'react';

/**
 * Строка события в «Мне»: иконка типа на тонированном круге, фраза кто и что, предмет, время, действия «Разобрано» и «Напомнить». type: task, comment, mention, entryComment, reaction, meetingQuestion, request, updateRequest. event: { id, type, who, what, subject, subjectIcon, time, unread, done, request: { onAccept, onDecline } }.
 * @startingPoint section="Компоненты Сравни" subtitle="Строка события в «Мне»: иконка типа на тонированном круге, фраза кто и что, пред" viewport="700x400"
 */
export interface EventRowProps {
  /** event */
  event?: any;
  /** onAccept */
  onAccept?: (...args: any[]) => void;
  /** onDecline */
  onDecline?: (...args: any[]) => void;
  /** onRemind */
  onRemind?: (...args: any[]) => void;
  /** onDone */
  onDone?: (...args: any[]) => void;
}
export function EventRow(props: EventRowProps): React.ReactElement | null;

/** Строка события в «Мне»: иконка типа на тонированном круге, фраза кто и что, предмет, время, действия «Разобрано» и «Напомнить». type: task, comment, mention, entryComment, reaction, meetingQuestion, request, updateRequest. event: { id, type, who, what, subject, subjectIcon, time, unread, done, request: { onAccept, onDecline } }. */
export interface EventListProps {
  /** events */
  events?: boolean;
  /** style */
  style?: React.CSSProperties;
  /** onDone */
  onDone?: (...args: any[]) => void;
  /** onRemind */
  onRemind?: (...args: any[]) => void;
  /** onAccept */
  onAccept?: (...args: any[]) => void;
  /** onDecline */
  onDecline?: (...args: any[]) => void;
}
export function EventList(props: EventListProps): React.ReactElement | null;

export const EVENT_TYPES: any;
