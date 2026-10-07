import * as React from 'react';

/**
 * Строка человека в команде: аватар, должность, статус weekly, открытые задачи, просрочка, переносы срока за месяц, просьбы к человеку. Открывает профиль. person: { name, role, weekly, open, overdue, moved, requests, vacationUntil, substitute }.
 * @startingPoint section="Компоненты Сравни" subtitle="Строка человека в команде: аватар, должность, статус weekly, открытые задачи, пр" viewport="700x400"
 */
export interface PersonRowProps {
  /** person */
  person?: boolean;
  /** onOpen */
  onOpen?: (...args: any[]) => void;
  /** style */
  style?: React.CSSProperties;
}
export function PersonRow(props: PersonRowProps): React.ReactElement | null;

