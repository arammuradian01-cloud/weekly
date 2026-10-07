import * as React from 'react';

/**
 * Путь по структуре над заголовком раздела: Департамент, Управление развития продуктов, Продуктовая аналитика. Каждое звено ведёт на свой уровень. items: [{ label, level, onClick }], level: департамент, управление, отдел, сектор, команда.
 * @startingPoint section="Компоненты Сравни" subtitle="Путь по структуре над заголовком раздела: Департамент, Управление развития проду" viewport="700x400"
 */
export interface StructurePathProps {
  /** items */
  items?: any[];
  /** style */
  style?: React.CSSProperties;
  /** showLevels */
  showLevels?: boolean;
}
export function StructurePath(props: StructurePathProps): React.ReactElement | null;

