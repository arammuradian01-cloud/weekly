import * as React from 'react';

/**
 * Метка статуса: слово всегда рядом с цветом. tone: success, warning, danger, info, accent, neutral, outline (Предложена), brand. dot: точка; half: половинная точка (Частично).
 * @startingPoint section="Компоненты Сравни" subtitle="Метка статуса: слово всегда рядом с цветом. tone: success, warning, danger, info" viewport="700x400"
 */
export interface StatusBadgeProps {
  /** task */
  task?: string;
  /** weekly */
  weekly?: string;
  /** request */
  request?: string;
  /** tone */
  tone?: string;
  /** dot */
  dot?: boolean;
  /** half */
  half?: boolean;
  /** children */
  children?: React.ReactNode;
  /** size */
  size?: number | string | any;
  /** className */
  className?: string;
  /** title */
  title?: string;
  /** suffix */
  suffix?: React.ReactNode;
}
export function StatusBadge(props: StatusBadgeProps): React.ReactElement | null;

export const TASK_STATUS: any;
export const WEEKLY_STATUS: any;
export const REQUEST_STATUS: any;
