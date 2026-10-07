import * as React from 'react';

/**
 * Метка «Наверх» у записи weekly: отмеченная руководителем запись попадает в его черновик weekly уровнем выше. by: кто отметил.
 * @startingPoint section="Компоненты Сравни" subtitle="Метка «Наверх» у записи weekly: отмеченная руководителем запись попадает в его ч" viewport="700x400"
 */
export interface UpBadgeProps {
  /** className */
  className?: string;
  /** by */
  by?: any;
}
export function UpBadge(props: UpBadgeProps): React.ReactElement | null;

