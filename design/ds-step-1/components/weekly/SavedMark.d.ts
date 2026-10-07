import * as React from 'react';

/**
 * Пометка «Сохранено в 14:32». state: saved, saving, offline (черновик на устройстве), error. Deadline: время до срока.
 * @startingPoint section="Компоненты Сравни" subtitle="Пометка «Сохранено в 14:32». state: saved, saving, offline (черновик на устройст" viewport="700x400"
 */
export interface SavedMarkProps {
  /** state */
  state?: string;
  /** style */
  style?: React.CSSProperties;
  /** time */
  time?: string;
  /** onRetry */
  onRetry?: (...args: any[]) => void;
}
export function SavedMark(props: SavedMarkProps): React.ReactElement | null;

/** Пометка «Сохранено в 14:32». state: saved, saving, offline (черновик на устройстве), error. Deadline: время до срока. */
export interface DeadlineProps {
  /** late */
  late?: boolean;
  /** soon */
  soon?: boolean;
  /** style */
  style?: React.CSSProperties;
  /** left */
  left?: string;
}
export function Deadline(props: DeadlineProps): React.ReactElement | null;

