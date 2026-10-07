import React from 'react';
import { Icon } from './Icon.jsx';

/* Срок задачи. Просрочка: красная подпись «просрочена на N дн.». soon: срок сегодня или завтра. */
export function daysWord(n) {
  return n + ' дн.';
}
export function OverdueLabel(props) {
  if (props.days > 0) {
    return <span className="sv-overdue"><Icon name="alert-circle" size={14} />просрочена на {daysWord(props.days)}</span>;
  }
  return <span className={'sv-due' + (props.soon ? ' sv-due--soon' : '')}>{props.children || props.date}</span>;
}
