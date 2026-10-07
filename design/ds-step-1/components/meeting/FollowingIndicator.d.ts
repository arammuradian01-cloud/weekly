import * as React from 'react';

/**
 * Индикатор для участника: «Вы смотрите пункт ведущего» или «Вы отошли» с кнопкой «Вернуться к ведущему».
 * @startingPoint section="Компоненты Сравни" subtitle="Индикатор для участника: «Вы смотрите пункт ведущего» или «Вы отошли» с кнопкой " viewport="700x400"
 */
export interface FollowingIndicatorProps {
  /** away */
  away?: boolean;
  /** style */
  style?: React.CSSProperties;
  /** leaderStep */
  leaderStep?: number;
  /** onReturn */
  onReturn?: (...args: any[]) => void;
}
export function FollowingIndicator(props: FollowingIndicatorProps): React.ReactElement | null;

/** Индикатор для участника: «Вы смотрите пункт ведущего» или «Вы отошли» с кнопкой «Вернуться к ведущему». */
export interface MeetingBarProps {
  /** style */
  style?: React.CSSProperties;
  /** title */
  title?: string;
  /** step */
  step?: number;
  /** total */
  total?: number;
  /** seconds */
  seconds?: number;
  /** total420 */
  total420?: any;
  /** paused */
  paused?: boolean;
  /** onExit */
  onExit?: (...args: any[]) => void;
}
export function MeetingBar(props: MeetingBarProps): React.ReactElement | null;

/** Индикатор для участника: «Вы смотрите пункт ведущего» или «Вы отошли» с кнопкой «Вернуться к ведущему». */
export interface MeetingKeysProps {
  /** style */
  style?: React.CSSProperties;
  /** children */
  children?: React.ReactNode;
}
export function MeetingKeys(props: MeetingKeysProps): React.ReactElement | null;

