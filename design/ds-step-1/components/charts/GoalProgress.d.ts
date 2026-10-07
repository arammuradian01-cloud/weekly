import * as React from 'react';

/**
 * Полоса прогресса цели: база, текущее, целевое; отметка плана. tone: ok, risk, fail или по умолчанию акцент. Значения метрик живут в борде, здесь только показ.
 * @startingPoint section="Компоненты Сравни" subtitle="Полоса прогресса цели: база, текущее, целевое; отметка плана. tone: ok, risk, fa" viewport="700x400"
 */
export interface GoalProgressProps {
  /** base */
  base?: number;
  /** target */
  target?: number;
  /** value */
  value?: number | string | any;
  /** tone */
  tone?: string;
  /** style */
  style?: React.CSSProperties;
  /** label */
  label?: string;
  /** unit */
  unit?: string;
  /** plan */
  plan?: number;
  /** tasksDone */
  tasksDone?: number;
  /** tasksTotal */
  tasksTotal?: number;
  /** updated */
  updated?: string;
}
export function GoalProgress(props: GoalProgressProps): React.ReactElement | null;

