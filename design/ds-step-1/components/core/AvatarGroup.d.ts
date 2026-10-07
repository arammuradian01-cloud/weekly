import * as React from 'react';

/**
 * Группа аватаров внахлёст; max задаёт, сколько показать, остальные «+N». names: массив имён.
 * @startingPoint section="Компоненты Сравни" subtitle="Группа аватаров внахлёст; max задаёт, сколько показать, остальные «+N». names: м" viewport="700x400"
 */
export interface AvatarGroupProps {
  /** max */
  max?: number;
  /** names */
  names?: any[];
  /** size */
  size?: number | string | any;
}
export function AvatarGroup(props: AvatarGroupProps): React.ReactElement | null;

