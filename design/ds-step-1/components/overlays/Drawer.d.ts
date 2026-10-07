import * as React from 'react';

/**
 * Боковая панель 560-640 для карточки задачи, просьбы, подразделения. Открывается поверх списка, у неё постоянная ссылка (onCopyLink). inline: без затемнения, для макетов. readonly: шапка на сером (чужая задача, архив).
 * @startingPoint section="Компоненты Сравни" subtitle="Боковая панель 560-640 для карточки задачи, просьбы, подразделения. Открывается " viewport="700x400"
 */
export interface DrawerProps {
  /** readonly */
  readonly?: boolean;
  /** className */
  className?: string;
  /** inline */
  inline?: boolean;
  /** ariaLabel */
  ariaLabel?: string;
  /** title */
  title?: string;
  /** width */
  width?: number;
  /** style */
  style?: React.CSSProperties;
  /** crumbs */
  crumbs?: any[];
  /** badges */
  badges?: React.ReactNode;
  /** subtitle */
  subtitle?: string;
  /** onCopyLink */
  onCopyLink?: (...args: any[]) => void;
  /** onExpand */
  onExpand?: (...args: any[]) => void;
  /** menu */
  menu?: React.ReactNode;
  /** onClose */
  onClose?: (...args: any[]) => void;
  /** children */
  children?: React.ReactNode;
  /** footer */
  footer?: React.ReactNode;
  /** fixed */
  fixed?: boolean;
}
export function Drawer(props: DrawerProps): React.ReactElement | null;

