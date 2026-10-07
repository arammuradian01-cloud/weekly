import * as React from 'react';

/**
 * Поле пароля с кнопкой «Показать пароль» и подсказкой требований под полем. rules: показывать список требований (для «Придумайте пароль»); login, name: для проверки «без логина, имени и фамилии».
 * @startingPoint section="Компоненты Сравни" subtitle="Поле пароля с кнопкой «Показать пароль» и подсказкой требований под полем. rules" viewport="700x400"
 */
export interface PasswordInputProps {
  /** rules */
  rules?: any[];
  /** value */
  value?: number | string | any;
  /** login */
  login?: string;
  /** name */
  name?: string;
  /** autoComplete */
  autoComplete?: string;
}
export function PasswordInput(props: PasswordInputProps): React.ReactElement | null;

