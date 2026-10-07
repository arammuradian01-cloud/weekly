import React from 'react';

/* Счётчик-бейдж: в меню, на фильтрах, у вкладок. tone: accent (по умолчанию), neutral, danger, inverse (на тёмном меню). dot: только точка без числа. max: верхний предел, дальше «99+». */
export function CounterBadge(props) {
  var max = props.max || 99;
  var n = props.value;
  var text = typeof n === 'number' && n > max ? max + '+' : n;
  if (!props.dot && (n === 0 || n == null)) return null;
  return <span className={['sv-counter', props.tone ? 'sv-counter--' + props.tone : '', props.dot ? 'sv-counter--dot' : ''].filter(Boolean).join(' ')} aria-label={props.label}>{props.dot ? '' : text}</span>;
}
