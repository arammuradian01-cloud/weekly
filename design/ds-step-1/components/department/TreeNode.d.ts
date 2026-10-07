import * as React from 'react';

/**
 * Узел дерева структуры: название, уровень, руководитель или «не выделен», сколько человек, светофор. func: функциональная связь пунктиром. node: { title, level, lead, vacancy, people, vacancies, lights: { weekly, overdue, goals }, func }. open, selected, hasChildren. children: вложенные узлы.
 * @startingPoint section="Компоненты Сравни" subtitle="Узел дерева структуры: название, уровень, руководитель или «не выделен», сколько" viewport="700x400"
 */
export interface TreeNodeProps {
  /** node */
  node?: any;
  /** hasChildren */
  hasChildren?: any;
  /** children */
  children?: React.ReactNode;
  /** open */
  open?: boolean;
  /** selected */
  selected?: boolean;
  /** plain */
  plain?: boolean;
  /** onClick */
  onClick?: (...args: any[]) => void;
  /** style */
  style?: React.CSSProperties;
  /** showVacancies */
  showVacancies?: boolean;
  /** funcChildren */
  funcChildren?: boolean;
}
export function TreeNode(props: TreeNodeProps): React.ReactElement | null;

