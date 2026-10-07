import * as React from 'react';

/**
 * Переключатель недели: стрелки, номер и даты, «Текущая», метка состояния недели (закрыта).
 * @startingPoint section="Компоненты Сравни" subtitle="Переключатель недели: стрелки, номер и даты, «Текущая», метка состояния недели (" viewport="700x400"
 */
export interface WeekSwitcherProps {
  /** number */
  number?: number;
  /** dates */
  dates?: string;
  /** style */
  style?: React.CSSProperties;
  /** onPrev */
  onPrev?: (...args: any[]) => void;
  /** onPick */
  onPick?: (...args: any[]) => void;
  /** closed */
  closed?: boolean;
  /** isCurrent */
  isCurrent?: boolean;
  /** onToday */
  onToday?: (...args: any[]) => void;
  /** onNext */
  onNext?: (...args: any[]) => void;
  /** allowFuture */
  allowFuture?: boolean;
}
export function WeekSwitcher(props: WeekSwitcherProps): React.ReactElement | null;

