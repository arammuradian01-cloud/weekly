import * as React from 'react';

/**
 * Хлебные крошки в карточке: Задачи, КАСКО, №124. items: [{ label, href, onClick }], последняя текущая.
 * @startingPoint section="Компоненты Сравни" subtitle="Хлебные крошки в карточке: Задачи, КАСКО, №124. items: [{ label, href, onClick }" viewport="700x400"
 */
export interface BreadcrumbsProps {
  /** items */
  items?: any[];
  /** size */
  size?: number | string | any;
  /** label */
  label?: string;
  /** style */
  style?: React.CSSProperties;
}
export function Breadcrumbs(props: BreadcrumbsProps): React.ReactElement | null;

