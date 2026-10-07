import React from 'react';

/* Приоритет: critical, high, medium, low, none. Метка и слово; compact прячет слово (тогда слово в title). */
export var PRIORITY = { critical: 'Критичный', high: 'Высокий', medium: 'Средний', low: 'Низкий', none: 'Не задан' };
export function PriorityMark(props) {
  var level = props.level || 'none';
  return (
    <span className={'sv-priority sv-priority--' + level} title={PRIORITY[level]}>
      <span className="sv-priority__mark" />
      {props.compact ? null : (props.children || PRIORITY[level])}
    </span>
  );
}
