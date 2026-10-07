import * as React from 'react';

/**
 * Таймер лидера, по умолчанию 7 минут. seconds: осталось. total: всего. Состояния: идёт, осталась минута (предупреждение), время вышло (ошибка, без звука), paused. size: lg для проектора.
 * @startingPoint section="Компоненты Сравни" subtitle="Таймер лидера, по умолчанию 7 минут. seconds: осталось. total: всего. Состояния:" viewport="700x400"
 */
export interface MeetingTimerProps {
  /** total */
  total?: number;
  /** seconds */
  seconds?: number;
  /** paused */
  paused?: boolean;
  /** size */
  size?: number | string | any;
  /** label */
  label?: string;
  /** style */
  style?: React.CSSProperties;
}
export function MeetingTimer(props: MeetingTimerProps): React.ReactElement | null;

