import * as React from 'react';

/**
 * Тост: «Сохранено», «Задача создана», «Не сохранилось» с «Повторить», «Удалено» с «Отменить» на 5 секунд. Несколько стопкой (ToastStack). toast: { id, tone: success | error | info | neutral, text, action: { label, onClick }, progress: 0..100 }.
 * @startingPoint section="Компоненты Сравни" subtitle="Тост: «Сохранено», «Задача создана», «Не сохранилось» с «Повторить», «Удалено» с" viewport="700x400"
 */
export interface ToastProps {
  /** toast */
  toast?: any;
  /** style */
  style?: React.CSSProperties;
  /** onClose */
  onClose?: (...args: any[]) => void;
}
export function Toast(props: ToastProps): React.ReactElement | null;

/** Тост: «Сохранено», «Задача создана», «Не сохранилось» с «Повторить», «Удалено» с «Отменить» на 5 секунд. Несколько стопкой (ToastStack). toast: { id, tone: success | error | info | neutral, text, action: { label, onClick }, progress: 0..100 }. */
export interface ToastStackProps {
  /** staticStack */
  staticStack?: boolean;
  /** style */
  style?: React.CSSProperties;
  /** toasts */
  toasts?: any[];
  /** onClose */
  onClose?: (...args: any[]) => void;
}
export function ToastStack(props: ToastStackProps): React.ReactElement | null;

