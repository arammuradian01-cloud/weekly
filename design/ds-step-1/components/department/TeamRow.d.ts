import * as React from 'react';

/**
 * Строка команды в «Моих командах»: руководитель, «weekly сдали N из M», задач в работе, просрочено, требует уточнений, давно не обновлялись, целей в риске. team: { name, lead, mine, weeklyDone, weeklyTotal, inWork, overdue, clarify, stale, goalsRisk, lights }. TeamList: обёртка с шапкой.
 * @startingPoint section="Компоненты Сравни" subtitle="Строка команды в «Моих командах»: руководитель, «weekly сдали N из M», задач в р" viewport="700x400"
 */
export interface TeamRowProps {
  /** team */
  team?: any;
  /** onOpen */
  onOpen?: (...args: any[]) => void;
  /** style */
  style?: React.CSSProperties;
}
export function TeamRow(props: TeamRowProps): React.ReactElement | null;

/** Строка команды в «Моих командах»: руководитель, «weekly сдали N из M», задач в работе, просрочено, требует уточнений, давно не обновлялись, целей в риске. team: { name, lead, mine, weeklyDone, weeklyTotal, inWork, overdue, clarify, stale, goalsRisk, lights }. TeamList: обёртка с шапкой. */
export interface TeamListProps {
  /** style */
  style?: React.CSSProperties;
  /** noHead */
  noHead?: boolean;
  /** children */
  children?: React.ReactNode;
}
export function TeamList(props: TeamListProps): React.ReactElement | null;

