import * as React from 'react';

/**
 * Окно. size: sm 440, md 560, lg 760. footer: кнопки справа. inline: без затемнения.
 * @startingPoint section="Компоненты Сравни" subtitle="Окно. size: sm 440, md 560, lg 760. footer: кнопки справа. inline: без затемнени" viewport="700x400"
 */
export interface ModalProps {
  /** size */
  size?: number | string | any;
  /** className */
  className?: string;
  /** style */
  style?: React.CSSProperties;
  /** title */
  title?: string;
  /** onClose */
  onClose?: (...args: any[]) => void;
  /** children */
  children?: React.ReactNode;
  /** footer */
  footer?: React.ReactNode;
  /** footerBetween */
  footerBetween?: boolean;
  /** inline */
  inline?: boolean;
  /** fixed */
  fixed?: boolean;
}
export function Modal(props: ModalProps): React.ReactElement | null;

/** Окно. size: sm 440, md 560, lg 760. footer: кнопки справа. inline: без затемнения. */
export interface ConfirmDialogProps {
  /** title */
  title?: string;
  /** onCancel */
  onCancel?: (...args: any[]) => void;
  /** inline */
  inline?: boolean;
  /** fixed */
  fixed?: boolean;
  /** cancelLabel */
  cancelLabel?: string;
  /** danger */
  danger?: boolean;
  /** onConfirm */
  onConfirm?: (...args: any[]) => void;
  /** loading */
  loading?: number | string | any;
  /** confirmLabel */
  confirmLabel?: string;
  /** icon */
  icon?: string;
  /** children */
  children?: React.ReactNode;
}
export function ConfirmDialog(props: ConfirmDialogProps): React.ReactElement | null;

