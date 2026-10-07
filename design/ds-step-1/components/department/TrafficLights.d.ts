import * as React from 'react';

/**
 * Светофор из трёх точек: weekly сдан, есть просрочки, цели в риске. Значения: ok, warn, bad, off. labels: со словами.
 * @startingPoint section="Компоненты Сравни" subtitle="Светофор из трёх точек: weekly сдан, есть просрочки, цели в риске. Значения: ok," viewport="700x400"
 */
export interface TrafficLightsProps {
  /** weekly */
  weekly?: string;
  /** overdue */
  overdue?: any;
  /** goals */
  goals?: any[];
  /** labels */
  labels?: boolean;
  /** style */
  style?: React.CSSProperties;
}
export function TrafficLights(props: TrafficLightsProps): React.ReactElement | null;

