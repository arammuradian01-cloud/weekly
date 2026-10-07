import * as React from 'react';

/**
 * Полоса истории статусов в карточке задачи: сколько дней задача была в каждом статусе. segments: [{ status, days }].
 * @startingPoint section="Компоненты Сравни" subtitle="Полоса истории статусов в карточке задачи: сколько дней задача была в каждом ста" viewport="700x400"
 */
export interface StatusHistoryBarProps {
  /** segments */
  segments?: any[];
  /** style */
  style?: React.CSSProperties;
}
export function StatusHistoryBar(props: StatusHistoryBarProps): React.ReactElement | null;

