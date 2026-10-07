import * as React from 'react';

/**
 * Линейная иконка из набора Lucide: обводка 1,5 px на сетке 20, скруглённые концы, один цвет (currentColor). Требует window.lucide (UMD-сборка lucide). Имя в kebab-case, как в Lucide: "check", "bell", "calendar".
 * @startingPoint section="Компоненты Сравни" subtitle="Линейная иконка из набора Lucide: обводка 1,5 px на сетке 20, скруглённые концы," viewport="700x400"
 */
export interface IconProps {
  /** name */
  name?: string;
  /** size */
  size?: number | string | any;
  /** strokeWidth */
  strokeWidth?: number;
  /** tone */
  tone?: string;
  /** className */
  className?: string;
  /** label */
  label?: string;
  /** style */
  style?: React.CSSProperties;
}
export function Icon(props: IconProps): React.ReactElement | null;

/** Линейная иконка из набора Lucide: обводка 1,5 px на сетке 20, скруглённые концы, один цвет (currentColor). Требует window.lucide (UMD-сборка lucide). Имя в kebab-case, как в Lucide: "check", "bell", "calendar". */
export interface IconCircleProps {
  /** size */
  size?: number | string | any;
  /** tone */
  tone?: string;
  /** name */
  name?: string;
  /** iconSize */
  iconSize?: number;
}
export function IconCircle(props: IconCircleProps): React.ReactElement | null;

