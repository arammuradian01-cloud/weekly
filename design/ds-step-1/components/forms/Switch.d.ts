import * as React from 'react';

/**
 * Переключатель. labelRight: подпись слева, тумблер справа (список настроек писем). locked: заблокирован при общем логине, с замком и пояснением.
 * @startingPoint section="Компоненты Сравни" subtitle="Переключатель. labelRight: подпись слева, тумблер справа (список настроек писем)" viewport="700x400"
 */
export interface SwitchProps {
  /** disabled */
  disabled?: boolean;
  /** locked */
  locked?: boolean;
  /** labelRight */
  labelRight?: boolean;
  /** className */
  className?: string;
  /** style */
  style?: React.CSSProperties;
  /** checked */
  checked?: boolean;
  /** defaultChecked */
  defaultChecked?: boolean;
  /** onChange */
  onChange?: (...args: any[]) => void;
  /** ariaLabel */
  ariaLabel?: string;
  /** children */
  children?: React.ReactNode;
  /** sub */
  sub?: any;
}
export function Switch(props: SwitchProps): React.ReactElement | null;

