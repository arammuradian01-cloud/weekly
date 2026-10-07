import * as React from 'react';

/**
 * Шторка снизу на телефоне: быстрые действия с карточкой, ответ на просьбу за два нажатия, обновление задачи. inline: без затемнения. SheetRow: строка действия не ниже 44.
 * @startingPoint section="Компоненты Сравни" subtitle="Шторка снизу на телефоне: быстрые действия с карточкой, ответ на просьбу за два " viewport="700x400"
 */
export interface BottomSheetProps {
  /** className */
  className?: string;
  /** title */
  title?: string;
  /** style */
  style?: React.CSSProperties;
  /** onClose */
  onClose?: (...args: any[]) => void;
  /** children */
  children?: React.ReactNode;
  /** inline */
  inline?: boolean;
  /** fixed */
  fixed?: boolean;
}
export function BottomSheet(props: BottomSheetProps): React.ReactElement | null;

/** Шторка снизу на телефоне: быстрые действия с карточкой, ответ на просьбу за два нажатия, обновление задачи. inline: без затемнения. SheetRow: строка действия не ниже 44. */
export interface SheetRowProps {
  /** danger */
  danger?: boolean;
  /** onClick */
  onClick?: (...args: any[]) => void;
  /** disabled */
  disabled?: boolean;
  /** icon */
  icon?: string;
  /** children */
  children?: React.ReactNode;
  /** trailing */
  trailing?: React.ReactNode;
}
export function SheetRow(props: SheetRowProps): React.ReactElement | null;

