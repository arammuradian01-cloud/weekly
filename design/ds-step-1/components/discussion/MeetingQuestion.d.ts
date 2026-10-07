import * as React from 'react';

/** «Обсудить на встрече»: форма с вопросом одной фразой (MeetingQuestionForm) и пометка «Вопрос к встрече» с кнопкой «Обсуждено» (MeetingQuestion). question: { text, author, about, time, done, doneBy, canClose }. */
export interface MeetingQuestionFormProps {
  /** value */
  value?: number | string | any;
  /** style */
  style?: React.CSSProperties;
  /** onCancel */
  onCancel?: (...args: any[]) => void;
  /** onSubmit */
  onSubmit?: (...args: any[]) => void;
  /** question */
  question?: any;
  /** onDone */
  onDone?: (...args: any[]) => void;
  /** link */
  link?: any;
}
export function MeetingQuestionForm(props: MeetingQuestionFormProps): React.ReactElement | null;

/**
 * «Обсудить на встрече»: форма с вопросом одной фразой (MeetingQuestionForm) и пометка «Вопрос к встрече» с кнопкой «Обсуждено» (MeetingQuestion). question: { text, author, about, time, done, doneBy, canClose }.
 * @startingPoint section="Компоненты Сравни" subtitle="«Обсудить на встрече»: форма с вопросом одной фразой (MeetingQuestionForm) и пом" viewport="700x400"
 */
export interface MeetingQuestionProps {
  /** value */
  value?: number | string | any;
  /** style */
  style?: React.CSSProperties;
  /** onCancel */
  onCancel?: (...args: any[]) => void;
  /** onSubmit */
  onSubmit?: (...args: any[]) => void;
  /** question */
  question?: any;
  /** onDone */
  onDone?: (...args: any[]) => void;
  /** link */
  link?: any;
}
export function MeetingQuestion(props: MeetingQuestionProps): React.ReactElement | null;

