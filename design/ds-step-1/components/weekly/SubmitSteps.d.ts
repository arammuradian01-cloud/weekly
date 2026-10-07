import * as React from 'react';

/**
 * Шаги сдачи weekly: «Что обещал», «Задачи», «Главное и записи», «Проверить и сдать». Слева на ноутбуке (vertical), сверху на телефоне (row). steps: [{ key, label, sub }], current: ключ текущего, done: массив пройденных.
 * @startingPoint section="Компоненты Сравни" subtitle="Шаги сдачи weekly: «Что обещал», «Задачи», «Главное и записи», «Проверить и сдат" viewport="700x400"
 */
export interface SubmitStepsProps {
  /** steps */
  steps?: any[];
  /** done */
  done?: any;
  /** row */
  row?: boolean;
  /** style */
  style?: React.CSSProperties;
  /** current */
  current?: string;
  /** onSelect */
  onSelect?: (...args: any[]) => void;
}
export function SubmitSteps(props: SubmitStepsProps): React.ReactElement | null;

export const SUBMIT_STEPS: any;
