import * as React from 'react';

/**
 * Выбор человека: список с аватаром, именем и должностью, поиск внутри. people: [{ id, name, role, disabled }].
 * @startingPoint section="Компоненты Сравни" subtitle="Выбор человека: список с аватаром, именем и должностью, поиск внутри. people: [{" viewport="700x400"
 */
export interface PersonPickerProps {
  /** people */
  people?: any[];
  /** placeholder */
  placeholder?: string;
  /** value */
  value?: number | string | any;
}
export function PersonPicker(props: PersonPickerProps): React.ReactElement | null;

