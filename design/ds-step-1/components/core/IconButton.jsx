import React from 'react';
import { Icon } from './Icon.jsx';

/* Кнопка-иконка. Обязателен label (читается вслух и показывается как подсказка). size: md 44, sm 36, xs 28. */
export function IconButton(props) {
  var size = props.size || 'md';
  var cls = ['sv-icon-btn', size !== 'md' ? 'sv-icon-btn--' + size : '', props.variant ? 'sv-icon-btn--' + props.variant : '',
    props.selected ? 'is-selected' : '', props.className || ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} aria-label={props.label} title={props.label} aria-pressed={props.selected} disabled={props.disabled} onClick={props.onClick} style={props.style}>
      <Icon name={props.icon} size={size === 'xs' ? 16 : 20} />
    </button>
  );
}
