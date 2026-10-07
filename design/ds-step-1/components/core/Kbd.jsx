import React from 'react';

/* Подсказка клавиши: «⌘K», «Enter», «T». Отдельные клавиши через пробел: "⌘ K". */
export function Kbd(props) {
  return <kbd className={'sv-kbd' + (props.className ? ' ' + props.className : '')}>{props.children}</kbd>;
}
