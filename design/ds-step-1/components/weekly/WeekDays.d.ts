import * as React from 'react';

/**
 * Полоса из семи дней недели и две ячейки: срок weekly и встреча. days: [{ wd, n, today, past, weekend, mark: { kind: 'deadline' | 'meeting', label } }]. По умолчанию неделя 41, 05.10-11.10.2026, сегодня среда 07.10.
 * @startingPoint section="Компоненты Сравни" subtitle="Полоса из семи дней недели и две ячейки: срок weekly и встреча. days: [{ wd, n, " viewport="700x400"
 */
export interface WeekDaysProps {
  /** days */
  days?: number;
  /** style */
  style?: React.CSSProperties;
  /** events */
  events?: boolean;
}
export function WeekDays(props: WeekDaysProps): React.ReactElement | null;

